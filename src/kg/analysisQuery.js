// 关系探索「找线索」查询：边强度 / 枢纽 / 社区与桥接 / 事件台账 / 线索 / 两实体路径
// 全部按当前图谱（$g）过滤。
import { unitLabel } from './domains/index.js';
import { currentGraph, int, one, parseJsonField, rows } from './neo.js';

const chapterLabel = (no) => unitLabel(currentGraph(), no);
const predicateName = (code) => currentGraph().ontology.predicateName(code);

export async function edgeMetrics(keys) {
  const parsed = keys.map((k) => k.split('::')).filter((p) => p.length === 3);
  if (!parsed.length) return { items: {} };
  const list = await rows(
    `UNWIND $keys AS k
     MATCH (s:Entity {graph_id: $g, entity_id: k[0]})-[r:RELATES {predicate: k[1]}]->(o:Entity {entity_id: k[2]})
     RETURN k[0] + '::' + k[1] + '::' + k[2] AS edge_key, s.entity_id AS src, o.entity_id AS dst, r AS r`,
    { keys: parsed },
  );
  const items = {};
  for (const { edge_key, src, dst, r } of list) {
    items[edge_key] = {
      edge_key,
      src_entity_id: src,
      predicate: r.predicate,
      dst_entity_id: dst,
      claim_count: r.claim_count ?? r.support_count,
      archive_count: r.archive_count ?? (r.chapters || []).length,
      co_mention: r.co_mention ?? 0,
      confidence_max: r.confidence,
      confidence_avg: r.confidence_avg ?? r.confidence,
      first_year: r.first_chapter,
      last_year: r.last_chapter,
      weight: r.weight ?? 0.5,
      sample_claim_ids: (r.claim_ids || []).slice(0, 5),
    };
  }
  return { items };
}

export async function hubs(entityType = '', limit = 30) {
  const list = await rows(
    `MATCH (e:Entity {graph_id: $g}) WHERE e.hub_score IS NOT NULL AND ($type = '' OR e.entity_type = $type)
     RETURN e ORDER BY e.hub_score DESC LIMIT $limit`,
    { type: entityType || '', limit: int(limit) },
  );
  return {
    items: list.map(({ e }, i) => ({
      entity_id: e.entity_id,
      canonical_name: e.canonical_name,
      entity_type: e.entity_type,
      community_id: e.community_id ?? -1,
      weighted_degree: Number((e.weighted_degree || 0).toFixed(3)),
      community_span: e.community_span || 0,
      hub_score: e.hub_score,
      rank_no: i + 1,
    })),
  };
}

export async function communities(limit = 200) {
  const list = await rows('MATCH (c:Community {graph_id: $g}) RETURN c ORDER BY c.size DESC LIMIT $limit', { limit: int(limit) });
  return {
    items: list.map(({ c }) => {
      const { member_ids, ...rest } = c;
      return {
        ...rest,
        top_entities: parseJsonField(c.top_entities, []),
        top_predicates: parseJsonField(c.top_predicates, []),
      };
    }),
  };
}

export async function communityBridges(key, limit = 30) {
  const list = await rows(
    `MATCH (b:CommunityBridge {graph_id: $g}) WHERE b.src_community_key = $key OR b.dst_community_key = $key
     MATCH (s:Entity {graph_id: $g, entity_id: b.src_entity_id}), (o:Entity {graph_id: $g, entity_id: b.dst_entity_id})
     RETURN b, s.canonical_name AS src_name, o.canonical_name AS dst_name
     ORDER BY b.weight DESC LIMIT $limit`,
    { key, limit: int(limit) },
  );
  return { items: list.map(({ b, src_name, dst_name }) => ({ ...b, src_name, dst_name })) };
}

export async function communityMembers(ids) {
  const list = await rows(
    'MATCH (e:Entity {graph_id: $g}) WHERE e.entity_id IN $ids AND e.community_key IS NOT NULL RETURN e.entity_id AS id, e.community_key AS k',
    { ids },
  );
  return { items: Object.fromEntries(list.map((r) => [r.id, r.k])) };
}

/** 事件台账：锚点实体参与的全部事实，按章回排序（章回即小说的时间轴） */
export async function timeline(anchorId, from = 0, to = 0, limit = 500) {
  const list = await rows(
    `MATCH (a:Entity {graph_id: $g, entity_id: $id})<-[:SUBJECT|OBJECT]-(c:Claim)
     WHERE ($from = 0 OR c.chapter_no >= $from) AND ($to = 0 OR c.chapter_no <= $to)
     MATCH (s:Entity)<-[:SUBJECT]-(c)-[:OBJECT]->(o:Entity)
     RETURN DISTINCT c, s.entity_id AS src, o.entity_id AS dst
     ORDER BY c.chapter_no, c.claim_id LIMIT $limit`,
    { id: anchorId, from: int(from), to: int(to), limit: int(limit) },
  );
  return {
    items: list.map(({ c, src, dst }, i) => ({
      id: i + 1,
      src_entity_id: src,
      dst_entity_id: dst,
      predicate: c.predicate,
      event_year: c.chapter_no,
      event_month: 0,
      event_source: 'event',
      doc_date: '',
      claim_id: c.claim_id,
      record_id: c.record_id,
      archive_number: chapterLabel(c.chapter_no),
      evidence_text: c.evidence_text,
      confidence: c.confidence,
    })),
    total: list.length,
  };
}

export async function timelineSpan() {
  const r = await one('MATCH (c:Claim {graph_id: $g}) RETURN min(c.chapter_no) AS min_year, max(c.chapter_no) AS max_year, count(c) AS rows_total');
  return r || { min_year: 0, max_year: 0, rows_total: 0 };
}

export async function anomalies({ rule_code = '', severity = '', anchor_id = '', limit = 50, offset = 0 }) {
  const params = { rule: rule_code || '', sev: severity || '', anchor: anchor_id || '', limit: int(limit), offset: int(offset) };
  const where = `($rule = '' OR a.rule_code = $rule) AND ($sev = '' OR a.severity = $sev)
    AND ($anchor = '' OR a.anchor_entity_id = $anchor)`;
  const total = (await one(`MATCH (a:Anomaly {graph_id: $g}) WHERE ${where} RETURN count(a) AS n`, params))?.n || 0;
  const list = await rows(
    `MATCH (a:Anomaly {graph_id: $g}) WHERE ${where}
     RETURN a ORDER BY CASE a.severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, a.rule_code, a.anchor_name
     SKIP $offset LIMIT $limit`,
    params,
  );
  return {
    items: list.map(({ a }) => ({ ...a, detail: parseJsonField(a.detail, {}) })),
    total,
    limit: Number(limit),
    offset: Number(offset),
  };
}

export async function coverage() {
  const r = await one(
    `CALL { MATCH (e:Entity {graph_id: $g}) RETURN count(e) AS entities, count(e.first_chapter) AS with_year }
     CALL { MATCH (c:Claim {graph_id: $g}) RETURN count(c) AS claims }
     RETURN entities, with_year, claims`,
  );
  return {
    entities: r.entities,
    entities_with_year: r.with_year,
    year_coverage: r.entities ? r.with_year / r.entities : 0,
    timeline_rows: r.claims,
    timeline_event_rows: r.claims,
  };
}

/** 两实体之间的最短关系路径，每跳挑最强的一条事实作证据 */
export async function paths(fromId, toId, maxHops = 3, maxPaths = 3) {
  const hops = Math.min(Math.max(Number(maxHops) || 3, 1), 4);
  const ends = await rows(
    'MATCH (e:Entity {graph_id: $g}) WHERE e.entity_id IN [$a, $b] RETURN e.entity_id AS id, e.canonical_name AS name, e.entity_type AS label',
    { a: fromId, b: toId },
  );
  const from = ends.find((e) => e.id === fromId);
  const to = ends.find((e) => e.id === toId);
  const empty = (reason) => ({
    found: false, reason, from: from || { id: fromId, name: '', label: '' }, to: to || { id: toId, name: '', label: '' },
    max_hops: hops, truncated: false, paths: [],
  });
  if (!from || !to) return empty('实体不存在');
  if (fromId === toId) return empty('起点和终点是同一个实体');

  const found = await rows(
    `MATCH (a:Entity {graph_id: $g, entity_id: $a}), (b:Entity {graph_id: $g, entity_id: $b})
     MATCH p = allShortestPaths((a)-[:RELATES*..${hops}]-(b))
     RETURN [n IN nodes(p) | n.entity_id] AS ids, [n IN nodes(p) | n.canonical_name] AS names,
            [n IN nodes(p) | n.entity_type] AS types,
            [r IN relationships(p) | {src: startNode(r).entity_id, dst: endNode(r).entity_id, predicate: r.predicate,
              weight: coalesce(r.weight, 0.5), confidence: r.confidence, claim_ids: r.claim_ids}] AS rels
     LIMIT 200`,
    { a: fromId, b: toId },
  );
  if (!found.length) return empty(`${hops} 跳以内没有找到关系路径`);

  // 同一节点序列可能有多条平行边，按节点序列合并后取每跳权重最高的边
  const byNodes = new Map();
  for (const p of found) {
    const key = p.ids.join('>');
    const prev = byNodes.get(key);
    if (!prev) {
      byNodes.set(key, { ...p, rels: p.rels.map((r) => [r]) });
    } else {
      p.rels.forEach((r, i) => prev.rels[i].push(r));
    }
  }
  const candidates = [...byNodes.values()].map((p) => {
    const best = p.rels.map((alts) => alts.sort((x, y) => y.weight - x.weight)[0]);
    const score = best.reduce((s, r) => s + r.weight, 0) / best.length;
    return { ...p, best, score };
  }).sort((a, b) => b.score - a.score);
  const picked = candidates.slice(0, Math.min(Number(maxPaths) || 3, 10));

  const claimIds = picked.flatMap((p) => p.best.map((r) => r.claim_ids[0]));
  const claims = new Map((await rows(
    `MATCH (c:Claim {graph_id: $g}) WHERE c.claim_id IN $ids OPTIONAL MATCH (ch:Chapter)-[:SUPPORTS]->(c)
     RETURN c, ch.title AS title`,
    { ids: claimIds },
  )).map((r) => [r.c.claim_id, r]));

  const graphNodes = new Map();
  const graphEdges = new Map();
  const result = picked.map((p) => {
    p.ids.forEach((id, i) => graphNodes.set(id, { id, name: p.names[i], label: p.types[i], is_root: id === fromId || id === toId }));
    const steps = p.best.map((r, i) => {
      const a = p.ids[i];
      const b = p.ids[i + 1];
      const c = claims.get(r.claim_ids[0]);
      const step = {
        from: a,
        to: b,
        from_name: p.names[i],
        to_name: p.names[i + 1],
        arrow: r.src === a ? 'out' : 'in',
        predicate: r.predicate,
        label: predicateName(r.predicate),
        confidence: r.confidence,
        evidence_text: c?.c.evidence_text || '',
        page_no: null,
        record_id: c?.c.record_id || '',
        archive_number: c ? chapterLabel(c.c.chapter_no) : '',
        archive_title: c?.title || '',
        claim_id: r.claim_ids[0],
      };
      const edgeId = `${r.src}::${r.predicate}::${r.dst}`;
      graphEdges.set(edgeId, {
        id: edgeId, source: r.src, target: r.dst, type: r.predicate, label: step.label, confidence: r.confidence,
        arrow: step.arrow, record_id: step.record_id, archive_number: step.archive_number, archive_title: step.archive_title,
      });
      return step;
    });
    return { hops: steps.length, score: Number(p.score.toFixed(4)), node_ids: p.ids, steps };
  });

  return {
    found: true,
    reason: '',
    from,
    to,
    max_hops: hops,
    truncated: candidates.length > picked.length,
    paths: result,
    graph: { nodes: [...graphNodes.values()], edges: [...graphEdges.values()] },
  };
}
