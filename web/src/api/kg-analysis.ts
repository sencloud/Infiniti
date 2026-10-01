/**
 * 知识图谱分析 API（关系探索页的「找线索」能力）
 *
 * 后端蓝图前缀 /api/knowledge-graph/analysis/*（request.ts 的 baseURL 已带 /api）。
 * 统一 unwrap 风格：失败抛 Error，页面 catch 后 message.error。
 *
 * 除路径探查外，全部只读 MySQL 预计算结果；预计算由 rebuildAnalysis() 触发。
 */
import request from './request'

interface ApiEnvelope {
  success?: boolean
  message?: string
  data?: unknown
}

async function unwrap<T>(promise: Promise<unknown>): Promise<T> {
  const res = (await promise) as ApiEnvelope | undefined
  if (res?.success === false) {
    throw new Error(res.message || '请求失败')
  }
  return ((res && 'data' in res ? res.data : res) ?? res) as T
}

/* ==================== 边强度 ==================== */

export interface EdgeMetric {
  edge_key: string
  src_entity_id: string
  predicate: string
  dst_entity_id: string
  claim_count: number
  /** 不同档案数：档案场景最认「多卷互证」 */
  archive_count: number
  /** 两端实体共同出现的档案数 */
  co_mention: number
  confidence_max: number
  confidence_avg: number
  first_year: number
  last_year: number
  /** 0-1 百分位权重，线宽直接用它 */
  weight: number
  sample_claim_ids?: string[]
}

/** 批量取边指标：key 形如 `src::PREDICATE::dst`，与语义图边 id 一致 */
export function getEdgeMetrics(edgeKeys: string[]) {
  return unwrap<{ items: Record<string, EdgeMetric> }>(
    request.get('/knowledge-graph/analysis/edges', {
      params: { keys: edgeKeys.join(',') },
    }),
  )
}

/* ==================== 枢纽实体 ==================== */

export interface HubEntity {
  entity_id: string
  canonical_name: string
  entity_type: string
  community_id: number
  weighted_degree: number
  /** 邻居分布在几个社区：跨板块度 */
  community_span: number
  hub_score: number
  rank_no: number
}

export function getHubs(entityType = '', limit = 30) {
  return unwrap<{ items: HubEntity[] }>(
    request.get('/knowledge-graph/analysis/hubs', {
      params: { entity_type: entityType, limit },
    }),
  )
}

/* ==================== 社区 ==================== */

export interface CommunityProfile {
  community_key: string
  community_id: number
  name: string
  summary: string
  keywords: string[]
  size: number
  year_from: number
  year_to: number
  rep_entity_id: string
  rep_name: string
  top_entities: Array<{ id: string; name: string; type: string }>
  top_predicates: Array<{ predicate: string; count: number }>
}

export interface CommunityBridge {
  id: number
  src_community_key: string
  dst_community_key: string
  edge_key: string
  predicate: string
  weight: number
  archive_count: number
  src_entity_id: string
  dst_entity_id: string
  src_name: string
  dst_name: string
}

export function getAnalysisCommunities(limit = 200) {
  return unwrap<{ items: CommunityProfile[] }>(
    request.get('/knowledge-graph/analysis/communities', { params: { limit } }),
  )
}

export function getCommunityBridges(communityKey: string, limit = 30) {
  return unwrap<{ items: CommunityBridge[] }>(
    request.get(`/knowledge-graph/analysis/communities/${communityKey}/bridges`, {
      params: { limit },
    }),
  )
}

/** 批量取实体所属社区指纹（社区模式给画布节点上色） */
export function getCommunityMembers(entityIds: string[]) {
  return unwrap<{ items: Record<string, string> }>(
    request.get('/knowledge-graph/analysis/communities/members', {
      params: { ids: entityIds.join(',') },
    }),
  )
}

/* ==================== 事件台账 ==================== */

export interface TimelineEntry {
  id: number
  src_entity_id: string
  dst_entity_id: string
  predicate: string
  event_year: number
  event_month: number
  /** 每条事实都按所在单元（回/篇/节）计时，固定为 event */
  event_source: 'event' | 'doc'
  doc_date: string
  claim_id: string
  record_id: string
  archive_number: string
  evidence_text: string
  confidence: number
}

export function getEntityTimeline(anchorId: string, yearFrom = 0, yearTo = 0, limit = 500) {
  return unwrap<{ items: TimelineEntry[]; total: number }>(
    request.get('/knowledge-graph/analysis/timeline', {
      params: { anchor_id: anchorId, year_from: yearFrom, year_to: yearTo, limit },
    }),
  )
}

export function getTimelineSpan() {
  return unwrap<{ min_year: number; max_year: number; rows_total: number }>(
    request.get('/knowledge-graph/analysis/timeline/span'),
  )
}

/* ==================== 异常（冲突 / 断点） ==================== */

/** 线索规则由图谱决定：小说/史传 R1–R4，教材 M1–M4，名称取当前图谱配置 */
export type AnomalyRule = string

export interface Anomaly {
  anomaly_id: string
  rule_code: AnomalyRule | string
  severity: 'high' | 'medium' | 'low'
  anchor_entity_id: string
  anchor_name: string
  title: string
  detail: Record<string, unknown>
  claim_id: string
  record_id: string
  archive_number: string
  evidence_text: string
  detected_at: string
}

export function getAnomalies(params: {
  rule_code?: string
  severity?: string
  anchor_id?: string
  limit?: number
  offset?: number
} = {}) {
  return unwrap<{ items: Anomaly[]; total: number; limit: number; offset: number }>(
    request.get('/knowledge-graph/analysis/anomalies', { params }),
  )
}

export function getAnalysisCoverage() {
  return unwrap<{
    entities: number
    entities_with_year: number
    year_coverage: number
    timeline_rows: number
    timeline_event_rows: number
  }>(request.get('/knowledge-graph/analysis/coverage'))
}

/* ==================== 两实体路径探查 ==================== */

export interface PathHop {
  from: string
  to: string
  from_name: string
  to_name: string
  /** out = 箭头从 A 侧指向 B 侧；in = 反向 */
  arrow: 'out' | 'in'
  predicate: string
  label: string
  confidence: number
  evidence_text: string
  page_no?: number | null
  record_id: string
  archive_number: string
  archive_title: string
  claim_id: string
}

export interface PathResult {
  found: boolean
  reason: string
  from: { id: string; name: string; label: string }
  to: { id: string; name: string; label: string }
  max_hops?: number
  truncated: boolean
  paths: Array<{
    hops: number
    score: number
    node_ids: string[]
    steps: PathHop[]
  }>
  graph?: {
    nodes: Array<{ id: string; name: string; label: string; is_root?: boolean }>
    edges: Array<{
      id: string
      source: string
      target: string
      type: string
      label: string
      confidence: number
      arrow: 'out' | 'in'
      record_id: string
      archive_number: string
      archive_title: string
    }>
  }
}

export function explorePaths(fromId: string, toId: string, maxHops = 3, maxPaths = 3) {
  return unwrap<PathResult>(
    request.get('/knowledge-graph/analysis/paths', {
      params: { from_id: fromId, to_id: toId, max_hops: maxHops, max_paths: maxPaths },
      timeout: 20000,
    }),
  )
}

/* ==================== 分析任务 ==================== */

export interface AnalysisJob {
  job_id: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  stage: string
  progress: number
  edges: number
  hubs: number
  communities: number
  timeline_rows: number
  anomalies: number
  error?: string | null
}

export const ANALYSIS_STAGE_LABELS: Record<string, string> = {
  '': '排队中',
  export: '导出事实与证据',
  edges: '计算关联强度',
  communities: '社区划分与命名',
  hubs: '识别枢纽实体',
  persist: '写回图谱',
  timeline: '跨社区桥接',
  anomalies: '线索检测',
  done: '已完成',
}

export function rebuildAnalysis() {
  return unwrap<{ job_id: string }>(
    request.post('/knowledge-graph/analysis/rebuild'),
  )
}

export function getAnalysisJob(jobId: string) {
  return unwrap<AnalysisJob>(request.get(`/knowledge-graph/analysis/jobs/${jobId}`))
}

export function getLatestAnalysisJob() {
  return unwrap<AnalysisJob | null>(request.get('/knowledge-graph/analysis/jobs/latest'))
}

export function cancelAnalysisJob(jobId: string) {
  return unwrap<{ job_id: string; cancelled: boolean }>(
    request.post(`/knowledge-graph/analysis/jobs/${jobId}/cancel`),
  )
}
