/**
 * 知识图谱探索 API
 *
 * 后端蓝图前缀 /api/knowledge-graph/*（request.ts 的 baseURL 已带 /api）。
 * 统一 unwrap 风格：失败抛 Error，页面 catch 后 message.error。
 */
import request from './request'
import { activeProfile, type GraphProfile, type GraphSummary } from '@/graph/profile'

async function unwrap<T>(promise: Promise<any>): Promise<T> {
  const res = await promise
  if (res?.success === false) {
    throw new Error(res.message || '请求失败')
  }
  return (res?.data ?? res) as T
}

/* ==================== 图谱目录 ==================== */

export interface GraphCategory {
  id: string
  name: string
  description: string
}

export function listGraphs() {
  return unwrap<{ categories: GraphCategory[]; items: GraphSummary[] }>(request.get('/knowledge-graph/graphs'))
}

export function getGraphProfile(graphId: string) {
  return unwrap<GraphProfile>(request.get(`/knowledge-graph/graphs/${graphId}`))
}

export interface GlobalSearchHit {
  graph_id: string
  graph_name: string
  entity_id: string
  entity_type: string
  canonical_name: string
  title: string
  claim_count: number
  avatar?: string | null
}

export function searchAllGraphs(q: string, limit = 5) {
  return unwrap<{ items: GlobalSearchHit[] }>(request.get('/knowledge-graph/search-all', { params: { q, limit } }))
}

/* ==================== 关系星座（三级导航） ==================== */

/** L1 社区超节点 */
export interface CommunityOverview {
  community_id: number
  entity_count: number
  top_pagerank: number
  /** 排除年度未知（0）后的均值，全社区都未知时为 null */
  avg_year: string | number | null
  centroid_x: number
  centroid_y: number
  /** 社区代表名：中心度最高的实体名 */
  rep_name: string
  rep_type: string
}

export function getCommunities(limit = 800) {
  return unwrap<{ communities: CommunityOverview[] }>(
    request.get('/knowledge-graph/constellation/communities', { params: { limit } }),
  )
}

/** L2 社区内实体（中心度 Top N） */
export interface EntityMetrics {
  entity_id: string
  entity_type: string
  canonical_name: string
  pagerank: number
  degree: number
  community_id: number
  layout_x: number
  layout_y: number
  year_z: number
}

export function getCommunityEntities(communityId: number, limit = 500, offset = 0) {
  return unwrap<{ items: EntityMetrics[]; total: number; limit: number; offset: number }>(
    request.get(`/knowledge-graph/constellation/community/${communityId}/entities`, {
      params: { limit, offset },
    }),
  )
}

/** 单跳证据：谓词 + 原文 + 置信度 + 来源档案 */
export interface TraceHop {
  predicate: string
  evidence_text: string
  confidence: number
  /** 档案 UUID，用于跳详情页 */
  record_id: string
  /** 人类可读档号，来自 (Archive)-[:SUPPORTS]->(Claim) */
  archive_number: string
  archive_title: string
  /** 证据所在原文页码（抽取时按向量切片定位；旧数据可能为空） */
  page_no?: number | null
}

/** L3 追溯边 */
export interface TraceEdge extends TraceHop {
  id: string
  source: string
  target: string
  type: string
  label: string
}

export interface TracePath {
  target: string
  target_name: string
  hops: number
  details: TraceHop[]
}

export interface TraceResult {
  entity_id: string
  direction: 'upstream' | 'downstream'
  max_depth: number
  truncated: boolean
  nodes: Array<{ id: string; name: string; label: string; is_root?: boolean }>
  edges: TraceEdge[]
  paths: TracePath[]
}

export function traceEntity(
  entityId: string,
  direction: 'upstream' | 'downstream',
  maxDepth = 3,
  nodeLimit = 120,
) {
  return unwrap<TraceResult>(
    request.get('/knowledge-graph/constellation/trace', {
      params: { entity_id: entityId, direction, max_depth: maxDepth, node_limit: nodeLimit },
    }),
  )
}

/** 全局实体搜索结果（带社区上下文，可直跳 L3） */
export interface EntitySearchHit {
  entity_id: string
  canonical_name: string
  entity_type: string
  pagerank: number
  degree: number
  community_id: number
  layout_x: number
  layout_y: number
  year_z: number
}

export function searchEntities(q: string, limit = 20) {
  return unwrap<{ items: EntitySearchHit[]; total: number }>(
    request.get('/knowledge-graph/constellation/entity-search', { params: { q, limit } }),
  )
}

/* ==================== 指标与任务 ==================== */

export function getTopEntities(entityType = '', limit = 20) {
  return unwrap<{ items: EntityMetrics[] }>(
    request.get('/knowledge-graph/metrics/top-entities', {
      params: { entity_type: entityType, limit },
    }),
  )
}

export function getEntityMetrics(entityId: string) {
  return unwrap<EntityMetrics>(
    request.get(`/knowledge-graph/metrics/entity/${entityId}`),
  )
}

export interface MetricsJob {
  job_id: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  total_entities: number
  processed_entities: number
  communities: number
  error?: string | null
}

export function rebuildMetrics() {
  return unwrap<{ job_id: string }>(
    request.post('/knowledge-graph/metrics/rebuild'),
  )
}

export function getMetricsJob(jobId: string) {
  return unwrap<MetricsJob>(request.get(`/knowledge-graph/metrics/jobs/${jobId}`))
}

export function getLatestMetricsJob() {
  return unwrap<MetricsJob | null>(
    request.get('/knowledge-graph/metrics/jobs/latest'),
  )
}

export function cancelMetricsJob(jobId: string) {
  return unwrap<{ job_id: string; cancelled: boolean }>(
    request.post(`/knowledge-graph/metrics/jobs/${jobId}/cancel`),
  )
}

/* ==================== 语义星图 ==================== */

export interface GalaxyGridCell {
  grid_key: string
  x: number
  y: number
  count: number
  dominant_cluster: number | null
  avg_year: number | null
  min_year: number | null
  max_year: number | null
}

export function getGalaxyGrid(limit = 2000) {
  return unwrap<{ cells: GalaxyGridCell[] }>(
    request.get('/knowledge-graph/galaxy/grid', { params: { limit } }),
  )
}

export interface GalaxyPoint {
  record_id: string
  title: string
  x: number
  y: number
  cluster_id: number
  year: number
  category_code: string
  /** 簇内子簇编号，-1 表示未二次分群 */
  sub_cluster_id?: number
  /** 簇内稳健 z 分数（离群判定用） */
  outlier_score?: number
  /** 1 = 语义离群（提示型线索） */
  outlier_flag?: number
  /** 人类可读档号（JOIN archive_records 带出），展示用 */
  archive_number?: string | null
}

export function getGalaxyPoints(params: {
  min_x: number
  max_x: number
  min_y: number
  max_y: number
  limit?: number
}) {
  return unwrap<{ points: GalaxyPoint[]; truncated: boolean }>(
    request.get('/knowledge-graph/galaxy/points', { params }),
  )
}

export interface GalaxyCluster {
  cluster_id: number
  name: string
  summary: string
  size: number
  keywords: string[]
  /** 主题指纹：跨重建版本可比（簇 id 会因 k 变化重排） */
  cluster_key?: string
  /** 关键词及 TF-IDF 权重，词云用 */
  keyword_weights?: Array<{ word: string; weight: number }>
  sub_cluster_count?: number
  /** 簇成员坐标均值（画布内簇标签定位用） */
  centroid_x: number | null
  centroid_y: number | null
  min_year: number | null
  max_year: number | null
  /** 簇成员坐标范围（侧栏点簇时飞视口用，NULL 表示该簇无点） */
  min_x?: number | null
  max_x?: number | null
  min_y?: number | null
  max_y?: number | null
}

export function getGalaxyClusters() {
  return unwrap<{ clusters: GalaxyCluster[] }>(
    request.get('/knowledge-graph/galaxy/clusters'),
  )
}

/**
 * 勾选语义族整族加入专题库。后端按 cluster_id 取整族成员写入
 * gov_topic_items（与决策分析「专题库」页同一份数据，source=manual）。
 */
export function searchGalaxy(q: string, limit = 20) {
  return unwrap<{ items: GalaxyPoint[]; total: number }>(
    request.get('/knowledge-graph/galaxy/search', { params: { q, limit } }),
  )
}

/** 语义找相似：锚点档案 + 相似件（带画布坐标与相似度） */
export interface GalaxySimilarItem extends GalaxyPoint {
  /** 0-1 相似度（Milvus 按集合度量换算），降序排列 */
  similarity: number
}

export function getGalaxySimilar(recordId: string, topK = 30) {
  return unwrap<{ anchor: string; items: GalaxySimilarItem[] }>(
    request.get(`/knowledge-graph/galaxy/similar/${recordId}`, { params: { top_k: topK } }),
  )
}

/** 年代区间主力语义族（时间面板 brush 后联动） */
export interface GalaxyEraCluster {
  cluster_id: number
  count: number
  min_year: number | null
  max_year: number | null
}

export function getGalaxyEraClusters(yearFrom: number, yearTo: number, limit = 10) {
  return unwrap<{ clusters: GalaxyEraCluster[] }>(
    request.get('/knowledge-graph/galaxy/era-clusters', {
      params: { year_from: yearFrom, year_to: yearTo, limit },
    }),
  )
}

/** 年度 × 簇档案数矩阵（时间面板） */
export interface GalaxyTimelineCell {
  year: number
  cluster_id: number
  count: number
}

export function getGalaxyTimeline() {
  return unwrap<{ matrix: GalaxyTimelineCell[] }>(
    request.get('/knowledge-graph/galaxy/timeline'),
  )
}

export interface GalaxyCoverage {
  collection: string
  vectorized: number
  total_records: number
  coverage: number
}

export function getGalaxyCoverage() {
  // 覆盖率依赖 Milvus 计数；单独收短超时，避免整页被全局 180s 拖死
  return unwrap<GalaxyCoverage>(
    request.get('/knowledge-graph/galaxy/coverage', { timeout: 15000 }),
  )
}

export function rebuildGalaxy() {
  return unwrap<{ job_id: string }>(request.post('/knowledge-graph/galaxy/rebuild'))
}

/** 星图任务（数据说明抽屉展示最近一次的实测数字） */
export interface GalaxyJob {
  job_id: string
  status: string
  processed_points: number
  n_clusters: number
  best_k: number
  silhouette: number
  finished_at: string | null
}

export function getLatestGalaxyJob() {
  return unwrap<GalaxyJob | null>(
    request.get('/knowledge-graph/galaxy/jobs/latest'),
  )
}

/* ==================== 语义星图增强（簇间关联 / 子簇 / 离群 / 漂移 / 看板） ==================== */

export interface GalaxyClusterLink {
  src_cluster: number
  dst_cluster: number
  src_name: string
  dst_name: string
  /** 质心余弦（PCA-64 空间，不是画布距离） */
  centroid_cosine: number
  /** 成员平均链接相似度：修正"质心近但内部松散"的伪关联 */
  avg_link_similarity: number
  score: number
  shared_keywords: string[]
  rank_no: number
  /** 两端簇的质心画布坐标（后端 JOIN 点表带出，画线直接用） */
  src_x?: number | null
  src_y?: number | null
  dst_x?: number | null
  dst_y?: number | null
}

export function getGalaxyLinks(minSimilarity = 0, limit = 300) {
  return unwrap<{ items: GalaxyClusterLink[] }>(
    request.get('/knowledge-graph/galaxy/links', {
      params: { min_similarity: minSimilarity, limit },
    }),
  )
}

export interface GalaxySubcluster {
  cluster_id: number
  sub_cluster_id: number
  name: string
  keywords: string[]
  size: number
  year_from: number
  year_to: number
  centroid_x: number
  centroid_y: number
  silhouette: number
  /** 子簇的年度分布（需求里"看不同主题的时间分布"直接用它） */
  years: Array<{ year: number; count: number }>
}

export function getGalaxySubclusters(clusterId: number) {
  return unwrap<{ items: GalaxySubcluster[] }>(
    request.get(`/knowledge-graph/galaxy/clusters/${clusterId}/subclusters`),
  )
}

export interface GalaxyOutlier {
  record_id: string
  title: string
  cluster_id: number
  sub_cluster_id: number
  score: number
  local_density: number
  nearest_cluster_id: number
  nearest_cluster_name?: string | null
  cluster_name?: string | null
  archive_number?: string | null
  responsible_person?: string | null
  creation_date?: string | null
  /** 1 = 疑似误归入（更接近别的簇）；0 = 内容突变 */
  misplaced: number
  review_status: string
  review_issue_id: number
  detail: Record<string, unknown>
}

export function getGalaxyOutliers(params: {
  cluster_id?: number
  pattern?: 'misplaced' | 'drifted' | ''
  limit?: number
} = {}) {
  return unwrap<{ items: GalaxyOutlier[]; total: number }>(
    request.get('/knowledge-graph/galaxy/outliers', { params }),
  )
}

/** 一键发起著录复核：写入既有质量整改问题清单 */
export interface GalaxyDriftPoint {
  period: string
  granularity: string
  cluster_id: number
  sub_cluster_id: number
  count: number
  share: number
  centroid_x: number
  centroid_y: number
  top_keywords: string[]
  new_keywords: string[]
  gone_keywords: string[]
}

export interface GalaxyDriftMetric {
  cluster_id: number
  period: string
  centroid_shift: number
  keyword_turnover: number
  significant: boolean
}

export interface GalaxyDriftResult {
  granularity: string
  periods: string[]
  series: Array<{ cluster_id: number; points: GalaxyDriftPoint[] }>
  metrics: GalaxyDriftMetric[]
}

export function getGalaxyDrift(clusterId?: number, granularity = '') {
  return unwrap<GalaxyDriftResult>(
    request.get('/knowledge-graph/galaxy/drift', {
      params: { cluster_id: clusterId, granularity },
    }),
  )
}

/** 关注重点变化报告：默认取 markdown；docx 走同一接口的文件下载 */
export function getGalaxyDriftReport(clusterId?: number) {
  return unwrap<{
    markdown: string
    periods: string[]
    clusters: number
    /** 报告范围：主题群名（空 = 全部主题群） */
    scope_name?: string
  }>(
    request.get('/knowledge-graph/galaxy/drift/report', {
      params: { cluster_id: clusterId },
    }),
  )
}

/**
 * 下载关注重点变化报告（Word）。
 *
 * 必须走 axios 拿 Blob 再触发保存，不能拼 URL 交给 window.open：
 * 本项目的鉴权是 Authorization 请求头（见 request.ts 拦截器），
 * 浏览器直连下载不会带这个头，结果必然是 401。
 */
export async function downloadGalaxyDriftReport(clusterId?: number): Promise<void> {
  const report = await getGalaxyDriftReport(clusterId)
  const blob = new Blob([report.markdown], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${activeProfile().name}${activeProfile().terms.cluster}变化_${new Date().toISOString().slice(0, 10)}.md`
  a.click()
  URL.revokeObjectURL(url)
}

export interface GalaxyClusterBoard {
  cluster: {
    cluster_id: number
    name: string
    summary: string
    size: number
    keywords: string[]
    keyword_weights: Array<{ word: string; weight: number }>
    cluster_key: string
    sub_cluster_count: number
    year_from?: number | null
    year_to?: number | null
  }
  years: Array<{ year: number; count: number }>
  units: Array<{ name: string; count: number }>
  file_types: Array<{ name: string; count: number }>
  size_buckets: Array<{ bucket: string; count: number }>
  page_buckets: Array<{ bucket: string; count: number }>
  size_coverage: number
  subclusters: GalaxySubcluster[]
}

export function getGalaxyClusterBoard(clusterId: number) {
  return unwrap<GalaxyClusterBoard>(
    request.get(`/knowledge-graph/galaxy/clusters/${clusterId}/board`),
  )
}
