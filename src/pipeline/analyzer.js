// DeepSeek 分析服务：三元组抽取 + 人物摘要
// 复用 openai 客户端（DeepSeek 兼容 OpenAI 接口），三个职责三个 prompt
import OpenAI from 'openai';
import config from '../config.js';
import {
  PERSON_RELATION_TYPES,
  EVENT_RELATION_TYPES,
  EVENT_CATEGORIES,
  KNOWLEDGE_RELATION_TYPES,
  SUBJECT_CATEGORIES,
} from '../ontology.js';

const client = new OpenAI({
  apiKey: config.deepseek.apiKey,
  baseURL: config.deepseek.baseURL,
});

// 关系类型的受控词表（抽取结果必须从这里选，保证图谱整洁）
export const RELATION_TYPES = PERSON_RELATION_TYPES;
// 【本体 v2】人—事件 关系词表 + 事件类型词表（受控）
export { EVENT_RELATION_TYPES, EVENT_CATEGORIES };

// 调 LLM 拿 JSON；解析失败返回 null（调用方决定重试或跳过）
async function chatJSON(system, user) {
  const resp = await client.chat.completions.create({
    model: config.deepseek.model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.1, // 抽取任务要稳定，不要发散
  });
  return JSON.parse(resp.choices[0].message.content);
}

/**
 * 从词条正文抽取：人物属性 + 关系三元组
 * 输出示例：
 * {
 *   "person": { "name": "苏轼", "gender": "男", "birthYear": 1037, "occupation": "文学家", "aliases": ["东坡居士"] },
 *   "relations": [ { "name": "苏洵", "type": "父亲", "description": "...", "confidence": 0.95 } ]
 * }
 */
export async function extractPersonAndRelations(content) {
  const system = `你是严谨的人物资料抽取助手。从百科词条正文中抽取信息，只输出 JSON。
规则：
1. 只抽取正文明确陈述的事实，不要推断。没有的字段给空值。
2. 人—人关系 type 必须从以下列表选择：${PERSON_RELATION_TYPES.join('、')}。
3. 人—事件关系 type 必须从以下列表选择：${EVENT_RELATION_TYPES.join('、')}。
4. 事件 category 必须从以下列表选择：${EVENT_CATEGORIES.join('、')}。
5. relations 中只放“其他真实人物”（不要放群体如“唐代诗人”，不要放主角自己）。
6. events 中只放“有明确名称、时间或地点的历史事件”（如“乌台诗案”“元祐更化”），不要放泛泛的生平阶段（如“进入仕途”）。每个事件列出参与的其他人物。
7. confidence 是 0~1 的置信度，表示正文对这条关系/事件的陈述强度。
输出 JSON 结构：
{"person":{"name":"","gender":"","birthYear":null,"deathYear":null,"occupation":"","aliases":[]},"relations":[{"name":"","type":"","description":"","confidence":0.8}],"events":[{"name":"","year":null,"category":"","description":"","participants":[{"name":"","type":"参与","confidence":0.8}]}]}`;

  const data = await chatJSON(system, `词条正文：\n${content.slice(0, 6000)}`);
  // 过滤掉模型偶尔输出的非法关系类型/事件分类
  data.relations = (data.relations || []).filter((r) => PERSON_RELATION_TYPES.includes(r.type));
  data.events = (data.events || [])
    .filter((e) => e.name && EVENT_CATEGORIES.includes(e.category))
    .map((e) => ({
      ...e,
      year: e.year ? Number(e.year) : null,
      // 参与者里去掉主角自己（防自环）
      participants: (e.participants || []).filter((p) => p.name && p.name !== data.person?.name),
    })); // 无参与者的事件也保留：主角必然参与（worker 里会建 主角—参与—事件 边）
  return data;
}

/**
 * 为人物生成一句话摘要（列表页 / 图谱 tooltip 用）
 */
export async function summarize(person, relations) {
  const system = `你为知识图谱中的人物写一句 50 字以内的中文摘要，概括身份和最重要的人际关系。只输出 JSON：{"summary":"..."}`;
  const relText = relations
    .slice(0, 10)
    .map((r) => `${r.name}(${r.type})`)
    .join('、');
  const data = await chatJSON(system, `人物：${person.name}，职业：${person.occupation}，关系：${relText}`);
  return data.summary || '';
}

/**
 * 实体消歧：新发现的名字是否与库中已有节点是同一人？
 * 返回 'new'（新建）或已有人物的 key（合并过去）
 */
export async function disambiguate(name, clue, existing) {
  if (!existing.length) return 'new';
  const system = `你是实体消歧助手。判断“新发现的人物”与“库中候选人物”是否为同一人。
只输出 JSON：{"matchKey": ""}（不匹配任何候选则 matchKey 为空字符串）
判断依据：出生年、职业、领域、生活年代是否一致。拿不准就返回空，宁缺毋滥。`;
  const candText = existing
    .map((p) => `- key=${p.key} 名字=${p.name} 职业=${p.occupation} 生年=${p.birthYear ?? '?'} 别名=${(p.aliases || []).join('/')}`)
    .join('\n');
  const data = await chatJSON(system, `新人物：${name}（线索：${clue}）\n候选：\n${candText}`);
  return data.matchKey || 'new';
}

/* ============ 【v4】知识主题抽取 ============ */

/**
 * 主题规划：把一个大主题拆成可抓取的子主题清单。
 * 输入 "小学数学3年级" -> 输出单元/知识点列表，用于构建知识树骨架。
 * 只做规划不抓取：先建立"课程 -> 单元 -> 概念"的层级，后续任务逐个抓取。
 */
export async function planTopic(topicName, grade = '') {
  const system = `你是课程设计专家。把用户给的学习主题拆解为知识结构。
规则：
1. 参照中国课程标准，拆成该主题下的"单元"（8~15 个），每个单元再列 3~6 个核心"概念"。
2. concept 必须是可独立成百科词条的具体知识点（如"分数""长方形""九九乘法表"），
   不要泛泛的描述（如"数的认识"可以，"学好数学"不行）。
3. prereq 列出学习该单元前应先掌握的概念（可跨单元）。
只输出 JSON：
{"subject":"","units":[{"name":"","concepts":["",""],"prereq":["",""]}]}`;
  const data = await chatJSON(system, `主题：${topicName}${grade ? `（${grade}）` : ''}`);
  // 清洗：空名过滤 + 去重
  data.units = (data.units || [])
    .map(u => ({
      name: String(u.name || '').trim(),
      concepts: [...new Set((u.concepts || []).map(c => String(c).trim()).filter(Boolean))],
      prereq: [...new Set((u.prereq || []).map(p => String(p).trim()).filter(Boolean))],
    }))
    .filter(u => u.name);
  return data;
}

/**
 * 知识点词条抽取：从任意百科词条正文抽出知识三元组。
 * 与人物抽取不同：不假设词条是人物，通用抽取"概念定义 + 相关概念 + 层级关系"。
 */
export async function extractKnowledge(content, hint = '') {
  const system = `你是知识图谱构建助手。从百科词条正文中抽取知识点，只输出 JSON。
规则：
1. 只抽取正文明确陈述的事实，不要推断。没有的字段给空值。
2. 概念间关系 type 必须从以下列表选择：${KNOWLEDGE_RELATION_TYPES.join('、')}。
3. topic.kind：subject(学科/课程) / unit(单元/章节) / concept(具体概念)。
4. topic.subject 必须从以下列表选择：${SUBJECT_CATEGORIES.join('、')}。
5. relations 只放"其他具体知识点"（有独立词条的概念），不要放泛指词。
6. confidence 是 0~1 置信度。
输出 JSON 结构：
{"topic":{"name":"","kind":"concept","subject":"数学","definition":"","grade":""},"relations":[{"name":"","type":"","description":"","confidence":0.8}]}`;

  const data = await chatJSON(system, `词条正文（${hint || '知识点'}）：\n${content.slice(0, 6000)}`);
  data.relations = (data.relations || []).filter((r) => KNOWLEDGE_RELATION_TYPES.includes(r.type));
  return data;
}
