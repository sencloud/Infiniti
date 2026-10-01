// 逐单元抽取实体与关系事实：每个单元按段落切成 ≤ WINDOW_CHARS 的窗口分别调用 LLM，
// 结果按单元缓存到 data/<graph>/extract/NNN.json，重跑时跳过已完成的单元。
//   node src/scripts/kg/extract.js <graph> [单元序号…]
import fs from 'node:fs';
import { chatJson } from '../../kg/llm.js';
import { getGraph, unitLabel } from '../../kg/domains/index.js';
import { graphArg, graphPaths, isMain, readJson, writeJson } from './paths.js';
import { loadSeeds } from './seeds.js';

const WINDOW_CHARS = 6000;
const CONCURRENCY = Number(process.env.KG_EXTRACT_CONCURRENCY || 8);

/** 按段落切窗口，返回每个窗口包含的段落下标 */
export function splitWindows(paragraphs, limit = WINDOW_CHARS) {
  const windows = [];
  let buf = [];
  let len = 0;
  paragraphs.forEach((p, i) => {
    if (len + p.length > limit && buf.length) {
      windows.push(buf);
      buf = [];
      len = 0;
    }
    buf.push(i);
    len += p.length;
  });
  if (buf.length) windows.push(buf);
  return windows;
}

/** 只把本窗口里提到的种子人物放进提示词，控制长度 */
function seedHints(text, seeds) {
  return seeds
    .filter((h) => [h.name, h.nickname, ...(h.aliases || [])].some((n) => n && n.length >= 2 && text.includes(n)))
    .map((h) => {
      const other = [h.nickname, ...(h.aliases || []).filter((a) => a !== h.name && !a.endsWith(h.name))].filter(Boolean);
      return other.length ? `${h.name}（${other.join('/')}）` : h.name;
    })
    .join('、');
}

// 泛指群体（「两个都头」「众好汉」「一个庄客」）不作为实体
const GENERIC_NAME = /^(?:[一二两三四五六七八九十百千数几众诸那这此各]|大小|许多|一伙|一群)|(?:们|等人|人等|众人)$/;

const BARE_TITLES = new Set([
  '都头', '府尹', '知府', '知县', '知州', '县尉', '太尉', '观察', '提辖', '教头', '庄客', '庄主', '店小二', '小二',
  '酒保', '军汉', '公人', '差人', '头领', '喽啰', '小喽啰', '好汉', '官军', '军士', '和尚', '长老', '员外',
  '太公', '老儿', '妇人', '娘子', '丫鬟', '使女', '皇帝', '天子', '圣上', '朝廷', '相公', '押司', '节级', '牢子',
  '书生', '秀才', '老翁', '老妪', '女子', '少年', '道士', '仆人', '童子', '使者', '将军', '丞相', '大夫', '国君',
]);

/** 教材知识点名可以只有一个字（「圆」「角」），不套用人物的泛称过滤 */
export function isGenericName(name, graph) {
  if (graph?.kind === 'textbook') return !name || /^(?:例|练习|习题|问题|思考|探索|阅读)/.test(name);
  return name.length < 2 || BARE_TITLES.has(name) || GENERIC_NAME.test(name);
}

function systemPrompt(graph) {
  const o = graph.ontology;
  const rules = [
    ...graph.extract.rules,
    '只抽取片段中明确发生或明确交代的事实，不要凭常识补充片段外的内容。',
    'evidence 必须是原文中连续的一句或半句（≤60字），能直接支撑该关系。',
    graph.kind === 'textbook' ? '' : '无名路人（如「一个庄客」「店小二」）和只有官职没有姓名的人（如「府尹」「知县」）不要作为实体。',
    '有方向的谓词严格按「A 谓词 B」的语义填 subject=A、object=B，不要颠倒。',
    'confidence 取 0.5~1.0，明确叙述取 0.9 以上。',
  ].filter(Boolean);
  return `你是${graph.extract.role}。从给定的原文片段中抽取实体与关系事实，只输出 JSON。
实体类型：
${o.entityGuide()}
关系谓词（只能用下列代码）：
${o.predicateGuide()}
规则：
${rules.map((r, i) => `${i + 1}. ${r}`).join('\n')}
输出格式：
{"entities":[{"name":"","type":"${o.ENTITY_TYPES[0].code}","aliases":[],"nickname":"","description":"≤30字"}],
 "relations":[{"subject":"","predicate":"","object":"","evidence":"","confidence":0.9}]}`;
}

function userPrompt(graph, chapter, label, text, hints, reference) {
  const where = [chapter.part, `${chapter.label || unitLabel(graph, chapter.no)}「${chapter.title}」`].filter(Boolean).join(' · ');
  return `${where}（片段 ${label}）
${hints ? `本片段涉及的${graph.extract.seedNoun}规范名：${hints}\n` : ''}
原文：
${text}${reference ? `\n\n白话译文（仅供理解，evidence 必须取自原文）：\n${reference.slice(0, 4000)}` : ''}`;
}

function clean(raw, graph) {
  const o = graph.ontology;
  const personLike = new Set(['Person', 'Spirit']);
  const entities = [];
  for (const e of raw?.entities || []) {
    const name = String(e?.name || '').trim();
    const type = String(e?.type || '').trim();
    if (!name || name.length > 20 || !o.ENTITY_TYPE_CODES.has(type)) continue;
    if ((personLike.has(type) || graph.kind === 'textbook') && isGenericName(name, graph)) continue;
    entities.push({
      name,
      type,
      aliases: (Array.isArray(e.aliases) ? e.aliases : []).map((a) => String(a).trim()).filter((a) => a && a !== name),
      nickname: String(e.nickname || '').trim(),
      description: String(e.description || '').trim().slice(0, 80),
    });
  }
  const namedNonPerson = new Set(entities.filter((e) => !personLike.has(e.type)).map((e) => e.name));
  const relations = [];
  for (const r of raw?.relations || []) {
    const predicate = String(r?.predicate || '').trim().toUpperCase();
    const subject = String(r?.subject || '').trim();
    const object = String(r?.object || '').trim();
    if (!o.PREDICATE_BY_CODE.has(predicate) || !subject || !object || subject === object) continue;
    const generic = (n) => isGenericName(n, graph) && !namedNonPerson.has(n);
    if (generic(subject) || generic(object)) continue;
    const confidence = Math.max(0, Math.min(1, Number(r.confidence) || 0.8));
    relations.push({ subject, predicate, object, evidence: String(r.evidence || '').trim().slice(0, 120), confidence });
  }
  return { entities, relations };
}

/** 输出被截断（关系太多）时把窗口对半切开重抽 */
async function extractWindow(ctx, chapter, label, idxs, depth = 0) {
  const { graph, seeds, system } = ctx;
  const text = idxs.map((i) => chapter.paragraphs[i]).join('\n');
  const reference = chapter.references ? idxs.map((i) => chapter.references[i]).filter(Boolean).join('\n') : '';
  try {
    const raw = await chatJson({
      system,
      user: userPrompt(graph, chapter, label, text, seedHints(text, seeds), reference),
      maxTokens: 16000,
      retries: depth === 0 ? 2 : 3,
    });
    return [{ chars: text.length, ...clean(raw, graph) }];
  } catch (e) {
    if (depth >= 3 || idxs.length < 2) throw e;
    const mid = Math.ceil(idxs.length / 2);
    const out = [];
    for (const [i, part] of [idxs.slice(0, mid), idxs.slice(mid)].entries()) {
      out.push(...(await extractWindow(ctx, chapter, `${label}-${i + 1}`, part, depth + 1)));
    }
    return out;
  }
}

async function extractChapter(ctx, chapter) {
  const windows = splitWindows(chapter.paragraphs);
  const results = [];
  for (let i = 0; i < windows.length; i++) {
    results.push(...(await extractWindow(ctx, chapter, `${i + 1}/${windows.length}`, windows[i])));
  }
  return {
    no: chapter.no,
    title: chapter.title,
    windows: results.map((w, idx) => ({ idx, ...w })),
    extracted_at: new Date().toISOString(),
  };
}

async function pool(items, limit, worker) {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await worker(item);
    }
  });
  await Promise.all(runners);
}

export async function extractAll(graphId, { only } = {}) {
  const graph = getGraph(graphId);
  const paths = graphPaths(graphId);
  paths.ensureDirs();
  const seeds = await loadSeeds(graphId);
  const ctx = { graph, seeds, system: systemPrompt(graph) };
  const chapters = paths.listChapters().filter((c) => !only || only.includes(c.no));
  const todo = chapters.filter((c) => !fs.existsSync(paths.extractFile(c.no)));
  const tag = `[extract:${graphId}]`;
  console.log(`${tag} 共 ${chapters.length} 个${graph.unit.name}，待抽取 ${todo.length}，并发 ${CONCURRENCY}`);
  let done = 0;
  const failed = [];
  await pool(todo, CONCURRENCY, async (chapter) => {
    try {
      const t0 = Date.now();
      const out = await extractChapter(ctx, chapter);
      writeJson(paths.extractFile(chapter.no), out);
      const nE = out.windows.reduce((s, w) => s + w.entities.length, 0);
      const nR = out.windows.reduce((s, w) => s + w.relations.length, 0);
      done++;
      console.log(`${tag} ${done}/${todo.length} ${unitLabel(graph, chapter.no)} 实体${nE} 关系${nR} ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    } catch (e) {
      failed.push(chapter.no);
      console.error(`${tag} ${unitLabel(graph, chapter.no)} 失败: ${e.message}`);
    }
  });
  const finished = chapters.filter((c) => readJson(paths.extractFile(c.no))).length;
  console.log(`${tag} 完成 ${finished}/${chapters.length}${failed.length ? `，失败：${failed.join(',')}（重跑即可续抽）` : ''}`);
  return { finished, failed, total: chapters.length };
}

if (isMain(import.meta.url)) {
  const { id, rest } = graphArg();
  const only = rest.map(Number).filter(Boolean);
  extractAll(id, { only: only.length ? only : undefined }).catch((e) => {
    console.error(`[extract:${id}] 异常:`, e);
    process.exit(1);
  });
}
