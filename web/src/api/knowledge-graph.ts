import request from './request'

export interface ApiResult<T> {
  success: boolean
  data: T
  message?: string
  code?: number
}

export interface GraphNode {
  id: string
  label: string
  name: string
  /** 媒体载体节点（Photo/Video）的附件标识，后端从图谱节点属性提到顶层 */
  attachment_id?: string
  /** image / video / audio，录音与视频共用 Video 类型时靠它区分 */
  kind?: string
  properties?: Record<string, unknown>
}

/** 实体缩略图：Photo/Video 取附件封面，Person 取人员库人脸头像 */
export interface EntityMedia {
  /** image / video / audio / avatar */
  kind: string
  /** 人员库里有此人但人脸还没登记时为空，此时节点仍画球体 */
  thumb_url?: string | null
  /** 原件地址：图片文件或视频流，avatar 类型为空 */
  file_url?: string | null
  /** 人员库 id，Person 实体才有，用于打开人员卡片 */
  person_id?: string | null
  /** 图集：公有领域古画 / 百科配图，带出处与许可 */
  gallery?: MediaImage[]
}

export interface MediaImage {
  src: string
  title?: string
  description?: string
  credit?: string
  license?: string
  /** commons（维基共享资源）/ baike（百度百科） */
  source?: string
  page_url?: string
  width?: number
  height?: number
}

export interface VideoEpisodeRef {
  ep: number
  title: string
  bvid: string
  page: number
}

export interface VideoEpisode {
  ep: number
  title: string
  page: number
  chapters: number[]
}

export interface VideoCatalog {
  source: { bvid: string; title: string; owner?: string; url?: string; note?: string } | null
  episodes: VideoEpisode[]
}

/** 当前图谱的影视对照表（没有时 episodes 为空） */
export function getVideoCatalog() {
  return request.get('/knowledge-graph/videos') as unknown as Promise<ApiResult<VideoCatalog>>
}

export interface GraphEdge {
  id?: string
  source: string
  target: string
  type: string
  label?: string
  confidence?: number
  support_count?: number
  claim_ids?: string[]
}

export interface GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

export interface KnowledgeGraphStats {
  neo4j_mode: boolean
  ontology_version: string
  summary: {
    archives: number
    entities: number
    mentions: number
    claims: number
    published_claims: number
    proposed_claims: number
    /** 标签层 Archive-[:TAGGED_AS]->Entity 的边数 */
    tag_links: number
    /** 标签层涉及到的实体数（与 entities 共用同一批节点） */
    tagged_entities: number
    /** 只被标签层建出来、还没有任何 Claim 的实体数 */
    tag_only_entities: number
  }
  entity_types: Array<{ type: string; count: number }>
  predicates: Array<{ predicate: string; status: string; count: number }>
}

export interface OntologyEntityType {
  code: string
  name: string
  description: string
}

export interface OntologyPredicate {
  code: string
  name: string
  domain: string[]
  range: string[]
  symmetric: boolean
  functional?: boolean
}

export interface Ontology {
  version: string
  entity_types: OntologyEntityType[]
  predicates: OntologyPredicate[]
  claim_statuses: string[]
  published_statuses: string[]
}

export interface EntityMergeSignals {
  shared_org: number
  neighbor_jaccard: number
  temporal_overlap: number
  alias_overlap: number
}

export interface EntityMergeCandidate {
  id: string
  entity_type: string
  normalized_name: string
  primary_entity_id: string
  candidate_entity_id: string
  primary_name: string
  candidate_name: string
  score: number
  auto_suggest: boolean
  signals: EntityMergeSignals
  status: string
  reviewer?: string
  review_comment?: string
  job_id?: string
  created_at: string
}

export interface KnowledgeGraphJob {
  job_id: string
  job_type: 'full_rebuild' | 'enhance' | 'incremental' | 'scoped_rebuild'
  status: string
  stage: string
  total_items: number
  processed_items: number
  success_items: number
  failed_items: number
  skipped_items: number
  current_record_id?: string
  error_message?: string
  progress: number
  created_at: string
  started_at?: string
  completed_at?: string
  config?: Record<string, unknown>
}

export interface Claim {
  claim_id: string
  predicate: string
  confidence: number
  evidence_text: string
  evidence_start?: number
  evidence_end?: number
  status: string
  validation_notes?: string
  record_id: string
  archive_title?: string
  subject: { entity_id: string; name: string; type: string }
  object: { entity_id: string; name: string; type: string }
}

export interface ArchiveEvidenceClaim extends Claim {
  /** 偏移量是否落在正文范围内，false 表示无法高亮 */
  offset_valid: boolean
  /** 该区间文本与证据是否一致（忽略空白）；false 表示正文可能已变更 */
  text_matches: boolean
}

export interface ArchiveEvidence {
  record_id: string
  title: string
  archive_number: string
  content: string
  /** 原文来源页面 */
  url?: string
  /** 按片段 id 打开时，该片段的原文（抽屉里额外标出） */
  focus_text?: string
  /** 教材类图谱：片段所在的教材页码 */
  focus_page?: number | null
  /** 教材类图谱：本节覆盖的页面原图 */
  pages?: Array<{ page: number; image: string }>
  chapter_no?: number
  /** 单元媒体：影视对照（水浒传央视版对应的集） */
  media?: { episodes?: VideoEpisodeRef[] } | null
  claims: ArchiveEvidenceClaim[]
}

export function getKnowledgeGraphStatus() {
  return request.get('/data-governance/knowledge-graph/status') as unknown as Promise<ApiResult<{
    neo4j_available: boolean
    model: string
    ontology: string
  }>>
}

export function getKnowledgeGraphStats() {
  return request.get('/data-governance/knowledge-graph/stats') as unknown as Promise<ApiResult<KnowledgeGraphStats>>
}

export function getKnowledgeGraphOntology() {
  return request.get('/data-governance/knowledge-graph/ontology') as unknown as Promise<ApiResult<Ontology>>
}

export function listKnowledgeGraphJobs(params?: { page?: number; page_size?: number }) {
  return request.get('/data-governance/knowledge-graph/jobs', { params }) as unknown as Promise<ApiResult<{
    items: KnowledgeGraphJob[]
    total: number
  }>>
}

export function createKnowledgeGraphRebuild(config?: Record<string, unknown>) {
  return request.post('/data-governance/knowledge-graph/jobs/rebuild', { config }) as unknown as Promise<ApiResult<{ job_id: string }>>
}

export function createKnowledgeGraphIncremental(config?: Record<string, unknown>) {
  return request.post('/data-governance/knowledge-graph/jobs/incremental', { config }) as unknown as Promise<ApiResult<{ job_id: string }>>
}

export function createKnowledgeGraphScopedRebuild(config: {
  category_codes?: string[]
  year_from?: string
  year_to?: string
}) {
  return request.post(
    '/data-governance/knowledge-graph/jobs/scoped-rebuild',
    { config },
  ) as unknown as Promise<ApiResult<{ job_id: string }>>
}

export function getKnowledgeGraphJob(jobId: string) {
  return request.get(`/data-governance/knowledge-graph/jobs/${jobId}`) as unknown as Promise<ApiResult<KnowledgeGraphJob>>
}

export function getKnowledgeGraphJobEvents(jobId: string, afterId?: number) {
  return request.get(`/data-governance/knowledge-graph/jobs/${jobId}/events`, {
    params: { after_id: afterId || 0 },
  })
}

export function getKnowledgeGraphFailedItems(
  jobId: string,
  params?: { page?: number; page_size?: number },
) {
  return request.get(`/data-governance/knowledge-graph/jobs/${jobId}/failed-items`, { params })
}

export function cancelKnowledgeGraphJob(jobId: string) {
  return request.post(`/data-governance/knowledge-graph/jobs/${jobId}/cancel`)
}

export function resumeKnowledgeGraphJob(jobId: string) {
  return request.post(`/data-governance/knowledge-graph/jobs/${jobId}/resume`)
}

/** 只重跑该任务里失败的档案，已成功的不会重复抽取 */
export function retryKnowledgeGraphFailedItems(jobId: string) {
  return request.post(
    `/data-governance/knowledge-graph/jobs/${jobId}/retry-failed`,
  ) as unknown as Promise<ApiResult<{ job_id: string; retried: number }>>
}

/** 批量删除已结束的构建任务（含明细与事件流），进行中的任务会被拒绝 */
export function deleteKnowledgeGraphJobs(jobIds: string[]) {
  return request.post(
    '/data-governance/knowledge-graph/jobs/delete',
    { job_ids: jobIds },
  ) as unknown as Promise<ApiResult<{ deleted: number; rejected: string[] }>>
}

export function getSemanticGraph(params?: {
  entity_id?: string
  depth?: number
  limit?: number
  min_confidence?: number
  predicate?: string[]
}) {
  return request.get('/data-governance/knowledge-graph/graph/semantic', { params }) as unknown as Promise<ApiResult<GraphData>>
}

export function getEvidenceGraph(params: {
  entity_id?: string
  claim_id?: string
  limit?: number
}) {
  return request.get('/data-governance/knowledge-graph/graph/evidence', { params }) as unknown as Promise<ApiResult<GraphData>>
}

export interface EntitySearchItem {
  entity_id: string
  entity_type: string
  canonical_name: string
  normalized_name: string
  aliases?: string[]
  identity_hint?: string
  claim_count: number
  /** 人物职务描述（Person 才有；后端从 title 属性或旧数据的身份线索兜底） */
  title?: string
  /** 人物隶属机构名（Person 才有；来自已发布的 AFFILIATED_WITH 事实） */
  organizations?: string[]
}

export function searchKnowledgeGraphEntities(params: {
  keyword?: string
  type?: string
  page?: number
  page_size?: number
}) {
  return request.get('/data-governance/knowledge-graph/entities/search', { params }) as unknown as Promise<ApiResult<{
    items: EntitySearchItem[]
    total: number
    page: number
    page_size: number
  }>>
}

export function getEntityNeighbors(
  entityId: string,
  params?: { limit?: number; min_confidence?: number },
) {
  return request.get(
    `/data-governance/knowledge-graph/entities/${entityId}/neighbors`,
    { params },
  )
}

export function getKnowledgeGraphEntity(entityId: string) {
  return request.get(
    `/data-governance/knowledge-graph/entities/${entityId}`,
  ) as unknown as Promise<ApiResult<Record<string, unknown>>>
}

export function listEntityMergeCandidates(params?: {
  status?: string
  type?: string
  min_score?: number
  page?: number
  page_size?: number
}) {
  return request.get(
    '/data-governance/knowledge-graph/entities/merge-candidates',
    { params },
  ) as unknown as Promise<ApiResult<{
    items: EntityMergeCandidate[]
    total: number
    page: number
    page_size: number
  }>>
}

/** 按当前图谱重新扫描同名实体，刷新待确认候选队列（不必重跑构建任务） */
export function generateEntityMergeCandidates() {
  return request.post(
    '/data-governance/knowledge-graph/entities/merge-candidates/generate',
  ) as unknown as Promise<ApiResult<{ generated: number }>>
}

export function rejectEntityMergeCandidate(candidateId: string, comment?: string) {
  return request.post(
    `/data-governance/knowledge-graph/entities/merge-candidates/${candidateId}/reject`,
    { comment },
  ) as unknown as Promise<ApiResult<{ id: string }>>
}

export function batchMergeEntityCandidates(candidateIds: string[], reason?: string) {
  return request.post(
    '/data-governance/knowledge-graph/entities/merge-candidates/batch-merge',
    { candidate_ids: candidateIds, reason },
  ) as unknown as Promise<ApiResult<{
    groups: Array<{
      target_entity_id: string
      merged_entity_ids: string[]
      entity_type: string
    }>
    candidate_count: number
    merged_count: number
    conflicts_marked: number
  }>>
}

export function batchRejectEntityMergeCandidates(
  candidateIds: string[],
  comment?: string,
) {
  return request.post(
    '/data-governance/knowledge-graph/entities/merge-candidates/batch-reject',
    { candidate_ids: candidateIds, comment },
  ) as unknown as Promise<ApiResult<{ rejected: number }>>
}

/** 一键合并全部待确认候选；候选过多时分批处理，remaining 为剩余条数 */
export function mergeAllEntityCandidates(data?: {
  reason?: string
  type?: string
  min_score?: number
  limit?: number
}) {
  return request.post(
    '/data-governance/knowledge-graph/entities/merge-candidates/merge-all',
    data || {},
  ) as unknown as Promise<ApiResult<{
    groups: Array<{ target_entity_id: string; merged_entity_ids: string[] }>
    candidate_count: number
    merged_count: number
    remaining: number
  }>>
}

/** 实体的原文出处：出现在哪些档案、原文写法是什么 */
export interface EntitySource {
  record_id: string
  chapter_no?: number
  title?: string
  category_code?: string
  creation_date?: string
  responsible_person?: string
  mention_texts: string[]
  mention_count: number
  claim_count: number
  evidence_texts: string[]
  /** 标签层来源：这件档案在标签图谱里挂到该实体的标签值与维度 */
  tag_names?: string[]
  tag_dimensions?: string[]
  tag_confidence?: number
}

export function getEntitySources(entityId: string, limit = 20) {
  return request.get(
    `/data-governance/knowledge-graph/entities/${entityId}/sources`,
    { params: { limit } },
  ) as unknown as Promise<ApiResult<{
    entity_id: string
    items: EntitySource[]
  }>>
}

/** 批量解析实体缩略图。没有可用媒体的实体不会出现在返回里 */
export function getEntityMedia(entityIds: string[]) {
  return request.post(
    '/data-governance/knowledge-graph/entities/media',
    { entity_ids: entityIds },
  ) as unknown as Promise<ApiResult<{ items: Record<string, EntityMedia> }>>
}

export function mergeEntities(data: {
  target_entity_id: string
  source_entity_ids: string[]
  reason?: string
}) {
  return request.post('/data-governance/knowledge-graph/entities/merge', data) as unknown as Promise<ApiResult<{
    target_entity_id: string
    merged_entity_ids: string[]
    aliases: string[]
    conflicts_marked: number
  }>>
}

export function splitEntity(entityId: string) {
  return request.post(
    `/data-governance/knowledge-graph/entities/${entityId}/split`,
  ) as unknown as Promise<ApiResult<{
    entity_id: string
    record_ids: string[]
    created_entity_ids: string[]
  }>>
}

export function updateEntityAliases(entityId: string, aliases: string[]) {
  return request.post(
    `/data-governance/knowledge-graph/entities/${entityId}/aliases`,
    { aliases },
  ) as unknown as Promise<ApiResult<{ entity_id: string; aliases: string[] }>>
}

export function listClaims(params?: {
  status?: string
  keyword?: string
  page?: number
  page_size?: number
}) {
  return request.get('/data-governance/knowledge-graph/claims', { params }) as unknown as Promise<ApiResult<{
    items: Claim[]
    total: number
    page: number
    page_size: number
  }>>
}

export function reviewClaim(
  claimId: string,
  data: { status: 'human_verified' | 'rejected' | 'superseded'; reason?: string },
) {
  return request.post(`/data-governance/knowledge-graph/claims/${claimId}/review`, data) as unknown as Promise<ApiResult<Claim>>
}

export function batchReviewClaims(data: {
  claim_ids: string[]
  status: 'human_verified' | 'rejected' | 'superseded'
  reason?: string
}) {
  return request.post(
    '/data-governance/knowledge-graph/claims/batch-review',
    data,
  ) as unknown as Promise<ApiResult<{ updated: number; claims: Claim[] }>>
}

/** 一键改判当前筛选条件下的全部 Claim，不受分页限制 */
export function reviewAllClaims(data: {
  from_status?: string
  status: 'human_verified' | 'rejected' | 'superseded'
  keyword?: string
  reason?: string
}) {
  return request.post(
    '/data-governance/knowledge-graph/claims/review-all',
    data,
  ) as unknown as Promise<ApiResult<{ updated: number }>>
}

export function listClaimConflicts(limit = 100) {
  return request.get(
    '/data-governance/knowledge-graph/claims/conflicts',
    { params: { limit } },
  ) as unknown as Promise<ApiResult<{ items: Array<Record<string, string>> }>>
}

/** 按 claim_id 批量取 Claim 详情：关系探索页点边下钻看关系体实例用 */
export function getClaimsByIds(claimIds: string[]) {
  return request.post(
    '/data-governance/knowledge-graph/claims/by-ids',
    { claim_ids: claimIds },
  ) as unknown as Promise<ApiResult<{ items: Claim[] }>>
}

export function listClaimReviews(params?: {
  status?: string
  page?: number
  page_size?: number
}) {
  return request.get('/data-governance/knowledge-graph/reviews', { params })
}

export function enhanceKnowledgeGraph(data: {
  record_ids: string[]
  all_tagged?: boolean
}) {
  return request.post('/data-governance/knowledge-graph/archives/enhance', data) as unknown as Promise<ApiResult<{ job_id: string }>>
}

// ==================== 标签图谱层 ====================
// 由 archive_smart_tags 直接转成实体节点与档案标签边，零大模型调用。
// 只有"点"，没有带谓词与证据的"边"，所以不能替代 Claim 层。

export interface TagGraphBuildResult {
  archives: number
  tag_links: number
  missing_archives: number
  skipped_records: string[]
  deleted_links?: number
}

export interface TagGraphStats {
  summary: { tag_links: number; archives: number; entities: number }
  dimensions: Array<{
    dimension: string
    entity_type: string
    links: number
    entities: number
  }>
  mappable_dimensions: string[]
}

export interface TagGraphArchive {
  record_id: string
  title: string
  category_code?: string
  creation_date?: string
  matched_tags: number
  tag_names: string[]
  dimensions: string[]
  top_confidence: number
}

export interface TagGraphEntity {
  entity_id: string
  name: string
  entity_type: string
  dimensions: string[]
  archive_count: number
}

export function buildTagGraph(data?: { record_ids?: string[]; rebuild?: boolean }) {
  return request.post(
    '/data-governance/knowledge-graph/tag-graph/build',
    data || {},
  ) as unknown as Promise<ApiResult<TagGraphBuildResult>>
}

export function getTagGraphStats() {
  return request.get(
    '/data-governance/knowledge-graph/tag-graph/stats',
  ) as unknown as Promise<ApiResult<TagGraphStats>>
}

export function listArchivesByTags(params: {
  dimension?: string
  tag?: string[]
  entity_type?: string
  min_confidence?: number
  match_all?: boolean
  limit?: number
}) {
  return request.get('/data-governance/knowledge-graph/tag-graph/archives', {
    params,
  }) as unknown as Promise<ApiResult<{ items: TagGraphArchive[] }>>
}

export function listTagGraphEntities(params?: {
  dimension?: string
  keyword?: string
  limit?: number
}) {
  return request.get('/data-governance/knowledge-graph/tag-graph/entities', {
    params,
  }) as unknown as Promise<ApiResult<{ items: TagGraphEntity[] }>>
}

export function getRelatedArchives(recordId: string, limit = 10) {
  return request.get(`/data-governance/knowledge-graph/related/${recordId}`, {
    params: { limit },
  })
}

export function getArchiveEvidence(recordId: string) {
  return request.get(
    `/data-governance/knowledge-graph/archives/${recordId}/evidence`,
  ) as unknown as Promise<ApiResult<ArchiveEvidence>>
}
