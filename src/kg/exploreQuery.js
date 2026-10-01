// 关系探索查询：语义图 / 实体搜索 / 邻域展开 / 实体详情与出处 / 事实详情 / 原文证据
// 全部按当前图谱（$g）过滤；entity_id / claim_id 本身已带图谱前缀，全局唯一。
import { PUBLISHED_STATUSES } from './ontology.js';
import { unitLabel } from './domains/index.js';
import { currentGraph, int, one, parseJsonField, rows } from './neo.js';

const chapterLabel = (no) => unitLabel(currentGraph(), no);
// 单元 ch-003 与片段 s-003-07 都能定位到单元序号
const recordToChapter = (recordId) => Number(String(recordId).match(/^(?:ch|s)-(\d+)/)?.[1] ?? recordId);
const predicateName = (code) => currentGraph().ontology.predicateName(code);

function toNode(e) {
  const { embedding, ...props } = e;
  return { id: e.entity_id, label: e.entity_type, name: e.canonical_name, properties: props };
}

function toEdge(r, src, dst) {
  return {
    id: `${src}::${r.predicate}::${dst}`,
    source: src,
    target: dst,
    type: r.predicate,
    label: predicateName(r.predicate),
    confidence: r.confidence,
    support_count: r.support_count,
    claim_ids: r.claim_ids,
    weight: r.weight ?? null,
    chapters: r.chapters || [],
    first_chapter: r.first_chapter,
    last_chapter: r.last_chapter,
  };
}

async function edgesAmong(ids, minConfidence = 0, predicates = []) {
  const list = await rows(
    `MATCH (s:Entity {graph_id: $g})-[r:RELATES]->(o:Entity)
     WHERE s.entity_id IN $ids AND o.entity_id IN $ids AND r.confidence >= $minc
       AND (size($preds) = 0 OR r.predicate IN $preds)
     RETURN s.entity_id AS src, o.entity_id AS dst, r AS r`,
    { ids, minc: Number(minConfidence) || 0, preds: predicates },
  );
  return list.map(({ src, dst, r }) => toEdge(r, src, dst));
}

export async function semanticGraph({ entity_id, depth = 1, limit = 300, min_confidence = 0, predicate = [] }) {
  const lim = Math.min(Number(limit) || 300, 2000);
  const preds = [].concat(predicate || []).filter(Boolean);
  let nodes;
  if (entity_id) {
    const center = await rows('MATCH (e:Entity {graph_id: $g, entity_id: $id}) RETURN e', { id: entity_id });
    if (!center.length) return { nodes: [], edges: [] };
    nodes = [...center];
    const seen = new Set([entity_id]);
    let frontier = [entity_id];
    // 逐层外扩，每层按关联强度取前若干，避免枢纽实体把邻域撑爆
    for (let hop = 0; hop < Math.min(Math.max(Number(depth) || 1, 1), 2) && nodes.length < lim; hop++) {
      const layer = await rows(
        `MATCH (c:Entity {graph_id: $g})-[r:RELATES]-(n:Entity)
         WHERE c.entity_id IN $frontier AND NOT n.entity_id IN $seen
         WITH n, sum(coalesce(r.weight, 0.5)) AS w
         RETURN n AS e ORDER BY w DESC LIMIT $room`,
        { frontier, seen: [...seen], room: int(lim - nodes.length) },
      );
      frontier = layer.map((r) => r.e.entity_id);
      frontier.forEach((id) => seen.add(id));
      nodes.push(...layer);
      if (!frontier.length) break;
    }
  } else {
    // 全景：按枢纽分 / 事实数取最核心的一批实体
    nodes = await rows(
      `MATCH (e:Entity {graph_id: $g}) WHERE e.claim_count > 0
       RETURN e ORDER BY coalesce(e.hub_score, 0) DESC, e.claim_count DESC LIMIT $lim`,
      { lim: int(lim) },
    );
  }
  const ids = nodes.map((n) => n.e.entity_id);
  const edges = await edgesAmong(ids, min_confidence, preds);
  return { nodes: nodes.map((n) => toNode(n.e)), edges };
}

export async function entityNeighbors(entityId, { limit = 300, min_confidence = 0 }) {
  const list = await rows(
    `MATCH (c:Entity {graph_id: $g, entity_id: $id})-[r:RELATES]-(n:Entity)
     WHERE r.confidence >= $minc
     WITH n, sum(coalesce(r.weight, 0.5)) AS w
     RETURN n ORDER BY w DESC LIMIT $lim`,
    { id: entityId, minc: Number(min_confidence) || 0, lim: int(Math.min(Number(limit) || 300, 1000)) },
  );
  const center = await one('MATCH (e:Entity {graph_id: $g, entity_id: $id}) RETURN e', { id: entityId });
  if (!center) return { nodes: [], edges: [] };
  const ids = [entityId, ...list.map((r) => r.n.entity_id)];
  const edges = await rows(
    `MATCH (s:Entity {graph_id: $g})-[r:RELATES]->(o:Entity)
     WHERE (s.entity_id = $id AND o.entity_id IN $ids) OR (o.entity_id = $id AND s.entity_id IN $ids)
     RETURN s.entity_id AS src, o.entity_id AS dst, r AS r`,
    { id: entityId, ids },
  );
  return {
    nodes: [toNode(center.e), ...list.map((r) => toNode(r.n))],
    edges: edges.map(({ src, dst, r }) => toEdge(r, src, dst)),
  };
}

/** 搜索结果里的一句话身份：水浒好汉显示座次星号，其它显示身份/简介 */
function entityTitle(e) {
  if (e.rank && e.star) return `第${e.rank}位 ${e.star}${e.nickname ? ` · ${e.nickname}` : ''}`;
  return [e.nickname, e.role].filter(Boolean).join(' · ') || e.description || '';
}

export async function searchEntities({ keyword = '', type = '', page = 1, page_size = 20 }) {
  const size = Math.min(Number(page_size) || 20, 200);
  const skip = (Math.max(Number(page) || 1, 1) - 1) * size;
  const kw = String(keyword || '').trim();
  const params = { kw, type, skip: int(skip), size: int(size) };
  const where = `($type = '' OR e.entity_type = $type)
    AND ($kw = '' OR e.canonical_name CONTAINS $kw OR any(a IN coalesce(e.aliases, []) WHERE a CONTAINS $kw)
         OR coalesce(e.nickname, '') CONTAINS $kw)`;
  const total = (await one(`MATCH (e:Entity {graph_id: $g}) WHERE ${where} RETURN count(e) AS n`, params))?.n || 0;
  const list = await rows(
    `MATCH (e:Entity {graph_id: $g}) WHERE ${where}
     OPTIONAL MATCH (e)-[:RELATES]->(org:Entity {entity_type: 'Organization'})
     WITH e, collect(DISTINCT org.canonical_name)[0..3] AS orgs
     RETURN e, orgs
     ORDER BY CASE WHEN e.canonical_name = $kw THEN 0 WHEN e.canonical_name STARTS WITH $kw THEN 1 ELSE 2 END,
              coalesce(e.rank, 999), e.claim_count DESC
     SKIP $skip LIMIT $size`,
    params,
  );
  return {
    items: list.map(({ e, orgs }) => ({
      entity_id: e.entity_id,
      entity_type: e.entity_type,
      canonical_name: e.canonical_name,
      normalized_name: e.normalized_name,
      aliases: e.aliases || [],
      identity_hint: [e.star, e.nickname].filter(Boolean).join(' '),
      claim_count: e.claim_count || 0,
      title: entityTitle(e),
      organizations: orgs,
      rank: e.rank ?? null,
      nickname: e.nickname || '',
      first_chapter: e.first_chapter,
      last_chapter: e.last_chapter,
      avatar: parseJsonField(e.media, null)?.avatar || null,
    })),
    total,
    page: Number(page) || 1,
    page_size: size,
  };
}

export async function getEntity(entityId) {
  const r = await one(
    `MATCH (e:Entity {graph_id: $g, entity_id: $id})
     OPTIONAL MATCH (e)-[:RELATES]-(n:Entity)
     RETURN e, count(DISTINCT n) AS degree`,
    { id: entityId },
  );
  if (!r) throw Object.assign(new Error('实体不存在'), { status: 404 });
  const { embedding, ...props } = r.e;
  return { ...props, media: parseJsonField(props.media, null), degree: r.degree };
}

export async function entitySources(entityId, limit = 20) {
  const list = await rows(
    `MATCH (e:Entity {graph_id: $g, entity_id: $id})-[a:APPEARS_IN]->(c:Chapter)
     OPTIONAL MATCH (c)-[:SUPPORTS]->(cl:Claim)-[:SUBJECT|OBJECT]->(e)
     WITH c, a, collect(DISTINCT cl) AS claims
     RETURN c.no AS no, c.title AS title, a.count AS mentions, size(claims) AS claim_count,
            [x IN claims | x.evidence_text][0..3] AS evidence
     ORDER BY claim_count DESC, mentions DESC LIMIT $limit`,
    { id: entityId, limit: int(limit) },
  );
  const e = await one('MATCH (e:Entity {graph_id: $g, entity_id: $id}) RETURN e.canonical_name AS name, e.aliases AS aliases', { id: entityId });
  return {
    entity_id: entityId,
    items: list
      .sort((a, b) => a.no - b.no)
      .map((r) => ({
        record_id: `ch-${String(r.no).padStart(3, '0')}`,
        chapter_no: r.no,
        title: `${chapterLabel(r.no)} ${r.title}`,
        category_code: chapterLabel(r.no),
        creation_date: '',
        responsible_person: '',
        mention_texts: [e?.name, ...(e?.aliases || [])].filter(Boolean).slice(0, 4),
        mention_count: r.mentions,
        claim_count: r.claim_count,
        evidence_texts: r.evidence.filter(Boolean),
      })),
  };
}

function toClaim(r) {
  return {
    claim_id: r.c.claim_id,
    predicate: r.c.predicate,
    confidence: r.c.confidence,
    evidence_text: r.c.evidence_text,
    status: r.c.status,
    record_id: r.c.record_id,
    chapter_no: r.c.chapter_no,
    archive_title: `${chapterLabel(r.c.chapter_no)} ${r.title || ''}`.trim(),
    subject: { entity_id: r.s.entity_id, name: r.s.canonical_name, type: r.s.entity_type },
    object: { entity_id: r.o.entity_id, name: r.o.canonical_name, type: r.o.entity_type },
  };
}

const CLAIM_RETURN = `MATCH (s:Entity)<-[:SUBJECT]-(c)-[:OBJECT]->(o:Entity)
  OPTIONAL MATCH (ch:Chapter)-[:SUPPORTS]->(c)
  RETURN c, s, o, ch.title AS title`;

export async function claimsByIds(ids) {
  const list = await rows(
    `MATCH (c:Claim {graph_id: $g}) WHERE c.claim_id IN $ids ${CLAIM_RETURN} ORDER BY c.chapter_no`,
    { ids: [].concat(ids || []).slice(0, 500) },
  );
  return { items: list.map(toClaim) };
}

export async function listClaims({ status = '', keyword = '', page = 1, page_size = 20 }) {
  const size = Math.min(Number(page_size) || 20, 200);
  const params = { status, kw: String(keyword || ''), skip: int((Math.max(Number(page) || 1, 1) - 1) * size), size: int(size) };
  const where = `($status = '' OR c.status = $status) AND ($kw = '' OR c.evidence_text CONTAINS $kw)`;
  const total = (await one(`MATCH (c:Claim {graph_id: $g}) WHERE ${where} RETURN count(c) AS n`, params))?.n || 0;
  const list = await rows(`MATCH (c:Claim {graph_id: $g}) WHERE ${where} WITH c ORDER BY c.chapter_no SKIP $skip LIMIT $size ${CLAIM_RETURN}`, params);
  return { items: list.map(toClaim), total, page: Number(page) || 1, page_size: size };
}

/** 单元原文：高亮该单元所有关系事实的证据句；教材类附带页码与页面原图 */
export async function chapterEvidence(recordId) {
  const no = recordToChapter(recordId);
  const ch = await one('MATCH (c:Chapter {graph_id: $g, no: $no}) RETURN c', { no: int(no) });
  if (!ch) throw Object.assign(new Error(`${currentGraph().unit.name}不存在`), { status: 404 });
  const text = ch.c.text;
  const list = await rows(`MATCH (:Chapter {graph_id: $g, no: $no})-[:SUPPORTS]->(c:Claim) ${CLAIM_RETURN}`, { no: int(no) });
  const claims = list.map(toClaim).map((cl) => {
    const ev = cl.evidence_text || '';
    const start = ev ? text.indexOf(ev) : -1;
    return {
      ...cl,
      evidence_start: start >= 0 ? start : undefined,
      evidence_end: start >= 0 ? start + ev.length : undefined,
      offset_valid: start >= 0,
      text_matches: start >= 0,
    };
  });
  const seg = /^s-/.test(String(recordId))
    ? await one('MATCH (s:Segment {graph_id: $g, seg_id: $id}) RETURN s.text AS text, s.page AS page', { id: String(recordId) })
    : null;
  const label = chapterLabel(no);
  const head = String(ch.c.title || '').split(/\s+/)[0];
  return {
    record_id: recordId,
    chapter_no: no,
    // 教材标签「八上·3.1」已含节号，标题里的「3.1」不再重复
    title: head && label.endsWith(head) ? ch.c.title.slice(head.length).trim() : ch.c.title,
    archive_number: label,
    media: parseJsonField(ch.c.media, null),
    content: text,
    url: ch.c.url,
    focus_text: seg?.text || '',
    focus_page: seg?.page ?? null,
    pages: parseJsonField(ch.c.pages, []),
    claims,
  };
}

export async function stats() {
  const s = await one(
    `CALL { MATCH (c:Chapter {graph_id: $g}) RETURN count(c) AS chapters }
     CALL { MATCH (e:Entity {graph_id: $g}) RETURN count(e) AS entities }
     CALL { MATCH (c:Claim {graph_id: $g}) RETURN count(c) AS claims }
     CALL { MATCH (:Entity {graph_id: $g})-[a:APPEARS_IN]->() RETURN count(a) AS mentions }
     RETURN chapters, entities, claims, mentions`,
  );
  const types = await rows('MATCH (e:Entity {graph_id: $g}) RETURN e.entity_type AS type, count(*) AS count ORDER BY count DESC');
  const preds = await rows('MATCH (c:Claim {graph_id: $g}) RETURN c.predicate AS predicate, c.status AS status, count(*) AS count ORDER BY count DESC');
  return {
    neo4j_mode: true,
    ontology_version: currentGraph().ontology.version,
    summary: {
      archives: s.chapters,
      entities: s.entities,
      mentions: s.mentions,
      claims: s.claims,
      published_claims: s.claims,
      proposed_claims: 0,
      tag_links: 0,
      tagged_entities: 0,
      tag_only_entities: 0,
    },
    entity_types: types,
    predicates: preds,
  };
}

export const ontologyPayload = () => currentGraph().ontology.payload();
export { PUBLISHED_STATUSES };
