// 待核对队列：把最可能抽错的事实挑出来给人看一眼，人只能做三件事——确认、驳回、跳过。
// 决定写到 data/<graph>/review.json，立即改库；重新入库时 load.js 按同一份文件重放。
import { unitLabel } from './domains/index.js';
import { currentGraph, currentGraphId, exec, one, rows } from './neo.js';
import { graphFile, readJsonFile, writeJsonFile } from './store.js';

export const REVIEW_REASONS = ['unmatched', 'conflict', 'low'];
const LOW_CONFIDENCE = 0.75;
const ACTIONS = new Set(['confirm', 'reject', 'skip', 'reset']);

const reviewFile = (graphId = currentGraphId()) => graphFile(graphId, 'review.json');

export function loadDecisions(graphId = currentGraphId()) {
  return readJsonFile(reviewFile(graphId), { decisions: {} }).decisions || {};
}

function saveDecisions(decisions) {
  writeJsonFile(reviewFile(), { updated_at: new Date().toISOString(), decisions });
}

const squash = (s) => s.replace(/[\s\p{P}\p{S}]/gu, '');

/** 证据句跨了换行、标点写法不同，或用「……」省略了中间部分：去掉空白标点后每一截都在原文里，就算对得上 */
function locatable(flat, evidence) {
  const parts = evidence.split(/…+|\.{3,}/).map(squash).filter((p) => p.length >= 2);
  return parts.length > 0 && parts.every((p) => flat.includes(p));
}

async function unmatchedClaims() {
  const misses = await rows(
    `MATCH (ch:Chapter {graph_id: $g})-[:SUPPORTS]->(c:Claim)
     WHERE c.status = 'auto_verified' AND c.evidence_text <> '' AND NOT ch.text CONTAINS c.evidence_text
     RETURN c.claim_id AS id, c.evidence_text AS ev, ch.no AS no`,
  );
  if (!misses.length) return [];
  const texts = new Map((await rows(
    'MATCH (ch:Chapter {graph_id: $g}) WHERE ch.no IN $nos RETURN ch.no AS no, ch.text AS text',
    { nos: [...new Set(misses.map((m) => m.no))] },
  )).map((r) => [r.no, r.text || '']));
  const flat = new Map();
  return misses.filter((m) => {
    if (!flat.has(m.no)) flat.set(m.no, squash(texts.get(m.no) || ''));
    return !locatable(flat.get(m.no), m.ev);
  });
}

/** 三类候选的 claim_id：原文里找不到证据句 / 单值关系有多种说法 / 低置信 */
async function candidates() {
  const functional = currentGraph().ontology.PREDICATES.filter((p) => p.functional).map((p) => p.code);
  const [unmatched, conflict, low] = await Promise.all([
    unmatchedClaims(),
    functional.length ? rows(
      `MATCH (s:Entity {graph_id: $g})<-[:SUBJECT]-(c:Claim)-[:OBJECT]->(o:Entity)
       WHERE c.predicate IN $preds AND coalesce(c.status, '') <> 'rejected'
       WITH s, c.predicate AS p, collect(DISTINCT o.entity_id) AS objs, collect(c) AS cs
       WHERE size(objs) > 1
       UNWIND cs AS c WITH c WHERE c.status = 'auto_verified'
       RETURN c.claim_id AS id`,
      { preds: functional },
    ) : [],
    rows(
      `MATCH (c:Claim {graph_id: $g}) WHERE c.status = 'auto_verified' AND c.confidence < $low RETURN c.claim_id AS id`,
      { low: LOW_CONFIDENCE },
    ),
  ]);
  const reasons = new Map();
  const add = (list, reason) => {
    for (const { id } of list) {
      if (!reasons.has(id)) reasons.set(id, []);
      reasons.get(id).push(reason);
    }
  };
  add(unmatched, 'unmatched');
  add(conflict, 'conflict');
  add(low, 'low');
  return reasons;
}

export async function reviewQueue({ reason = '', limit = 20, offset = 0 } = {}) {
  const graph = currentGraph();
  const decisions = loadDecisions();
  const all = await candidates();
  const open = [...all].filter(([id]) => !decisions[id]);
  const counts = Object.fromEntries(REVIEW_REASONS.map((r) => [r, open.filter(([, rs]) => rs.includes(r)).length]));
  const picked = open
    .filter(([, rs]) => !reason || rs.includes(reason))
    .sort((a, b) => b[1].length - a[1].length
      || REVIEW_REASONS.indexOf(a[1][0]) - REVIEW_REASONS.indexOf(b[1][0])
      || a[0].localeCompare(b[0]));
  const page = picked.slice(Number(offset) || 0, (Number(offset) || 0) + Math.min(Number(limit) || 20, 100));
  const details = page.length ? await rows(
    `MATCH (s:Entity)<-[:SUBJECT]-(c:Claim {graph_id: $g})-[:OBJECT]->(o:Entity)
     WHERE c.claim_id IN $ids
     OPTIONAL MATCH (ch:Chapter)-[:SUPPORTS]->(c)
     RETURN c, s.entity_id AS sid, s.canonical_name AS sname, s.entity_type AS stype,
            o.entity_id AS oid, o.canonical_name AS oname, o.entity_type AS otype, ch.title AS title`,
    { ids: page.map(([id]) => id) },
  ) : [];
  const byId = new Map(details.map((d) => [d.c.claim_id, d]));
  const decided = Object.values(decisions);
  return {
    items: page.map(([id, rs]) => {
      const d = byId.get(id);
      if (!d) return null;
      return {
        claim_id: id,
        reasons: rs,
        predicate: d.c.predicate,
        predicate_name: graph.ontology.predicateName(d.c.predicate),
        confidence: d.c.confidence,
        evidence_text: d.c.evidence_text,
        record_id: d.c.record_id,
        chapter_no: d.c.chapter_no,
        unit: unitLabel(graph, d.c.chapter_no),
        archive_title: d.title || '',
        subject: { entity_id: d.sid, name: d.sname, type: d.stype },
        object: { entity_id: d.oid, name: d.oname, type: d.otype },
      };
    }).filter(Boolean),
    total: picked.length,
    counts,
    decided: {
      confirm: decided.filter((d) => d.action === 'confirm').length,
      reject: decided.filter((d) => d.action === 'reject').length,
      skip: decided.filter((d) => d.action === 'skip').length,
    },
  };
}

/** 驳回：事实标为 rejected，并从聚合边里摘掉；边上没有事实了就删边 */
async function applyReject(claimId) {
  await exec(
    `MATCH (s:Entity)<-[:SUBJECT]-(c:Claim {graph_id: $g, claim_id: $id})-[:OBJECT]->(o:Entity)
     SET c.status = 'rejected'
     WITH c, s, o
     MATCH (s)-[r:RELATES {predicate: c.predicate}]->(o) WHERE $id IN r.claim_ids
     WITH r, [x IN r.claim_ids WHERE x <> $id] AS rest
     SET r.claim_ids = rest, r.support_count = size(rest)
     WITH r, rest WHERE size(rest) = 0
     DELETE r`,
    { id: claimId },
  );
  await exec(
    `MATCH (e:Entity {graph_id: $g})<-[:SUBJECT|OBJECT]-(c:Claim {claim_id: $id})
     SET e.claim_count = CASE WHEN coalesce(e.claim_count, 0) > 0 THEN e.claim_count - 1 ELSE 0 END`,
    { id: claimId },
  );
}

/** 撤销驳回：把事实挂回聚合边（边已删就按这一条事实重建） */
async function restoreRejected(claimId) {
  const graph = currentGraph();
  const c = await one(
    `MATCH (c:Claim {graph_id: $g, claim_id: $id}) RETURN c.predicate AS p, c.confidence AS conf, c.chapter_no AS ch`,
    { id: claimId },
  );
  if (!c) return;
  await exec(
    `MATCH (s:Entity)<-[:SUBJECT]-(c:Claim {graph_id: $g, claim_id: $id})-[:OBJECT]->(o:Entity)
     SET c.status = 'auto_verified'
     MERGE (s)-[r:RELATES {predicate: c.predicate}]->(o)
     ON CREATE SET r.type = $type, r.claim_ids = [], r.confidence = c.confidence, r.chapters = [c.chapter_no],
                   r.first_chapter = c.chapter_no, r.last_chapter = c.chapter_no
     SET r.claim_ids = CASE WHEN $id IN r.claim_ids THEN r.claim_ids ELSE r.claim_ids + $id END
     SET r.support_count = size(r.claim_ids)`,
    { id: claimId, type: graph.ontology.predicateName(c.p) },
  );
  await exec(
    `MATCH (e:Entity {graph_id: $g})<-[:SUBJECT|OBJECT]-(c:Claim {claim_id: $id})
     SET e.claim_count = coalesce(e.claim_count, 0) + 1`,
    { id: claimId },
  );
}

export async function decide(claimId, action, note = '') {
  if (!ACTIONS.has(action)) throw Object.assign(new Error(`未知操作：${action}`), { status: 400 });
  const exists = await one('MATCH (c:Claim {graph_id: $g, claim_id: $id}) RETURN c.status AS status', { id: claimId });
  if (!exists) throw Object.assign(new Error('事实不存在'), { status: 404 });
  const decisions = loadDecisions();
  const prev = decisions[claimId]?.action;

  if (prev === 'reject' && action !== 'reject') await restoreRejected(claimId);
  if (action === 'reset') {
    delete decisions[claimId];
    await exec("MATCH (c:Claim {graph_id: $g, claim_id: $id}) SET c.status = 'auto_verified'", { id: claimId });
  } else {
    decisions[claimId] = { action, at: new Date().toISOString(), ...(note ? { note: String(note).slice(0, 200) } : {}) };
    if (action === 'reject' && prev !== 'reject') await applyReject(claimId);
    if (action === 'confirm') await exec("MATCH (c:Claim {graph_id: $g, claim_id: $id}) SET c.status = 'human_verified'", { id: claimId });
    if (action === 'skip') await exec("MATCH (c:Claim {graph_id: $g, claim_id: $id}) SET c.status = 'auto_verified'", { id: claimId });
  }
  saveDecisions(decisions);
  return { claim_id: claimId, action: action === 'reset' ? null : action };
}
