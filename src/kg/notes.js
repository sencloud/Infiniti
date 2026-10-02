// 条目解说：从实体最强的若干条事实写一篇带编号引用的短文，写一次存盘，之后直接读。
// 事实集合变了（新入库、核对驳回）就标记为「有更新」，由学习者决定要不要重写。
import crypto from 'node:crypto';
import { chatJson } from './llm.js';
import { unitLabel } from './domains/index.js';
import { purposePrompt } from './domains/purpose.js';
import { currentGraph, currentGraphId, one, rows } from './neo.js';
import { graphFile, readJsonFile, writeJsonFile } from './store.js';

const MAX_CLAIMS = 48;
const PER_EDGE = 2;
const inflight = new Map();

const noteFile = (entityId, locale) => {
  if (!/^[\w-]{1,64}$/.test(String(entityId))) throw Object.assign(new Error('实体编号不合法'), { status: 400 });
  return graphFile(currentGraphId(), 'notes', `${entityId}.${locale === 'en' ? 'en' : 'zh'}.json`);
};

export function basisHash(ids) {
  return crypto.createHash('sha1').update([...ids].sort().join('|')).digest('hex').slice(0, 16);
}

/** 实体全部在用事实的 id（决定解说是否过期） */
async function liveClaimIds(entityId) {
  const r = await one(
    `MATCH (e:Entity {graph_id: $g, entity_id: $id})<-[:SUBJECT|OBJECT]-(c:Claim)
     WHERE coalesce(c.status, '') <> 'rejected'
     RETURN collect(DISTINCT c.claim_id) AS ids`,
    { id: entityId },
  );
  return r?.ids || [];
}

/** 按关系强度挑依据：每条关系最多取两句，强关系在前，覆盖尽量多的对端 */
export async function pickClaims(entityId, max = MAX_CLAIMS) {
  const edges = await rows(
    `MATCH (e:Entity {graph_id: $g, entity_id: $id})-[r:RELATES]-(:Entity)
     RETURN r.claim_ids AS ids, coalesce(r.weight, 0) AS w, coalesce(r.support_count, 0) AS n
     ORDER BY w DESC, n DESC LIMIT 80`,
    { id: entityId },
  );
  const picked = [];
  for (let round = 0; round < PER_EDGE && picked.length < max; round++) {
    for (const e of edges) {
      const id = e.ids?.[round];
      if (id && !picked.includes(id)) picked.push(id);
      if (picked.length >= max) break;
    }
  }
  return claimFacts(picked);
}

/** 事实 id → 可写进提示词的事实（保持传入顺序，跳过已驳回的） */
export async function claimFacts(picked) {
  if (!picked.length) return [];
  const list = await rows(
    `MATCH (s:Entity)<-[:SUBJECT]-(c:Claim {graph_id: $g})-[:OBJECT]->(o:Entity)
     WHERE c.claim_id IN $ids AND coalesce(c.status, '') <> 'rejected'
     RETURN c.claim_id AS claim_id, c.predicate AS predicate, c.evidence_text AS evidence_text,
            c.record_id AS record_id, c.chapter_no AS chapter_no, s.canonical_name AS subject, o.canonical_name AS object`,
    { ids: picked },
  );
  const order = new Map(picked.map((id, i) => [id, i]));
  return list.sort((a, b) => order.get(a.claim_id) - order.get(b.claim_id));
}

export function factLine(graph, c, n) {
  return `[${n}] ${c.subject} ${graph.ontology.predicateName(c.predicate)} ${c.object}（${unitLabel(graph, c.chapter_no)}）：${c.evidence_text}`;
}

/** 把模型用到的编号按出现顺序重排成 1..k，只保留真实存在的编号 */
export function renumber(texts, facts) {
  const map = new Map();
  const swap = (text) => String(text || '').replace(/\[(\d+)\]/g, (m, d) => {
    const fact = facts[Number(d) - 1];
    if (!fact) return '';
    const key = fact.key ?? fact.claim_id;
    if (!map.has(key)) map.set(key, { n: map.size + 1, fact });
    return `[${map.get(key).n}]`;
  });
  const out = texts.map(swap);
  return { texts: out, cited: [...map.values()] };
}

export function citationOf(graph, { n, fact }) {
  if (fact.segment) {
    return {
      n,
      claim_id: '',
      record_id: fact.key,
      chapter_no: fact.chapter_no,
      unit: unitLabel(graph, fact.chapter_no),
      relation: fact.title || '',
      evidence_text: fact.text.slice(0, 140),
    };
  }
  return {
    n,
    claim_id: fact.claim_id,
    record_id: fact.record_id,
    chapter_no: fact.chapter_no,
    unit: unitLabel(graph, fact.chapter_no),
    relation: `${fact.subject} ${graph.ontology.predicateName(fact.predicate)} ${fact.object}`,
    evidence_text: fact.evidence_text,
  };
}

const ANGLES = {
  textbook: '「是什么」「从哪里来（前置与推导）」「用在哪里」',
  default: '「身份与来历」「关键关系」「命运转折」',
};

async function writeNote(entityId, locale) {
  const graph = currentGraph();
  const entity = await one(
    'MATCH (e:Entity {graph_id: $g, entity_id: $id}) RETURN e.canonical_name AS name, e.entity_type AS type, e.description AS description',
    { id: entityId },
  );
  if (!entity) throw Object.assign(new Error('实体不存在'), { status: 404 });
  const facts = await pickClaims(entityId);
  if (facts.length < 2) throw Object.assign(new Error('这个条目的原文依据太少，暂时写不出解说'), { status: 422, code: 'note_too_few' });

  const en = locale === 'en';
  const angles = graph.kind === 'textbook' ? ANGLES.textbook : ANGLES.default;
  const res = await chatJson({
    system: `你是${graph.prompts.role}，为学习者写《${graph.book}》里「${entity.name}」的条目解说，只输出 JSON。
${purposePrompt(graph.id)}
要求：
1. 只依据下面编号的原文依据，不补充依据之外的情节、史实或常识。
2. 每个关键陈述后用 [编号] 标出依据，可以连写如 [2][5]；编号只能来自给出的列表。
3. summary 用一句话说清 TA 在书里是谁、最重要的一两层关系（≤50字），也要带编号。
4. sections 写 2~4 段，每段 title ≤8 字、text 80~180 字，可以从${angles}这类角度组织；依据撑不起来的角度就不写。
5. 语气平实，像给同学讲书，不用「本文」「综上」之类的套话。${en ? '\n6. Write summary and sections in English. Keep personal and place names exactly as given (Chinese characters); do not invent pinyin.' : ''}
输出 {"summary":"","sections":[{"title":"","text":""}]}`,
    user: `条目：${entity.name}（${graph.ontology.ENTITY_TYPES.find((t) => t.code === entity.type)?.name || entity.type}）${entity.description ? `\n已有简介：${entity.description}` : ''}
原文依据：
${facts.map((c, i) => factLine(graph, c, i + 1)).join('\n')}`,
    maxTokens: 2400,
    temperature: 0.3,
  });

  const sections = (Array.isArray(res.sections) ? res.sections : [])
    .map((s) => ({ title: String(s?.title || '').trim().slice(0, 16), text: String(s?.text || '').trim() }))
    .filter((s) => s.text)
    .slice(0, 4);
  const { texts, cited } = renumber([res.summary, ...sections.map((s) => s.text)], facts);
  if (!cited.length) throw new Error('模型没有给出可核对的引用，请重试');
  const note = {
    entity_id: entityId,
    name: entity.name,
    locale: en ? 'en' : 'zh',
    summary: texts[0],
    sections: sections.map((s, i) => ({ ...s, text: texts[i + 1] })),
    citations: cited.map((c) => citationOf(graph, c)),
    basis: basisHash(await liveClaimIds(entityId)),
    basis_size: facts.length,
    generated_at: new Date().toISOString(),
  };
  writeJsonFile(noteFile(entityId, locale), note);
  return note;
}

export async function getNote(entityId, locale = 'zh') {
  const note = readJsonFile(noteFile(entityId, locale));
  if (!note) return { note: null, stale: false };
  const stale = basisHash(await liveClaimIds(entityId)) !== note.basis;
  return { note, stale };
}

export async function generateNote(entityId, locale = 'zh') {
  const key = `${currentGraphId()}:${entityId}:${locale}`;
  if (!inflight.has(key)) {
    inflight.set(key, writeNote(entityId, locale).finally(() => inflight.delete(key)));
  }
  return { note: await inflight.get(key), stale: false };
}
