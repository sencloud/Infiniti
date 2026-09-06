// 管道 worker：循环取任务 -> 爬取 -> DeepSeek 分析 -> 写图 -> 新任务入队
// 这是“无限连接”的发动机。可独立进程运行：npm run worker
// 【v4】任务带 kind 字段：'person'（人物接入点，旧流程）| 'knowledge'（知识主题构建）
import config from '../config.js';
import { initSchema, close } from '../db.js';
import * as graph from '../services/graphService.js';
import { crawlBaike, crawlMultiSource, politeDelay } from './crawler.js';
import { extractPersonAndRelations, extractKnowledge, planTopic, summarize, disambiguate } from './analyzer.js';
import { EVENT_RELATION_TYPES } from '../ontology.js';
import { loadSources } from '../sources/registry.js';
import { getSettings } from '../services/settingsService.js';

// ---------- 主循环 ----------

async function main() {
  await initSchema();
  await loadSources(); // 【v4】加载数据源注册表（内置 + 自定义）
  // 【v4】配置面板保存的设置合并进运行时配置（DB 覆盖 .env 默认值）
  const saved = await getSettings().catch(() => ({}));
  if (saved.maxNodes) config.crawl.maxPersons = saved.maxNodes;
  if (saved.maxDepth) config.crawl.maxDepth = saved.maxDepth;
  if (saved.requestDelayMs) config.crawl.requestDelayMs = saved.requestDelayMs;
  if (saved.model) config.deepseek.model = saved.model;
  console.log(`[worker] 启动，规模上限 ${config.crawl.maxPersons} 人 / 深度 ${config.crawl.maxDepth} / 模型 ${config.deepseek.model}`);

  while (true) {
    const task = await graph.claimNextTask();
    if (!task) {
      await sleep(5000); // 暂无任务，稍后再看
      continue;
    }
    // 【v4】按任务类型分流：knowledge 走知识构建流程，其余（含旧任务）走人物流程
    if (task.kind === 'knowledge') await processKnowledgeTask(task);
    else await processTask(task);
  }
}

// ---------- 单个任务处理 ----------

async function processTask(task) {
  const { name, priority, depth, reason } = task;
  console.log(`[worker] 处理: ${name} (深度${depth} 优先级${priority} 来源:${reason})`);

  try {
    // 1. 爬取（带全局限速，对百科友好）
    await politeDelay();
    const page = await crawlBaike(name);
    if (!page) throw new Error('百科词条不可用（消歧页/空页/反爬）');

    // 2. DeepSeek 分析：属性 + 三元组 + 事件（【本体 v2】events 也解构出来）
    const { person, relations, events } = await extractPersonAndRelations(page.content);

    // 3. 规模与深度控制：达到上限就只入库不扩散
    const total = await graph.countPersons();
    const canExpand = total < config.crawl.maxPersons && depth < config.crawl.maxDepth;

    // 4. 主角入库（有百科锚点，是“确认节点”）
    const mainKey = 'baike:' + person.name;
    await graph.upsertPerson({
      key: mainKey,
      ...person,
      anchorUrl: page.url,
      status: 'crawled',
    });

    // 5. 关系人处理：消歧 -> 建临时节点 -> 建边 -> 入队
    const briefRelations = [];
    for (const rel of relations) {
      if (rel.name === person.name) continue; // 防自环

      // 库内同名候选（tmp 节点 + 已确认节点都算）
      const candidates = await graph.findPersonsByName(rel.name);

      // 消歧：LLM 判断是否与库内某人同一个人
      let targetKey;
      if (!candidates.length) {
        targetKey = 'tmp:' + rel.name;
        await graph.upsertPerson({
          key: targetKey,
          name: rel.name,
          status: 'mentioned', // 仅被提及，待爬取确认
        });
      } else {
        const match = await disambiguate(rel.name, rel.description, candidates);
        targetKey = match === 'new' ? 'tmp:' + rel.name : match;
        if (match === 'new') {
          await graph.upsertPerson({
            key: targetKey,
            name: rel.name,
        status: 'mentioned',
          });
        }
      }

      // 建边（主角 -> 关系人，方向由关系类型语义决定，这里统一存主角为 from）
      await graph.upsertRelation(mainKey, targetKey, rel.type, {
        description: rel.description,
        confidence: rel.confidence,
        sourceUrl: page.url,
      });
      briefRelations.push(rel);

      // 入队：优先级 = 亲缘 > 配偶 > 其他（亲缘关系的人百科页面信息密度更高）
      if (canExpand) {
        const bonus = { 父亲: 50, 母亲: 50, 子女: 40, 配偶: 40, 兄弟姐妹: 30 }[rel.type] || 0;
        await graph.enqueueTask(rel.name, {
          priority: priority * 0.5 + bonus,
          depth: depth + 1,
          reason: `${person.name}的${rel.type}`,
        });
      }
    }

    // 5.5 【本体 v2】事件入库：建事件节点 + 主角/参与者 —事件 边 + 参与者入队
    for (const ev of events || []) {
      if (!ev.name) continue;
      const evtKey = 'evt:' + ev.name;
      await graph.upsertEvent({
        key: evtKey,
        name: ev.name,
        year: ev.year,
        category: ev.category,
        description: ev.description,
      });

      // 主角 —参与— 事件（主角必然参与自己词条里的事件）
      await graph.upsertRelation(mainKey, evtKey, '参与', {
        description: `${person.name}参与${ev.name}`,
        confidence: 0.9,
        sourceUrl: page.url,
      });

      // 其他参与者：消歧 -> 建临时节点 -> 建边 -> 入队（优先级低于亲属）
      for (const p of ev.participants || []) {
        if (!p.name || p.name === person.name) continue;
        const role = EVENT_RELATION_TYPES.includes(p.type) ? p.type : '参与';
        const candidates = await graph.findPersonsByName(p.name);
        let targetKey;
        if (!candidates.length) {
          targetKey = 'tmp:' + p.name;
          await graph.upsertPerson({ key: targetKey, name: p.name, status: 'mentioned' });
        } else {
          const match = await disambiguate(p.name, `${ev.name}的参与者`, candidates);
          targetKey = match === 'new' ? 'tmp:' + p.name : match;
          if (match === 'new') {
            await graph.upsertPerson({ key: targetKey, name: p.name, status: 'mentioned' });
          }
        }
        await graph.upsertRelation(targetKey, evtKey, role, {
          description: `${p.name}${role}${ev.name}`,
          confidence: p.confidence ?? 0.7,
          sourceUrl: page.url,
        });
        if (canExpand) {
          await graph.enqueueTask(p.name, {
            priority: priority * 0.3, // 事件参与者优先级更低：事件页信息密度低于亲属页
            depth: depth + 2,         // 深度 +2：事件枝节探索价值低于直系关系
            reason: `${ev.name}(${person.name}词条)`,
          });
        }
      }
    }

    // 6. 生成摘要（失败不影响主流程）
    try {
      const summary = await summarize(person, relations);
      if (summary) {
        await graph.upsertPerson({ key: mainKey, ...person, anchorUrl: page.url, summary });
      }
    } catch (e) {
      console.warn(`[worker] 摘要生成失败（忽略）: ${e.message}`);
    }

    await graph.completeTask(name);
    console.log(`[worker] 完成: ${person.name}，新增 ${relations.length} 条关系`);
  } catch (err) {
    console.error(`[worker] 处理失败: ${name} -> ${err.message}`);
    await graph.failTask(name, err.message);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ============ 【v4】知识主题构建流程 ============ */

// 知识任务三阶段（task.phase 决定）：
//   'plan'   规划：LLM 拆解主题 -> 建课程/单元/概念骨架 -> 单元任务入队
//   'unit'   单元：抓单元词条 -> 建 包含 边 -> 概念任务入队
//   'concept' 概念：多源抓取词条 -> 通用知识抽取 -> 建 Topic 节点 + 知识边 + 相关概念入队
async function processKnowledgeTask(task) {
  const { name, priority, depth, reason, phase = 'concept' } = task;
  console.log(`[worker] 知识任务(${phase}): ${name} (深度${depth} 来源:${reason})`);

  try {
    if (phase === 'plan') {
      await politeDelay();
      // 1. LLM 规划：主题 -> 单元 -> 概念
      const plan = await planTopic(name);
      // 2. 课程骨架入库（根 Topic）
      const rootKey = 'topic:' + name;
      await graph.upsertTopic({
        key: rootKey, name, kind: 'subject',
        subject: plan.subject || '通用', grade: name,
        definition: `课程主题：${name}`,
      });
      // 3. 单元入队（phase='unit'），并建立 包含 边
      for (const u of plan.units || []) {
        const unitKey = 'topic:' + name + '/' + u.name;
        await graph.upsertTopic({
          key: unitKey, name: u.name, kind: 'unit',
          subject: plan.subject || '通用', grade: name,
          definition: `${name} 的单元`,
        });
        await graph.upsertRelation(rootKey, unitKey, '包含', {
          description: `${name} 包含单元 ${u.name}`,
          confidence: 0.95,
        });
        // 概念清单存到单元属性上（phase=unit 时再展开，避免一次塞太多任务）
        await graph.enqueueTask(u.name, {
          priority: priority * 0.8,
          depth: depth + 1,
          reason: `${name} 的单元`,
          kind: 'knowledge',
          phase: 'unit',
          meta: { concepts: u.concepts, prereq: u.prereq, grade: name, subject: plan.subject },
        });
      }
      console.log(`[worker] 规划完成: ${name} -> ${plan.units?.length ?? 0} 个单元`);
    } else if (phase === 'unit') {
      // 单元阶段：不抓页面（单元通常无独立词条），直接展开概念任务
      const meta = typeof task.meta === 'object' ? task.meta : JSON.parse(task.meta || '{}');
      for (const c of meta.concepts || []) {
        await graph.enqueueTask(c, {
          priority: priority * 0.6,
          depth: depth + 1,
          reason: `${name} 单元的概念`,
          kind: 'knowledge',
          phase: 'concept',
          meta: { grade: meta.grade, subject: meta.subject },
        });
      }
      console.log(`[worker] 单元展开: ${name} -> ${meta.concepts?.length ?? 0} 个概念`);
    } else {
      // 概念阶段：多源抓取 + 通用知识抽取
      await politeDelay();
      const page = await crawlMultiSource(name, 'knowledge');
      if (!page) throw new Error('所有数据源均无词条（消歧页/空页/反爬）');

      const { topic, relations } = await extractKnowledge(page.content, name);
      const key = 'topic:' + name;
      await graph.upsertTopic({
        key,
        name,
        kind: topic.kind || 'concept',
        subject: topic.subject || '通用',
        grade: topic.grade || (typeof task.meta === 'object' ? task.meta?.grade : '') || '',
        definition: topic.definition || page.title,
        anchorUrl: page.url,
        source: page.source, // 记录数据来源（v4）
      });

      // 知识边：目标概念建临时 Topic 节点 -> 入队继续扩散
      const total = await graph.countPersons();
      const canExpand = total < config.crawl.maxPersons && depth < config.crawl.maxDepth;
      for (const rel of relations) {
        if (rel.name === name) continue;
        const targetKey = 'topic:' + rel.name;
        await graph.upsertTopic({
          key: targetKey, name: rel.name, kind: 'concept',
          subject: topic.subject || '通用',
          definition: rel.description || '',
        });
        await graph.upsertRelation(key, targetKey, rel.type, {
          description: rel.description,
          confidence: rel.confidence,
          sourceUrl: page.url,
        });
        if (canExpand) {
          await graph.enqueueTask(rel.name, {
            priority: priority * 0.5,
            depth: depth + 1,
            reason: `${name}的${rel.type}`,
            kind: 'knowledge',
            phase: 'concept',
          });
        }
      }
      console.log(`[worker] 概念完成: ${name}（源: ${page.source}），新增 ${relations.length} 条知识边`);
    }
    await graph.completeTask(name);
  } catch (err) {
    console.error(`[worker] 知识任务失败: ${name} -> ${err.message}`);
    await graph.failTask(name, err.message);
  }
}

main().catch((err) => {
  console.error('[worker] 致命错误，退出:', err);
  process.exit(1);
});
