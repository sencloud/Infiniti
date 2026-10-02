// 沿图取证据的问答：问题里点到的实体 → 它们之间的直接事实与最短路径 → 各自最强的事实 → 语义最近的原文段，
// 编号后交给模型作答，回答里的 [n] 都能点回原文。好的回答可以存下来，下次同一个问题直接读。
import crypto from 'node:crypto';
import { paths as findPaths } from './analysisQuery.js';
import { embedQuery } from './embed.js';
import { chatJson } from './llm.js';
import { unitLabel } from './domains/index.js';
import { purposePrompt } from './domains/purpose.js';
import { NameMatcher } from './matcher.js';
import { currentGraph, currentGraphId, int, rows, vectorIndexName } from './neo.js';
import { citationOf, claimFacts, factLine, pickClaims, renumber } from './notes.js';
import { graphFile, listJsonFiles, readJsonFile, removeFile, writeJsonFile } from './store.js';

const MATCHER_TTL = 10 * 60 * 1000;
const MAX_FACTS = 40;
const MAX_SEGMENTS = 6;
const RECENT_LIMIT = 200;
const matchers = new Map();
/** 刚生成、还没存盘的回答：存盘时按 id 取，不信任前端回传的正文 */
const recent = new Map();

const normalize = (q) => String(q || '').trim().replace(/\s+/g, ' ').replace(/[？?！!。.]+$/, '');
const answerId = (locale, q) => `a_${crypto.createHash('sha1').update(`${locale}|${normalize(q)}`).digest('hex').slice(0, 12)}`;
const ANSWER_ID_RE = /^a_[0-9a-f]{12}$/;
const answerFile = (id) => {
  if (!ANSWER_ID_RE.test(String(id))) throw Object.assign(new Error('回答编号不合法'), { status: 400 });
  return graphFile(currentGraphId(), 'answers', `${id}.json`);
};

async function matcherFor() {
  const graphId = currentGraphId();
  const cached = matchers.get(graphId);
  if (cached && Date.now() - cached.at < MATCHER_TTL) return cached;
  const list = await rows(
    `MATCH (e:Entity {graph_id: $g}) WHERE coalesce(e.claim_count, 0) > 0
     RETURN e.entity_id AS id, e.canonical_name AS name, e.aliases AS aliases, e.nickname AS nickname, e.claim_count AS claims`,
  );
  const entry = {
    at: Date.now(),
    byId: new Map(list.map((e) => [e.id, e])),
    matcher: new NameMatcher(list.map((e) => ({ id: e.id, names: [e.name, ...(e.aliases || []), e.nickname].filter(Boolean) }))),
  };
  matchers.set(graphId, entry);
  return entry;
}

async function mentionedEntities(question) {
  const { matcher, byId } = await matcherFor();
  return [...matcher.count(question).keys()]
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map((e) => ({ id: e.id, name: e.name, claims: e.claims, at: question.indexOf(e.name) }))
    .sort((a, b) => (a.at < 0 ? 999 : a.at) - (b.at < 0 ? 999 : b.at))
    .slice(0, 4);
}

/** 两个实体之间：直接事实（全部谓词）+ 3 跳内最短路径上每跳最强的事实 */
async function pairFacts(a, b) {
  const direct = await rows(
    `MATCH (x:Entity {graph_id: $g, entity_id: $a})-[r:RELATES]-(y:Entity {entity_id: $b})
     UNWIND r.claim_ids AS id RETURN id LIMIT 8`,
    { a: a.id, b: b.id },
  );
  const ids = direct.map((r) => r.id);
  if (ids.length < 2) {
    const p = await findPaths(a.id, b.id, 3, 2).catch(() => null);
    for (const path of p?.paths || []) for (const step of path.steps) if (step.claim_id) ids.push(step.claim_id);
  }
  return ids;
}

async function nearSegments(question) {
  try {
    const vec = await embedQuery(question);
    const list = await rows(
      `CALL db.index.vector.queryNodes($index, $k, $vec) YIELD node AS s, score
       MATCH (s)-[:IN_CHAPTER]->(c:Chapter)
       RETURN s.seg_id AS id, s.text AS text, s.chapter_no AS no, c.title AS title, score ORDER BY score DESC`,
      { index: vectorIndexName(), k: int(MAX_SEGMENTS), vec },
    );
    return list.map((s) => ({ segment: true, key: s.id, text: String(s.text || '').slice(0, 320), chapter_no: s.no, title: s.title }));
  } catch {
    return [];
  }
}

async function gather(question) {
  const entities = await mentionedEntities(question);
  const ids = [];
  for (let i = 0; i < entities.length; i++) {
    for (let j = i + 1; j < entities.length && ids.length < 24; j++) ids.push(...(await pairFacts(entities[i], entities[j])));
  }
  const facts = await claimFacts([...new Set(ids)]);
  const seen = new Set(facts.map((f) => f.claim_id));
  const per = entities.length ? Math.max(6, Math.floor((MAX_FACTS - facts.length) / entities.length)) : 0;
  for (const e of entities) {
    for (const f of await pickClaims(e.id, per)) {
      if (seen.has(f.claim_id) || facts.length >= MAX_FACTS) continue;
      seen.add(f.claim_id);
      facts.push(f);
    }
  }
  const segments = await nearSegments(question);
  return { entities, facts, segments };
}

function materialLines(graph, facts, segments) {
  const lines = facts.map((f, i) => factLine(graph, f, i + 1));
  segments.forEach((s, i) => {
    lines.push(`[${facts.length + i + 1}] 原文（${unitLabel(graph, s.chapter_no)}「${s.title || ''}」）：${s.text}`);
  });
  return lines.join('\n');
}

/** 同一个问题已经存过回答就直接读，不再调模型 */
export function savedAnswer(question, locale = 'zh') {
  const saved = readJsonFile(answerFile(answerId(locale === 'en' ? 'en' : 'zh', normalize(question))));
  return saved ? { ...saved, saved: true } : null;
}

export async function ask({ question, locale = 'zh', fresh = false }) {
  const q = normalize(question);
  if (q.length < 2) throw Object.assign(new Error('问题太短'), { status: 400, code: 'ask_too_short' });
  if (q.length > 200) throw Object.assign(new Error('问题太长，请控制在 200 字以内'), { status: 400, code: 'ask_too_long' });
  const lang = locale === 'en' ? 'en' : 'zh';
  const id = answerId(lang, q);
  if (!fresh) {
    const saved = savedAnswer(q, lang);
    if (saved) return saved;
  }

  const graph = currentGraph();
  // 实体名和向量模型都是中文的：外文问题先转成中文再检索，作答仍用原语言
  let probe = q;
  if (!/[\u4e00-\u9fff]/.test(q)) {
    const t = await chatJson({
      system: `把学习者关于《${graph.book}》的提问翻成中文，人名、地名、事件名用书中通行的中文写法。只输出 JSON {"zh":""}`,
      user: q,
      maxTokens: 300,
      temperature: 0,
    }).catch(() => null);
    probe = String(t?.zh || '').trim() || q;
  }
  const { entities, facts, segments } = await gather(probe);
  if (!facts.length && !segments.length) {
    throw Object.assign(new Error('图谱里没有找到和这个问题相关的依据，换个说法或点名具体人物试试'), { status: 422, code: 'ask_no_material' });
  }
  const material = [...facts, ...segments];
  const en = lang === 'en';
  const res = await chatJson({
    system: `你是${graph.prompts.role}，回答学习者关于《${graph.book}》的问题，只输出 JSON。
${purposePrompt(graph.id)}
要求：
1. 只依据下面编号的材料作答，不用材料以外的情节、史实或常识；材料里互相矛盾时把两种说法都讲出来。
2. 每个关键陈述后用 [编号] 标出依据，可以连写如 [2][5]；编号只能来自材料。
3. 材料撑不起完整回答时，先讲能确认的部分，再直说哪一部分书里的依据不足。
4. answer 不超过 350 字，先给结论，再按时间或因果讲经过。
5. followups 给 2~3 个顺着这个问题、材料里有线索的追问，每个 ≤20 字。${en ? '\n6. Write answer and followups in English. Keep personal and place names exactly as given (Chinese characters).' : ''}
输出 {"answer":"","followups":[]}`,
    user: `问题：${q}${probe !== q ? `（中文：${probe}）` : ''}${entities.length ? `\n问题点到的实体：${entities.map((e) => e.name).join('、')}` : ''}
材料：
${materialLines(graph, facts, segments)}`,
    maxTokens: 2000,
    temperature: 0.2,
  });
  const { texts, cited } = renumber([res.answer], material);
  const result = {
    id,
    question: q,
    locale: lang,
    answer: texts[0].trim(),
    citations: cited.map((c) => citationOf(graph, c)),
    followups: (Array.isArray(res.followups) ? res.followups : []).map((s) => String(s).trim()).filter(Boolean).slice(0, 3),
    entities: entities.map((e) => ({ id: e.id, name: e.name })),
    material_size: { facts: facts.length, segments: segments.length },
    generated_at: new Date().toISOString(),
  };
  recent.set(`${currentGraphId()}:${id}`, result);
  if (recent.size > RECENT_LIMIT) recent.delete(recent.keys().next().value);
  return { ...result, saved: false };
}

export function saveAnswer(id) {
  const result = recent.get(`${currentGraphId()}:${id}`) || readJsonFile(answerFile(id));
  if (!result) throw Object.assign(new Error('这条回答已过期，请重新提问'), { status: 404, code: 'answer_expired' });
  const saved = { ...result, saved_at: new Date().toISOString() };
  writeJsonFile(answerFile(id), saved);
  return { ...saved, saved: true };
}

export function listAnswers({ locale = 'zh', limit = 50 } = {}) {
  const lang = locale === 'en' ? 'en' : 'zh';
  const items = listJsonFiles(graphFile(currentGraphId(), 'answers'))
    .map((f) => readJsonFile(f))
    .filter((a) => a && a.locale === lang)
    .sort((a, b) => String(b.saved_at).localeCompare(String(a.saved_at)))
    .slice(0, Math.min(Number(limit) || 50, 200))
    .map(({ id, question, answer, saved_at, citations }) => ({
      id, question, saved_at, preview: answer.replace(/\[\d+\]/g, '').slice(0, 80), citation_count: citations.length,
    }));
  return { items };
}

export function getAnswer(id) {
  const saved = readJsonFile(answerFile(id));
  if (!saved) throw Object.assign(new Error('回答不存在'), { status: 404 });
  return { ...saved, saved: true };
}

export function deleteAnswer(id) {
  removeFile(answerFile(id));
  return { id };
}
