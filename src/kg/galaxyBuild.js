// 语义星图构建：片段向量 → PCA-64 → UMAP 二维坐标 + KMeans 语义族（轮廓系数选 k）
// → TF-IDF 关键词 + LLM 命名 → 簇间关联 / 子簇 / 离群 / 分期漂移，全部写回 Neo4j。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { PCA } from 'ml-pca';
import { UMAP } from 'umap-js';
import { kmeans } from 'ml-kmeans';
import { embedTexts, EMBED_DIM } from './embed.js';
import { chatJson } from './llm.js';
import { addPhrases, addWords, buildTfIdf, tokenize } from './keywords.js';
import { NameMatcher } from './matcher.js';
import { graphDataDir, periodSpan, unitLabel } from './domains/index.js';
import { currentGraph, currentGraphId, ensureUnitLabels, exec as run, vectorIndexName, vectorLabel } from './neo.js';
import {
  cosine, cosineDistanceMatrix, dot, meanVector, normalize, robustZ, seededRandom, silhouette,
} from './mathutil.js';

const cacheFile = () => path.join(graphDataDir(currentGraphId()), 'embeddings.json');

export function periodOf(chapterNo) {
  return periodSpan(currentGraph(), chapterNo).label;
}

const textHash = (t) => crypto.createHash('md5').update(t).digest('hex').slice(0, 10);

async function loadSegments() {
  const rows = await run(
    `MATCH (s:Segment {graph_id: $g})-[:IN_CHAPTER]->(c:Chapter)
     RETURN s.seg_id AS seg_id, s.chapter_no AS chapter_no, s.idx AS idx, s.text AS text, c.title AS chapter_title
     ORDER BY s.chapter_no, s.idx`,
  );
  return rows.map((r) => ({
    seg_id: r.get('seg_id'),
    chapter_no: Number(r.get('chapter_no')),
    idx: Number(r.get('idx')),
    text: r.get('text'),
    chapter_title: r.get('chapter_title'),
  }));
}

async function loadEntityNames() {
  const { primaryTypes, secondaryTypes } = currentGraph().galaxy;
  const rows = await run(
    `MATCH (e:Entity {graph_id: $g}) WHERE e.entity_type IN $types
     RETURN e.entity_id AS id, e.entity_type AS type, e.canonical_name AS name, e.aliases AS aliases,
            e.nickname AS nickname, e.mention_count AS mentions`,
    { types: [...primaryTypes, ...secondaryTypes] },
  );
  return rows.map((r) => ({
    id: r.get('id'),
    type: r.get('type'),
    primary: primaryTypes.includes(r.get('type')),
    name: r.get('name'),
    aliases: r.get('aliases') || [],
    nickname: r.get('nickname') || '',
    mentions: Number(r.get('mentions') || 0),
  }));
}

async function embedSegments(segments, onProgress) {
  const CACHE_FILE = cacheFile();
  let cache = {};
  try {
    cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
  } catch {
    cache = {};
  }
  const missing = segments.filter((s) => cache[s.seg_id]?.h !== textHash(s.text));
  if (missing.length) {
    const vectors = await embedTexts(missing.map((s) => s.text), { batchSize: 16, onProgress, lang: currentGraph().lang });
    missing.forEach((s, i) => {
      cache[s.seg_id] = { h: textHash(s.text), v: vectors[i].map((x) => Number(x.toFixed(6))) };
    });
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache));
  }
  return segments.map((s) => cache[s.seg_id].v);
}

function runKmeans(rows, k, seed = 7) {
  const res = kmeans(rows, k, { initialization: 'kmeans++', seed, maxIterations: 200 });
  return res.clusters;
}

/** 在 kRange 里按轮廓系数挑最好的 k */
function chooseK(rows, dist, kRange, seed) {
  let best = { k: kRange[0], score: -1, labels: null };
  for (const k of kRange) {
    if (k >= rows.length) break;
    const labels = runKmeans(rows, k, seed);
    const score = silhouette(dist, rows.length, labels);
    if (score > best.score) best = { k, score, labels };
  }
  return best;
}

function subDistance(dist, n, idx) {
  const m = idx.length;
  const out = new Float32Array(m * m);
  for (let a = 0; a < m; a++) for (let b = 0; b < m; b++) out[a * m + b] = dist[idx[a] * n + idx[b]];
  return out;
}

function topCounts(values, limit) {
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([name, count]) => ({ name, count }));
}

async function nameClusters(clusters, segments) {
  const graph = currentGraph();
  const label = (no) => unitLabel(graph, no);
  const queue = [...clusters];
  const worker = async () => {
    while (queue.length) {
      const c = queue.shift();
      const sampleLen = graph.lang === 'en' ? 420 : 160;
      const samples = c.representatives.map((i) => `（${label(segments[i].chapter_no)}）${segments[i].text.slice(0, sampleLen)}`).join('\n');
      try {
        const res = await chatJson({
          system: `你是${graph.prompts.role}，为《${graph.name}》原文片段的语义聚类起名，只输出 JSON。`,
          user: `这一组片段共 ${c.size} ${graph.terms.segment}，主要分布在${label(c.min_year)}到${label(c.max_year)}。
高频关键词：${c.keywords.slice(0, 12).join('、')}
主要${graph.terms.primary}：${c.persons.slice(0, 6).map((p) => p.name).join('、')}
代表片段：
${samples}
请给出：name（≤8字，概括这组片段的共同主题，如${graph.prompts.clusterExamples}），
summary（≤50字，说明这组片段讲什么）。输出 {"name":"","summary":""}`,
          maxTokens: 400,
          temperature: 0.3,
        });
        c.name = String(res.name || '').trim().slice(0, 12) || c.keywords.slice(0, 2).join('·');
        c.summary = String(res.summary || '').trim().slice(0, 100);
      } catch {
        c.name = c.keywords.slice(0, 2).join('·');
        c.summary = `关键词：${c.keywords.slice(0, 6).join('、')}`;
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
}

export async function buildGalaxy(job) {
  const step = (stage, progress) => {
    if (job.cancelled) throw new Error('任务已取消');
    job.stage = stage;
    job.progress = progress;
  };

  step('load', 2);
  await ensureUnitLabels();
  const segments = await loadSegments();
  if (segments.length < 20) throw new Error(`片段太少，请先运行 npm run kg:load -- ${currentGraphId()}`);
  const entities = await loadEntityNames();
  const lang = currentGraph().lang || 'zh';
  if (lang === 'en') addPhrases(entities.flatMap((e) => [e.name, ...e.aliases]));
  else addWords(entities.flatMap((e) => [e.name, ...e.aliases]));

  step('embed', 5);
  const vectors = await embedSegments(segments, (done, total) => {
    job.progress = 5 + Math.round((done / total) * 40);
  });
  const n = segments.length;

  step('reduce', 46);
  const pca = new PCA(vectors, { center: true });
  const nComp = Math.min(64, vectors[0].length, n - 1);
  const reduced = pca.predict(vectors, { nComponents: nComp }).to2DArray().map(normalize);

  step('umap', 50);
  const umap = new UMAP({ nComponents: 2, nNeighbors: Math.min(15, n - 1), minDist: 0.12, spread: 1.2, random: seededRandom(42) });
  const coords = await umap.fitAsync(reduced, (epoch) => {
    job.progress = 50 + Math.min(15, Math.round(epoch / 40));
    return !job.cancelled;
  });
  const xs = coords.map((c) => c[0]);
  const ys = coords.map((c) => c[1]);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  // 前端画布轴域是 ±100（CANVAS_HALF_SPAN），留一点边
  const scale = (v, lo, hi) => Number((((v - lo) / (hi - lo || 1)) * 190 - 95).toFixed(3));
  segments.forEach((s, i) => {
    s.x = scale(xs[i], minX, maxX);
    s.y = scale(ys[i], minY, maxY);
  });

  step('cluster', 66);
  const dist = cosineDistanceMatrix(reduced);
  // 片段少的图谱（论语约数百章）簇也少一些，每簇至少约 12 段
  const kMax = Math.max(6, Math.min(30, Math.floor(n / 12)));
  const kMin = Math.min(8, kMax);
  const best = chooseK(reduced, dist, Array.from({ length: kMax - kMin + 1 }, (_, i) => i + kMin), 7);
  const labels = best.labels;
  const k = best.k;

  step('keywords', 72);
  const personMatcher = new NameMatcher(entities.filter((e) => e.primary).map((e) => ({ id: e.name, names: [e.name, ...e.aliases] })));
  const placeMatcher = new NameMatcher(entities.filter((e) => !e.primary).map((e) => ({ id: e.name, names: [e.name, ...e.aliases] })));
  const docs = segments.map((s) => tokenize(s.text, lang));
  segments.forEach((s) => {
    const persons = [...personMatcher.count(s.text)].sort((a, b) => b[1] - a[1]);
    const places = [...placeMatcher.count(s.text)].sort((a, b) => b[1] - a[1]);
    s.persons = persons.slice(0, 8).map(([name]) => name);
    s.places = places.slice(0, 6).map(([name]) => name);
    s.person_count = persons.length;
    s.char_count = s.text.length;
  });
  const keywordsFor = buildTfIdf(docs);

  const members = Array.from({ length: k }, () => []);
  labels.forEach((l, i) => members[l].push(i));
  const centroids = members.map((idx) => normalize(meanVector(idx.map((i) => reduced[i]))));

  const clusters = members.map((idx, cid) => {
    const kw = keywordsFor(idx, 20);
    const chs = idx.map((i) => segments[i].chapter_no);
    const sims = idx.map((i) => dot(reduced[i], centroids[cid]));
    const representatives = idx.map((i, j) => [i, sims[j]]).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([i]) => i);
    return {
      cluster_id: cid,
      size: idx.length,
      keywords: kw.map((w) => w.word),
      keyword_weights: kw,
      persons: topCounts(idx.flatMap((i) => segments[i].persons.slice(0, 3)), 10),
      min_year: Math.min(...chs),
      max_year: Math.max(...chs),
      centroid_x: Number((idx.reduce((s, i) => s + segments[i].x, 0) / idx.length).toFixed(3)),
      centroid_y: Number((idx.reduce((s, i) => s + segments[i].y, 0) / idx.length).toFixed(3)),
      min_x: Math.min(...idx.map((i) => segments[i].x)),
      max_x: Math.max(...idx.map((i) => segments[i].x)),
      min_y: Math.min(...idx.map((i) => segments[i].y)),
      max_y: Math.max(...idx.map((i) => segments[i].y)),
      representatives,
      cluster_key: crypto.createHash('md5').update(kw.slice(0, 8).map((w) => w.word).sort().join('|')).digest('hex').slice(0, 12),
    };
  });

  step('naming', 76);
  await nameClusters(clusters, segments);

  step('subclusters', 84);
  const subclusters = [];
  segments.forEach((s) => { s.sub_cluster_id = -1; });
  for (const c of clusters) {
    const idx = members[c.cluster_id];
    c.sub_cluster_count = 0;
    if (idx.length < 30) continue;
    const rows = idx.map((i) => reduced[i]);
    const sub = chooseK(rows, subDistance(dist, n, idx), [2, 3, 4], 11);
    const groups = Array.from({ length: sub.k }, () => []);
    sub.labels.forEach((l, j) => groups[l].push(idx[j]));
    c.sub_cluster_count = sub.k;
    groups.forEach((g, sid) => {
      for (const i of g) segments[i].sub_cluster_id = sid;
      const kw = keywordsFor(g, 8).map((w) => w.word);
      const chs = g.map((i) => segments[i].chapter_no);
      const years = topCounts(chs, 200).map(({ name, count }) => ({ year: name, count })).sort((a, b) => a.year - b.year);
      subclusters.push({
        cluster_id: c.cluster_id,
        sub_cluster_id: sid,
        name: kw.slice(0, 3).join('·'),
        keywords: kw,
        size: g.length,
        year_from: Math.min(...chs),
        year_to: Math.max(...chs),
        centroid_x: Number((g.reduce((s, i) => s + segments[i].x, 0) / g.length).toFixed(3)),
        centroid_y: Number((g.reduce((s, i) => s + segments[i].y, 0) / g.length).toFixed(3)),
        silhouette: Number(sub.score.toFixed(4)),
        years: JSON.stringify(years),
      });
    });
  }

  step('links', 88);
  const links = [];
  for (let a = 0; a < k; a++) {
    const cand = [];
    for (let b = 0; b < k; b++) {
      if (a === b) continue;
      const cc = cosine(centroids[a], centroids[b]);
      const sa = members[a].slice(0, 60);
      const sb = members[b].slice(0, 60);
      let sum = 0;
      for (const i of sa) for (const j of sb) sum += 1 - dist[i * n + j];
      const avg = sum / (sa.length * sb.length || 1);
      const shared = clusters[a].keywords.slice(0, 15).filter((w) => clusters[b].keywords.slice(0, 15).includes(w));
      cand.push({ b, cc, avg, score: 0.5 * cc + 0.5 * avg, shared });
    }
    cand.sort((x, y) => y.score - x.score).slice(0, 3).forEach((l, r) => {
      const [src, dst] = a < l.b ? [a, l.b] : [l.b, a];
      if (links.some((x) => x.src_cluster === src && x.dst_cluster === dst)) return;
      links.push({
        src_cluster: src,
        dst_cluster: dst,
        centroid_cosine: Number(l.cc.toFixed(4)),
        avg_link_similarity: Number(l.avg.toFixed(4)),
        score: Number(l.score.toFixed(4)),
        shared_keywords: l.shared,
        rank_no: r + 1,
      });
    });
  }

  step('outliers', 91);
  const outliers = [];
  for (let cid = 0; cid < k; cid++) {
    const idx = members[cid];
    const d = idx.map((i) => 1 - dot(reduced[i], centroids[cid]));
    const z = robustZ(d);
    idx.forEach((i, j) => {
      const sims = [];
      for (let o = 0; o < n; o++) if (o !== i) sims.push(1 - dist[i * n + o]);
      sims.sort((a, b) => b - a);
      const density = sims.slice(0, 10).reduce((s, v) => s + v, 0) / 10;
      let nearest = cid;
      let nearestSim = -Infinity;
      for (let c2 = 0; c2 < k; c2++) {
        if (c2 === cid) continue;
        const sim = dot(reduced[i], centroids[c2]);
        if (sim > nearestSim) { nearestSim = sim; nearest = c2; }
      }
      const ownSim = 1 - d[j];
      const misplaced = nearestSim > ownSim ? 1 : 0;
      const s = segments[i];
      s.outlier_score = Number(z[j].toFixed(3));
      s.local_density = Number(density.toFixed(4));
      s.outlier_flag = z[j] > 2.5 || (misplaced && z[j] > 1.5) ? 1 : 0;
      if (s.outlier_flag) {
        outliers.push({
          record_id: s.seg_id,
          cluster_id: cid,
          sub_cluster_id: s.sub_cluster_id,
          score: s.outlier_score,
          local_density: s.local_density,
          nearest_cluster_id: nearest,
          misplaced,
          detail: JSON.stringify({ own_similarity: Number(ownSim.toFixed(4)), nearest_similarity: Number(nearestSim.toFixed(4)) }),
        });
      }
    });
  }
  segments.forEach((s, i) => { s.cluster_id = labels[i]; });

  step('drift', 94);
  const periods = [...new Set(segments.map((s) => periodOf(s.chapter_no)))];
  const periodTotals = new Map(periods.map((p) => [p, segments.filter((s) => periodOf(s.chapter_no) === p).length]));
  const drift = [];
  for (let cid = 0; cid < k; cid++) {
    let prevKw = null;
    let prevCentroid = null;
    for (const p of periods) {
      const idx = members[cid].filter((i) => periodOf(segments[i].chapter_no) === p);
      if (!idx.length) continue;
      const kw = keywordsFor(idx, 8).map((w) => w.word);
      const cx = idx.reduce((s, i) => s + segments[i].x, 0) / idx.length;
      const cy = idx.reduce((s, i) => s + segments[i].y, 0) / idx.length;
      const shift = prevCentroid ? Math.hypot(cx - prevCentroid[0], cy - prevCentroid[1]) / 190 : 0;
      const union = new Set([...(prevKw || []), ...kw]);
      const inter = prevKw ? kw.filter((w) => prevKw.includes(w)).length : kw.length;
      const turnover = prevKw ? 1 - inter / (union.size || 1) : 0;
      drift.push({
        period: p,
        granularity: 'period',
        cluster_id: cid,
        sub_cluster_id: -1,
        count: idx.length,
        share: Number((idx.length / periodTotals.get(p)).toFixed(4)),
        centroid_x: Number(cx.toFixed(3)),
        centroid_y: Number(cy.toFixed(3)),
        top_keywords: kw,
        new_keywords: prevKw ? kw.filter((w) => !prevKw.includes(w)) : [],
        gone_keywords: prevKw ? prevKw.filter((w) => !kw.includes(w)) : [],
        centroid_shift: Number(shift.toFixed(4)),
        keyword_turnover: Number(turnover.toFixed(4)),
        significant: Boolean(prevKw && idx.length >= 4 && (turnover >= 0.7 || shift >= 0.15)),
      });
      prevKw = kw;
      prevCentroid = [cx, cy];
    }
  }

  step('persist', 96);
  const g = currentGraphId();
  const vecLabel = vectorLabel(g);
  const vecIndex = vectorIndexName(g);
  await run(`MATCH (n {graph_id: $g}) WHERE n:GalaxyCluster OR n:GalaxySubcluster OR n:GalaxyLink OR n:GalaxyOutlier OR n:GalaxyDrift
             DETACH DELETE n`);
  await run(`DROP INDEX ${vecIndex} IF EXISTS`);
  const segRows = segments.map((s, i) => ({
    seg_id: s.seg_id, x: s.x, y: s.y, cluster_id: s.cluster_id, sub_cluster_id: s.sub_cluster_id,
    outlier_score: s.outlier_score, outlier_flag: s.outlier_flag, local_density: s.local_density,
    persons: s.persons, places: s.places, person_count: s.person_count, char_count: s.char_count,
    embedding: vectors[i],
  }));
  for (let i = 0; i < segRows.length; i += 200) {
    await run(
      `UNWIND $rows AS r MATCH (s:Segment {graph_id: $g, seg_id: r.seg_id})
       SET s:${vecLabel}, s.x = r.x, s.y = r.y, s.cluster_id = r.cluster_id, s.sub_cluster_id = r.sub_cluster_id,
           s.outlier_score = r.outlier_score, s.outlier_flag = r.outlier_flag, s.local_density = r.local_density,
           s.persons = r.persons, s.places = r.places, s.person_count = r.person_count, s.char_count = r.char_count
       WITH s, r CALL db.create.setNodeVectorProperty(s, 'embedding', r.embedding)`,
      { rows: segRows.slice(i, i + 200) },
    );
  }
  await run(
    `CREATE VECTOR INDEX ${vecIndex} IF NOT EXISTS FOR (s:${vecLabel}) ON (s.embedding)
     OPTIONS {indexConfig: {\`vector.dimensions\`: ${EMBED_DIM}, \`vector.similarity_function\`: 'cosine'}}`,
  );
  const create = (label, list) => (list.length
    ? run(`UNWIND $rows AS r CREATE (c:${label}) SET c = r, c.graph_id = $g`, { rows: list })
    : null);
  await create('GalaxyCluster', clusters.map(({ representatives, persons, keyword_weights, ...c }) => ({
    ...c, keyword_weights: JSON.stringify(keyword_weights), persons: JSON.stringify(persons),
  })));
  await create('GalaxySubcluster', subclusters);
  await create('GalaxyLink', links);
  await create('GalaxyOutlier', outliers);
  await create('GalaxyDrift', drift);

  Object.assign(job, {
    processed_points: n,
    n_clusters: k,
    best_k: k,
    silhouette: Number(best.score.toFixed(4)),
  });
  return job;
}
