// 语义星图查询：点 / 网格 / 语义族 / 搜索 / 找相似 / 时间矩阵 / 关联 / 子簇 / 离群 / 漂移 / 看板
// 全部按当前图谱（$g）过滤。
import { embedQuery } from './embed.js';
import { unitLabel } from './domains/index.js';
import { currentGraph, int, one, parseJsonField, rows, vectorIndexName } from './neo.js';

const POINT_FIELDS = `s.seg_id AS record_id, s.x AS x, s.y AS y, s.cluster_id AS cluster_id, s.chapter_no AS year,
  s.sub_cluster_id AS sub_cluster_id, s.outlier_score AS outlier_score, s.outlier_flag AS outlier_flag,
  s.idx AS idx, s.persons AS persons, s.places AS places, s.person_count AS person_count, s.char_count AS char_count,
  s.page AS page, substring(s.text, 0, 40) AS snippet, c.title AS chapter_title`;

export function segmentLabel(no, idx) {
  const graph = currentGraph();
  return `${unitLabel(graph, no)}·第${idx}${graph.terms.segment}`;
}

function toPoint(r) {
  return {
    record_id: r.record_id,
    title: r.snippet,
    x: r.x,
    y: r.y,
    cluster_id: r.cluster_id,
    year: r.year,
    category_code: (r.persons || [])[0] || '',
    sub_cluster_id: r.sub_cluster_id ?? -1,
    outlier_score: r.outlier_score ?? 0,
    outlier_flag: r.outlier_flag ?? 0,
    archive_number: segmentLabel(r.year, r.idx),
    chapter_title: r.chapter_title,
    persons: r.persons || [],
    places: r.places || [],
    person_count: r.person_count || 0,
    char_count: r.char_count || 0,
    page: r.page ?? null,
  };
}

export async function getPoints({ min_x = -1e9, max_x = 1e9, min_y = -1e9, max_y = 1e9, limit = 5000 }) {
  const lim = Math.min(Number(limit) || 5000, 5000);
  const list = await rows(
    `MATCH (s:Segment {graph_id: $g})-[:IN_CHAPTER]->(c:Chapter)
     WHERE s.x IS NOT NULL AND s.x >= $min_x AND s.x <= $max_x AND s.y >= $min_y AND s.y <= $max_y
     RETURN ${POINT_FIELDS} ORDER BY s.seg_id LIMIT $lim`,
    { min_x: Number(min_x), max_x: Number(max_x), min_y: Number(min_y), max_y: Number(max_y), lim: int(lim + 1) },
  );
  return { points: list.slice(0, lim).map(toPoint), truncated: list.length > lim };
}

export async function getGrid(limit = 2000) {
  const list = await rows(
    'MATCH (s:Segment {graph_id: $g}) WHERE s.x IS NOT NULL RETURN s.x AS x, s.y AS y, s.cluster_id AS c, s.chapter_no AS y2',
  );
  const cell = 8;
  const map = new Map();
  for (const p of list) {
    const key = `${Math.floor(p.x / cell)}_${Math.floor(p.y / cell)}`;
    const g = map.get(key) || { grid_key: key, sx: 0, sy: 0, count: 0, clusters: new Map(), years: [] };
    g.sx += p.x;
    g.sy += p.y;
    g.count++;
    g.clusters.set(p.c, (g.clusters.get(p.c) || 0) + 1);
    g.years.push(p.y2);
    map.set(key, g);
  }
  const cells = [...map.values()].slice(0, limit).map((g) => ({
    grid_key: g.grid_key,
    x: g.sx / g.count,
    y: g.sy / g.count,
    count: g.count,
    dominant_cluster: [...g.clusters].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
    avg_year: Math.round(g.years.reduce((s, v) => s + v, 0) / g.count),
    min_year: Math.min(...g.years),
    max_year: Math.max(...g.years),
  }));
  return { cells };
}

export async function getClusters() {
  const list = await rows('MATCH (c:GalaxyCluster {graph_id: $g}) RETURN c ORDER BY c.cluster_id');
  return {
    clusters: list.map(({ c }) => ({
      ...c,
      keyword_weights: parseJsonField(c.keyword_weights, []),
      persons: parseJsonField(c.persons, []),
    })),
  };
}

export async function searchGalaxy(q, limit = 20) {
  const keyword = String(q || '').trim();
  if (!keyword) return { items: [], total: 0 };
  const lim = Math.min(Number(limit) || 20, 200);
  const hits = await rows(
    `MATCH (s:Segment {graph_id: $g})-[:IN_CHAPTER]->(c:Chapter)
     WHERE s.x IS NOT NULL AND (s.text CONTAINS $q OR c.title CONTAINS $q)
     RETURN ${POINT_FIELDS} ORDER BY s.seg_id`,
    { q: keyword },
  );
  let items = hits.map(toPoint);
  // 字面没命中时退到语义检索：「武松打虎」也能找到「景阳冈」那几段
  if (items.length < 3) {
    const vec = await embedQuery(keyword);
    const sem = await rows(
      `CALL db.index.vector.queryNodes($index, $k, $vec) YIELD node AS s, score
       MATCH (s)-[:IN_CHAPTER]->(c:Chapter)
       RETURN ${POINT_FIELDS}, score ORDER BY score DESC`,
      { index: vectorIndexName(), k: int(lim), vec },
    ).catch(() => []);
    const seen = new Set(items.map((p) => p.record_id));
    items = items.concat(sem.filter((r) => !seen.has(r.record_id)).map(toPoint));
  }
  return { items: items.slice(0, lim), total: items.length };
}

export async function getSimilar(segId, topK = 30) {
  const k = Math.min(Number(topK) || 30, 100);
  const list = await rows(
    `MATCH (a:Segment {graph_id: $g, seg_id: $id})
     CALL db.index.vector.queryNodes($index, $k, a.embedding) YIELD node AS s, score
     WHERE s <> a
     MATCH (s)-[:IN_CHAPTER]->(c:Chapter)
     RETURN ${POINT_FIELDS}, score ORDER BY score DESC`,
    { id: segId, index: vectorIndexName(), k: int(k + 1) },
  );
  return {
    anchor: segId,
    items: list.slice(0, k).map((r) => ({ ...toPoint(r), similarity: Number(r.score.toFixed(4)) })),
  };
}

export async function getEraClusters(from, to, limit = 10) {
  const list = await rows(
    `MATCH (s:Segment {graph_id: $g}) WHERE s.chapter_no >= $from AND s.chapter_no <= $to AND s.cluster_id IS NOT NULL
     RETURN s.cluster_id AS cluster_id, count(*) AS count, min(s.chapter_no) AS min_year, max(s.chapter_no) AS max_year
     ORDER BY count DESC LIMIT $limit`,
    { from: Number(from), to: Number(to), limit: int(limit) },
  );
  return { clusters: list };
}

export async function getTimeline() {
  const matrix = await rows(
    `MATCH (s:Segment {graph_id: $g}) WHERE s.cluster_id IS NOT NULL
     RETURN s.chapter_no AS year, s.cluster_id AS cluster_id, count(*) AS count ORDER BY year, cluster_id`,
  );
  return { matrix };
}

export async function getCoverage() {
  const r = await one(
    `MATCH (s:Segment {graph_id: $g}) RETURN count(s) AS total, count(s.cluster_id) AS vectorized`,
  );
  const total = r?.total || 0;
  const vectorized = r?.vectorized || 0;
  return { collection: vectorIndexName(), vectorized, total_records: total, coverage: total ? vectorized / total : 0 };
}

export async function getLinks(minSimilarity = 0, limit = 300) {
  const list = await rows(
    `MATCH (l:GalaxyLink {graph_id: $g}) WHERE l.score >= $min
     MATCH (a:GalaxyCluster {graph_id: $g, cluster_id: l.src_cluster}), (b:GalaxyCluster {graph_id: $g, cluster_id: l.dst_cluster})
     RETURN l, a.name AS src_name, b.name AS dst_name, a.centroid_x AS src_x, a.centroid_y AS src_y,
            b.centroid_x AS dst_x, b.centroid_y AS dst_y
     ORDER BY l.score DESC LIMIT $limit`,
    { min: Number(minSimilarity) || 0, limit: int(limit) },
  );
  return { items: list.map(({ l, ...rest }) => ({ ...l, ...rest })) };
}

export async function getSubclusters(clusterId) {
  const list = await rows(
    'MATCH (s:GalaxySubcluster {graph_id: $g, cluster_id: $cid}) RETURN s ORDER BY s.sub_cluster_id',
    { cid: int(clusterId) },
  );
  return { items: list.map(({ s }) => ({ ...s, years: parseJsonField(s.years, []) })) };
}

export async function getOutliers({ cluster_id, pattern = '', limit = 200 }) {
  const where = [];
  const params = { limit: int(limit) };
  if (cluster_id !== undefined && cluster_id !== '' && cluster_id !== null) {
    where.push('o.cluster_id = $cid');
    params.cid = int(cluster_id);
  }
  if (pattern === 'misplaced') where.push('o.misplaced = 1');
  if (pattern === 'drifted') where.push('o.misplaced = 0');
  const list = await rows(
    `MATCH (o:GalaxyOutlier {graph_id: $g}) ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     MATCH (s:Segment {graph_id: $g, seg_id: o.record_id})-[:IN_CHAPTER]->(c:Chapter)
     OPTIONAL MATCH (own:GalaxyCluster {graph_id: $g, cluster_id: o.cluster_id})
     OPTIONAL MATCH (near:GalaxyCluster {graph_id: $g, cluster_id: o.nearest_cluster_id})
     RETURN o, substring(s.text, 0, 40) AS title, s.chapter_no AS ch, s.idx AS idx, c.title AS chapter_title,
            s.persons AS persons, own.name AS cluster_name, near.name AS nearest_cluster_name
     ORDER BY o.score DESC LIMIT $limit`,
    params,
  );
  return {
    items: list.map((r) => ({
      ...r.o,
      title: r.title,
      cluster_name: r.cluster_name,
      nearest_cluster_name: r.nearest_cluster_name,
      archive_number: segmentLabel(r.ch, r.idx),
      responsible_person: (r.persons || []).slice(0, 3).join('、'),
      creation_date: r.chapter_title,
      review_status: '',
      review_issue_id: 0,
      detail: parseJsonField(r.o.detail, {}),
    })),
    total: list.length,
  };
}

export async function getDrift(clusterId) {
  const params = {};
  let where = '';
  if (clusterId !== undefined && clusterId !== '' && clusterId !== null) {
    where = 'WHERE d.cluster_id = $cid';
    params.cid = int(clusterId);
  }
  const list = (await rows(`MATCH (d:GalaxyDrift {graph_id: $g}) ${where} RETURN d`, params)).map((r) => r.d);
  const periodKey = (p) => Number(String(p).match(/\d+/)?.[0] || 0);
  const periods = [...new Set(list.map((d) => d.period))].sort((a, b) => periodKey(a) - periodKey(b));
  const byCluster = new Map();
  for (const d of list) {
    if (!byCluster.has(d.cluster_id)) byCluster.set(d.cluster_id, []);
    byCluster.get(d.cluster_id).push(d);
  }
  const series = [...byCluster.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([cid, pts]) => ({
      cluster_id: cid,
      points: pts
        .sort((a, b) => periodKey(a.period) - periodKey(b.period))
        .map(({ centroid_shift, keyword_turnover, significant, ...p }) => p),
    }));
  const metrics = list.map((d) => ({
    cluster_id: d.cluster_id,
    period: d.period,
    centroid_shift: d.centroid_shift,
    keyword_turnover: d.keyword_turnover,
    significant: d.significant,
  }));
  return { granularity: 'period', periods, series, metrics };
}

export async function getDriftReport(clusterId) {
  const graph = currentGraph();
  const drift = await getDrift(clusterId);
  const { clusters } = await getClusters();
  const nameOf = new Map(clusters.map((c) => [c.cluster_id, c.name]));
  const lines = [`# 《${graph.name}》主题变化报告`, ''];
  for (const s of drift.series) {
    lines.push(`## ${nameOf.get(s.cluster_id) || `${graph.terms.cluster} ${s.cluster_id}`}`, '');
    for (const p of s.points) {
      const m = drift.metrics.find((x) => x.cluster_id === s.cluster_id && x.period === p.period);
      lines.push(`- **${p.period}**：${p.count} ${graph.terms.segment}（占该期 ${(p.share * 100).toFixed(1)}%），关键词 ${p.top_keywords.join('、')}`
        + (p.new_keywords.length ? `；新出现 ${p.new_keywords.join('、')}` : '')
        + (m?.significant ? ' ⚠ 明显变化' : ''));
    }
    lines.push('');
  }
  const scope = clusterId !== undefined && clusterId !== '' ? nameOf.get(Number(clusterId)) : '';
  return { markdown: lines.join('\n'), periods: drift.periods, clusters: drift.series.length, scope_name: scope || '' };
}

function bucketize(values, edges, fmt) {
  const out = edges.map((e, i) => ({ bucket: fmt(e, edges[i + 1]), count: 0 }));
  for (const v of values) {
    let i = edges.length - 1;
    while (i > 0 && v < edges[i]) i--;
    out[i].count++;
  }
  return out;
}

export async function getClusterBoard(clusterId) {
  const graph = currentGraph();
  const cid = int(clusterId);
  const c = await one('MATCH (c:GalaxyCluster {graph_id: $g, cluster_id: $cid}) RETURN c', { cid });
  if (!c) throw Object.assign(new Error(`${graph.terms.cluster}不存在`), { status: 404 });
  const segs = await rows(
    `MATCH (s:Segment {graph_id: $g, cluster_id: $cid})
     RETURN s.chapter_no AS ch, s.persons AS persons, s.places AS places, s.char_count AS chars, s.person_count AS pc`,
    { cid },
  );
  const count = (arr) => {
    const m = new Map();
    for (const v of arr) m.set(v, (m.get(v) || 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]);
  };
  const years = count(segs.map((s) => s.ch)).map(([year, n]) => ({ year, count: n })).sort((a, b) => a.year - b.year);
  const { items: subclusters } = await getSubclusters(clusterId);
  const chs = segs.map((s) => s.ch);
  const countUnit = graph.terms.primary.length === 1 ? graph.terms.primary : '个';
  return {
    cluster: {
      ...c.c,
      keyword_weights: parseJsonField(c.c.keyword_weights, []),
      year_from: chs.length ? Math.min(...chs) : null,
      year_to: chs.length ? Math.max(...chs) : null,
    },
    years,
    units: count(segs.flatMap((s) => (s.persons || []).slice(0, 3))).slice(0, 10).map(([name, n]) => ({ name, count: n })),
    file_types: count(segs.flatMap((s) => (s.places || []).slice(0, 2))).slice(0, 10).map(([name, n]) => ({ name, count: n })),
    size_buckets: bucketize(segs.map((s) => s.pc || 0), [0, 2, 4, 7, 11], (a, b) => (b ? `${a}–${b - 1} ${countUnit}` : `${a}+ ${countUnit}`)),
    page_buckets: bucketize(segs.map((s) => s.chars || 0), [0, 400, 550, 700, 900], (a, b) => (b ? `${a}–${b - 1} 字` : `${a}+ 字`)),
    size_coverage: 1,
    subclusters,
  };
}
