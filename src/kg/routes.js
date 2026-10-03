// 知识图谱 API：路径与 AIB 前端保持一致（/api/knowledge-graph/* 与 /api/data-governance/knowledge-graph/*），
// 统一返回 {success, data, message}。每个请求用 ?graph=<id>（或请求头 X-KG-Graph）指定图谱，缺省为水浒传。
import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import * as galaxy from './galaxyQuery.js';
import * as explore from './exploreQuery.js';
import * as analysis from './analysisQuery.js';
import { buildGalaxy } from './galaxyBuild.js';
import { buildAnalysis } from './analysisBuild.js';
import * as notes from './notes.js';
import * as ask from './ask.js';
import * as review from './review.js';
import { createJob, findJob, finishJob, getJob, isRunning, latestJob } from './jobs.js';
import {
  CATEGORIES, getGraph, graphDataDir, hasGraph, listGraphs, profileOf, syncTopics,
} from './domains/index.js';
import { runState } from '../topic/runner.js';
import { localeOf, localizeCategories } from './locale.js';
import { currentGraph, ensureUnitLabels, one, parseJsonField, rows, withGraph } from './neo.js';
import config from '../config.js';
import { canManage, requireManage } from './access.js';

const router = Router();
const DEFAULT_GRAPH = 'shuihu';

function graphIdOf(req) {
  const id = String(req.query.graph || req.get('x-kg-graph') || DEFAULT_GRAPH).trim();
  if (!hasGraph(id)) throw Object.assign(new Error(`未知图谱：${id}`), { status: 404, code: 'unknown_graph', params: { id } });
  return id;
}

const wrap = (fn) => async (req, res) => {
  try {
    const data = await withGraph(graphIdOf(req), async () => {
      await ensureUnitLabels();
      return fn(req, res);
    });
    res.json({ success: true, data });
  } catch (e) {
    console.error('[kg]', req.method, req.originalUrl, e.message);
    res.status(e.status || 500).json({
      success: false,
      message: e.message || '服务器错误',
      code: e.code || 'server_error',
      params: e.params,
    });
  }
};

const listParam = (q, name) => {
  const v = q[name] ?? q[`${name}[]`];
  if (v === undefined) return [];
  return [].concat(v).flatMap((x) => String(x).split(',')).map((x) => x.trim()).filter(Boolean);
};

/** 后台任务在调用时的图谱上下文里继续运行（AsyncLocalStorage 跟随 Promise 链） */
function startJob(kind, builder) {
  if (isRunning(kind)) throw Object.assign(new Error('已有任务在运行，请稍候'), { status: 409, code: 'job_busy' });
  const job = createJob(kind);
  builder(job)
    .then(() => finishJob(job, 'completed'))
    .catch((e) => {
      console.error(`[kg] ${job.graph_id}/${kind} 任务失败:`, e);
      return finishJob(job, job.cancelled ? 'cancelled' : 'failed', e);
    });
  return { job_id: job.job_id };
}

// ───────────── 图谱目录 ─────────────

/** 后台批处理（src/scripts/kg/run.js）写的进度，首页给“整理中”的卡片显示到哪一步 */
function buildStatus(id) {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(graphDataDir(id), 'status.json'), 'utf8'));
    let { state } = s;
    // 专题的处理进程可能已经不在了（服务重启、命令行被关掉），以实际在跑的为准
    if (getGraph(id).topic && (state === 'running' || state === 'queued')) state = runState(id) || 'failed';
    return {
      state, step: s.step, extracted: s.extracted, units: s.units, ingest: s.ingest, error: s.error, updated_at: s.updated_at,
    };
  } catch {
    return null;
  }
}

async function graphStats() {
  const r = await one(
    `CALL { MATCH (c:Chapter {graph_id: $g}) RETURN count(c) AS units }
     CALL { MATCH (e:Entity {graph_id: $g}) RETURN count(e) AS entities }
     CALL { MATCH (c:Claim {graph_id: $g}) RETURN count(c) AS claims }
     CALL { MATCH (k:GalaxyCluster {graph_id: $g}) RETURN count(k) AS clusters }
     RETURN units, entities, claims, clusters`,
  );
  return r || { units: 0, entities: 0, claims: 0, clusters: 0 };
}

const runIn = (id, fn) => withGraph(id, async () => {
  await ensureUnitLabels();
  return fn();
});

function sendError(res, e) {
  res.status(e.status || 500).json({
    success: false,
    message: e.message || '服务器错误',
    code: e.code || 'server_error',
    params: e.params,
  });
}

router.get('/knowledge-graph/graphs', async (req, res) => {
  try {
    const locale = localeOf(req);
    syncTopics();
    const items = await Promise.all(listGraphs().map((graph) => runIn(graph.id, async () => {
      const stats = await graphStats();
      const p = profileOf(graph, locale);
      return {
        id: p.id, name: p.name, book: p.book, category: p.category, kind: p.kind, description: p.description,
        cover: p.cover, source: p.source, unit: p.unit, terms: p.terms, stats, ready: stats.claims > 0,
        build: buildStatus(p.id),
      };
    })));
    res.json({ success: true, data: { categories: localizeCategories(CATEGORIES, locale), items } });
  } catch (e) {
    console.error('[kg] graphs', e.message);
    sendError(res, e);
  }
});

router.get('/knowledge-graph/graphs/:id', async (req, res) => {
  try {
    const graph = getGraph(req.params.id);
    const locale = localeOf(req);
    const data = await runIn(graph.id, async () => {
      const stats = await graphStats();
      const units = await rows(
        'MATCH (c:Chapter {graph_id: $g}) RETURN c.no AS no, c.title AS title, c.label AS label, c.part AS part ORDER BY c.no',
      );
      const p = profileOf(graph, locale);
      return { ...p, unit: { ...p.unit, total: p.unit.total || units.length }, stats, units };
    });
    res.json({ success: true, data });
  } catch (e) {
    sendError(res, e);
  }
});

/** 影视对照（目前只有水浒传央视版）：data/<graph>/videos.json，由各图谱媒体脚本生成 */
router.get('/knowledge-graph/videos', (req, res) => {
  try {
    const id = graphIdOf(req);
    const file = path.join(graphDataDir(id), 'videos.json');
    const data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { source: null, episodes: [] };
    res.json({ success: true, data });
  } catch (e) {
    sendError(res, e);
  }
});

/** 首页总搜索：在所有已入库图谱里按名字找实体 */
router.get('/knowledge-graph/search-all', async (req, res) => {
  try {
    const kw = String(req.query.q || '').trim();
    if (!kw) return res.json({ success: true, data: { items: [] } });
    const locale = localeOf(req);
    const per = Math.min(Number(req.query.limit) || 5, 20);
    const groups = await Promise.all(listGraphs().map((graph) => runIn(graph.id, async () => {
      const r = await explore.searchEntities({ keyword: kw, page_size: per });
      const name = profileOf(graph, locale).name;
      return r.items.map((it) => ({ ...it, graph_id: graph.id, graph_name: name }));
    })));
    res.json({ success: true, data: { items: groups.flat() } });
  } catch (e) {
    sendError(res, e);
  }
});

// ───────────── 语义星图 ─────────────
const G = '/knowledge-graph/galaxy';
router.get(`${G}/grid`, wrap((req) => galaxy.getGrid(Number(req.query.limit) || 2000)));
router.get(`${G}/points`, wrap((req) => galaxy.getPoints(req.query)));
router.get(`${G}/clusters`, wrap(() => galaxy.getClusters()));
router.get(`${G}/clusters/:id/subclusters`, wrap((req) => galaxy.getSubclusters(req.params.id)));
router.get(`${G}/clusters/:id/board`, wrap((req) => galaxy.getClusterBoard(req.params.id)));
router.get(`${G}/search`, wrap((req) => galaxy.searchGalaxy(req.query.q, req.query.limit)));
router.get(`${G}/similar/:id`, wrap((req) => galaxy.getSimilar(req.params.id, req.query.top_k)));
router.get(`${G}/era-clusters`, wrap((req) => galaxy.getEraClusters(req.query.year_from, req.query.year_to, req.query.limit)));
router.get(`${G}/timeline`, wrap(() => galaxy.getTimeline()));
router.get(`${G}/coverage`, wrap(() => galaxy.getCoverage()));
router.get(`${G}/links`, wrap((req) => galaxy.getLinks(req.query.min_similarity, req.query.limit)));
router.get(`${G}/outliers`, wrap((req) => galaxy.getOutliers(req.query)));
router.get(`${G}/drift`, wrap((req) => galaxy.getDrift(req.query.cluster_id)));
router.get(`${G}/drift/report`, wrap((req) => galaxy.getDriftReport(req.query.cluster_id)));
router.post(`${G}/rebuild`, wrap(() => startJob('galaxy', buildGalaxy)));
router.get(`${G}/jobs/latest`, wrap(() => latestJob('galaxy')));

// ───────────── 找线索（分析） ─────────────
const A = '/knowledge-graph/analysis';
router.get(`${A}/edges`, wrap((req) => analysis.edgeMetrics(listParam(req.query, 'keys'))));
router.get(`${A}/hubs`, wrap((req) => analysis.hubs(req.query.entity_type, req.query.limit || 30)));
router.get(`${A}/communities`, wrap((req) => analysis.communities(req.query.limit || 200)));
router.get(`${A}/communities/members`, wrap((req) => analysis.communityMembers(listParam(req.query, 'ids'))));
router.get(`${A}/communities/:key/bridges`, wrap((req) => analysis.communityBridges(req.params.key, req.query.limit || 30)));
router.get(`${A}/timeline`, wrap((req) => analysis.timeline(req.query.anchor_id, req.query.year_from, req.query.year_to, req.query.limit || 500)));
router.get(`${A}/timeline/span`, wrap(() => analysis.timelineSpan()));
router.get(`${A}/anomalies`, wrap((req) => analysis.anomalies(req.query)));
router.get(`${A}/coverage`, wrap(() => analysis.coverage()));
router.get(`${A}/paths`, wrap((req) => analysis.paths(req.query.from_id, req.query.to_id, req.query.max_hops, req.query.max_paths)));
router.post(`${A}/rebuild`, wrap(() => startJob('analysis', buildAnalysis)));
router.get(`${A}/jobs/latest`, wrap(() => latestJob('analysis')));
router.get(`${A}/jobs/:id`, wrap(async (req) => {
  const job = await findJob(req.params.id);
  if (!job) throw Object.assign(new Error('任务不存在'), { status: 404, code: 'job_missing' });
  return job;
}));
router.post(`${A}/jobs/:id/cancel`, wrap((req) => {
  const job = getJob(req.params.id);
  if (job && job.status === 'running') job.cancelled = true;
  return { job_id: req.params.id, cancelled: Boolean(job) };
}));

// 顶栏统计沿用 AIB 的「指标任务」口径，这里由分析任务结果提供
router.get('/knowledge-graph/metrics/jobs/latest', wrap(async () => {
  const job = await latestJob('analysis');
  if (!job) return null;
  const s = await explore.stats();
  return { ...job, total_entities: s.summary.entities, communities: job.communities };
}));

// ───────────── 实体 / 事实 / 原文 ─────────────
const K = '/data-governance/knowledge-graph';
router.get(`${K}/status`, wrap(() => ({ neo4j_available: true, model: config.deepseek.model, ontology: currentGraph().ontology.version })));
router.get(`${K}/stats`, wrap(() => explore.stats()));
router.get(`${K}/ontology`, wrap(() => explore.ontologyPayload()));
router.get(`${K}/graph/semantic`, wrap((req) => explore.semanticGraph({ ...req.query, predicate: listParam(req.query, 'predicate') })));
router.get(`${K}/entities/search`, wrap((req) => explore.searchEntities(req.query)));
router.post(`${K}/entities/media`, wrap(async (req) => {
  const ids = [].concat(req.body?.entity_ids || []).slice(0, 2000);
  if (!ids.length) return { items: {} };
  const list = await rows(
    'MATCH (e:Entity {graph_id: $g}) WHERE e.entity_id IN $ids AND e.media IS NOT NULL RETURN e.entity_id AS id, e.media AS media',
    { ids },
  );
  const items = {};
  for (const { id, media } of list) {
    const m = parseJsonField(media, null);
    if (!m?.avatar) continue;
    items[id] = { kind: 'image', thumb_url: m.avatar, file_url: m.avatar, person_id: null, gallery: m.gallery || [] };
  }
  return { items };
}));
router.get(`${K}/entities/:id/neighbors`, wrap((req) => explore.entityNeighbors(req.params.id, req.query)));
router.get(`${K}/entities/:id/sources`, wrap((req) => explore.entitySources(req.params.id, req.query.limit || 20)));
router.get(`${K}/entities/:id`, wrap((req) => explore.getEntity(req.params.id)));
router.get(`${K}/claims`, wrap((req) => explore.listClaims(req.query)));
router.post(`${K}/claims/by-ids`, wrap((req) => explore.claimsByIds(req.body?.claim_ids)));
router.get(`${K}/archives/:id/evidence`, wrap((req) => explore.chapterEvidence(req.params.id)));

// ───────────── 学习层：解说 / 相关推荐 / 问答 / 待核对 ─────────────

/** 写解说、提问都要调模型：按来源 IP 每小时限次，避免公开部署被刷 */
const LLM_PER_HOUR = Number(process.env.KG_LLM_PER_HOUR || 40);
const llmUsage = new Map();
function clientOf(req) {
  return String(req.get('x-forwarded-for') || '').split(',')[0].trim() || req.socket.remoteAddress || '';
}
function spendLlm(req) {
  const key = clientOf(req);
  const now = Date.now();
  const recent = (llmUsage.get(key) || []).filter((t) => now - t < 3600_000);
  if (recent.length >= LLM_PER_HOUR) throw Object.assign(new Error('提问太频繁，请稍后再试'), { status: 429, code: 'llm_rate_limited' });
  recent.push(now);
  llmUsage.set(key, recent);
}

const canReview = canManage;
const requireReview = (req) => requireManage(req, 'review_forbidden');

router.get(`${K}/entities/:id/related`, wrap((req) => explore.relatedEntities(req.params.id, req.query.limit || 8)));
router.get(`${K}/entities/:id/note`, wrap((req) => notes.getNote(req.params.id, localeOf(req))));
router.post(`${K}/entities/:id/note`, wrap((req) => {
  spendLlm(req);
  return notes.generateNote(req.params.id, localeOf(req));
}));

const L = '/knowledge-graph/learn';
router.post(`${L}/ask`, wrap((req) => {
  const question = req.body?.question;
  const fresh = Boolean(req.body?.fresh);
  const locale = localeOf(req);
  if (fresh || !ask.savedAnswer(question, locale)) spendLlm(req);
  return ask.ask({ question, locale, fresh });
}));
router.get(`${L}/answers`, wrap((req) => ask.listAnswers({ locale: localeOf(req), limit: req.query.limit })));
router.get(`${L}/answers/:id`, wrap((req) => ask.getAnswer(req.params.id)));
router.post(`${L}/answers/:id`, wrap((req) => ask.saveAnswer(req.params.id)));
router.delete(`${L}/answers/:id`, wrap((req) => {
  requireReview(req);
  return ask.deleteAnswer(req.params.id);
}));
router.get(`${L}/review`, wrap(async (req) => ({
  ...(await review.reviewQueue(req.query)),
  can_decide: canReview(req),
})));
router.post(`${L}/review/:claimId`, wrap((req) => {
  requireReview(req);
  return review.decide(req.params.claimId, String(req.body?.action || ''), req.body?.note);
}));

export default router;
