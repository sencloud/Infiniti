// 后台补写解说：服务起来之后，按书轮流给还没有解说的人物（以及精怪、教材里的主要知识点）各写一篇。
// 一次只写一篇，写完歇一会儿，避免和学习者的提问抢模型。依据太少的记下来，事实变多了再试。
import config from '../config.js';
import { listGraphs } from './domains/index.js';
import { generateNote } from './notes.js';
import { ensureUnitLabels, rows, withGraph } from './neo.js';
import { graphFile, readJsonFile, writeJsonFile } from './store.js';

const MIN_CLAIMS = 2;
const QUEUE_TTL = 10 * 60 * 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const queues = new Map();
let cursor = 0;

function enabled() {
  return process.env.KG_NOTE_AUTOFILL !== '0' && Boolean(config.deepseek.apiKey);
}

function locales() {
  const list = String(process.env.KG_NOTE_LOCALES || 'zh')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s === 'zh' || s === 'en');
  return list.length ? list : ['zh'];
}

function gapMs() {
  return Math.max(500, Number(process.env.KG_NOTE_GAP_MS || 2000));
}

function idleMs() {
  return Math.max(60_000, Number(process.env.KG_NOTE_IDLE_MS || 600_000));
}

/** 人物，加上精怪；没有人物的图谱（教材）用它自己的主要类型 */
export function noteTypes(graph) {
  const types = new Set(graph.galaxy?.primaryTypes?.length ? graph.galaxy.primaryTypes : ['Person']);
  if (graph.ontology.ENTITY_TYPES.some((t) => t.code === 'Spirit')) types.add('Spirit');
  return [...types];
}

function noteFile(graphId, entityId, locale) {
  return graphFile(graphId, 'notes', `${entityId}.${locale === 'en' ? 'en' : 'zh'}.json`);
}

function fillFile(graphId) {
  return graphFile(graphId, 'note-fill.json');
}

function loadSkips(graphId) {
  return readJsonFile(fillFile(graphId), { skips: {} }).skips || {};
}

function saveSkip(graphId, locale, entityId, skip) {
  const data = readJsonFile(fillFile(graphId), { skips: {} });
  data.skips ||= {};
  data.skips[`${locale}:${entityId}`] = { ...skip, at: new Date().toISOString() };
  writeJsonFile(fillFile(graphId), data);
}

function backoffMs(tries) {
  return Math.min(60, 2 ** Math.max(1, tries)) * 60_000;
}

function skipped(skip, claims) {
  if (!skip) return false;
  if (skip.reason === 'too_few') return claims <= (skip.claims || 0);
  if (skip.reason === 'error') return Date.now() - Date.parse(skip.at || 0) < backoffMs(skip.tries || 1);
  return false;
}

async function loadMissing(graph, locale) {
  const list = await rows(
    `MATCH (e:Entity {graph_id: $g})
     WHERE e.entity_type IN $types AND coalesce(e.claim_count, 0) >= $min
     RETURN e.entity_id AS id, e.canonical_name AS name, coalesce(e.claim_count, 0) AS claims
     ORDER BY claims DESC, name`,
    { types: noteTypes(graph), min: MIN_CLAIMS },
  );
  const skips = loadSkips(graph.id);
  return list.filter((e) => {
    if (readJsonFile(noteFile(graph.id, e.id, locale))) return false;
    return !skipped(skips[`${locale}:${e.id}`], e.claims);
  });
}

async function queueFor(graph, locale) {
  const key = `${graph.id}:${locale}`;
  const cached = queues.get(key);
  if (cached && Date.now() - cached.at < QUEUE_TTL) return cached.items;
  const items = await loadMissing(graph, locale);
  queues.set(key, { items, at: Date.now() });
  return items;
}

async function nextJob(graph) {
  for (const locale of locales()) {
    const items = await queueFor(graph, locale);
    if (items.length) return { ...items[0], locale, left: items.length };
  }
  return null;
}

function dropJob(graph, job) {
  const items = queues.get(`${graph.id}:${job.locale}`)?.items;
  const i = items?.findIndex((e) => e.id === job.id);
  if (i >= 0) items.splice(i, 1);
}

async function runJob(graph, job) {
  try {
    await generateNote(job.id, job.locale);
    dropJob(graph, job);
    console.log(`[notes] ${graph.id}/${job.locale} ${job.name} 解说已写，这一轮还剩 ${Math.max(0, job.left - 1)} 篇`);
  } catch (e) {
    dropJob(graph, job);
    const skips = loadSkips(graph.id);
    const prev = skips[`${job.locale}:${job.id}`];
    if (e.status === 422 || e.code === 'note_too_few') {
      saveSkip(graph.id, job.locale, job.id, { reason: 'too_few', claims: job.claims });
      console.log(`[notes] ${graph.id} ${job.name} 依据太少，先跳过`);
      return;
    }
    const tries = (prev?.tries || 0) + 1;
    saveSkip(graph.id, job.locale, job.id, { reason: 'error', tries, claims: job.claims, error: String(e.message || e).slice(0, 180) });
    console.error(`[notes] ${graph.id} ${job.name} 没写成（第 ${tries} 次）:`, e.message || e);
    if (e.status === 429) await sleep(120_000);
  }
}

async function step() {
  const graphs = listGraphs();
  for (let n = 0; n < graphs.length; n++) {
    const idx = (cursor + n) % graphs.length;
    const graph = graphs[idx];
    const did = await withGraph(graph.id, async () => {
      await ensureUnitLabels();
      const job = await nextJob(graph);
      if (!job) return false;
      await runJob(graph, job);
      return true;
    });
    if (did) {
      cursor = (idx + 1) % graphs.length;
      return true;
    }
  }
  return false;
}

/** 各图谱还没写的篇数（不含已跳过的）。启动时打日志，也可以单独查。 */
export async function noteFillPlan() {
  const plan = [];
  for (const graph of listGraphs()) {
    const counts = {};
    for (const locale of locales()) {
      counts[locale] = await withGraph(graph.id, () => loadMissing(graph, locale).then((items) => {
        queues.set(`${graph.id}:${locale}`, { items, at: Date.now() });
        return items.length;
      }));
    }
    plan.push({ id: graph.id, name: graph.name, ...counts });
  }
  return plan;
}

async function loop() {
  try {
    const plan = await noteFillPlan();
    const parts = plan
      .map((g) => {
        const n = locales().reduce((sum, locale) => sum + (g[locale] || 0), 0);
        return n ? `${g.name} ${n}` : '';
      })
      .filter(Boolean);
    console.log(parts.length ? `[notes] 待写解说：${parts.join('，')}` : '[notes] 解说都已写好，之后有新条目再补');
  } catch (e) {
    console.error('[notes] 统计待写解说失败:', e.message || e);
  }
  for (;;) {
    let busy = false;
    try {
      busy = await step();
    } catch (e) {
      console.error('[notes] 自动解说出错:', e.message || e);
    }
    await sleep(busy ? gapMs() : idleMs());
  }
}

export function startNoteFill() {
  if (process.env.KG_NOTE_AUTOFILL === '0') {
    console.log('[notes] 自动解说已关闭');
    return;
  }
  if (!config.deepseek.apiKey) {
    console.log('[notes] 未配置模型密钥，不自动写解说');
    return;
  }
  console.log('[notes] 后台自动编写解说已启动');
  loop();
}
