/**
 * 当前图谱的配置（水浒传 / 西游记 / 初中数学 …）。
 *
 * 后端 /api/knowledge-graph/graphs/:id 返回每个图谱的单元叫法、术语、本体、线索规则与示例；
 * 页面、图表构建函数、详情卡文案都从这里取，不再写死水浒传口径。
 *
 * 同一时刻只有一个激活图谱（路由 /g/:graphId/*），图谱切换时页面整体重挂载，
 * 所以非 React 模块（ECharts option 构建、时间维度推导）直接读模块级的 activeProfile() 即可。
 */

export interface GraphTerms {
  /** 单个片段的量词：段 / 章 */
  segment: string
  /** 顶栏计数后缀：段原文 / 章原文 / 段教材 */
  segments: string
  /** 语义聚类：情节群 / 议题群 / 知识群 */
  cluster: string
  /** 关系社区：团伙 / 师门 / 知识模块 */
  community: string
  /** 枢纽榜：枢纽人物 / 核心知识点 */
  hub: string
  /** 片段主体：人物 / 概念 */
  primary: string
  /** 片段次要实体：地点 / 方法 */
  secondary: string
  /** 原文 / 教材原文 */
  evidence: string
}

export interface GraphUnit {
  /** 回 / 篇 / 节 */
  name: string
  /** 时间轴标题：章回 / 篇目 / 课时 */
  axis: string
  total: number
  /** 「第{n}回」 */
  template: string
}

export interface OntologyEntityType {
  code: string
  name: string
  description?: string
}

export interface OntologyPredicate {
  code: string
  name: string
  domain: string[]
  range: string[]
  symmetric: boolean
  functional: boolean
  tone: string
}

export interface GraphUnitInfo {
  no: number
  title: string
  label?: string | null
  part?: string | null
}

export interface GraphStats {
  units: number
  entities: number
  claims: number
  clusters: number
}

export interface GraphProfile {
  id: string
  name: string
  book: string
  category: string
  kind: 'novel' | 'zhiguai' | 'analects' | 'history' | 'textbook' | string
  description: string
  cover: string
  source: { name: string; url: string }
  unit: GraphUnit
  period_size: number
  terms: GraphTerms
  galaxy: { primaryTypes: string[]; secondaryTypes: string[] }
  rules: Record<string, { name: string; hint: string }>
  examples: { search: string; from: string; to: string }
  props: Array<{ key: string; label: string }>
  ontology: {
    version: string
    entity_types: OntologyEntityType[]
    predicates: OntologyPredicate[]
  }
  stats?: GraphStats
  units?: GraphUnitInfo[]
}

/** 目录项（首页卡片）：比完整配置少本体与单元列表 */
export interface GraphSummary {
  id: string
  name: string
  book: string
  category: string
  kind: string
  description: string
  cover: string
  source: { name: string; url: string }
  unit: GraphUnit
  terms: GraphTerms
  stats: GraphStats
  ready: boolean
  /** 后台批处理进度（crawl / seeds / extract / load / build） */
  build?: {
    state?: 'running' | 'done' | 'failed'
    step?: string | null
    extracted?: number
    units?: number
    error?: string | null
    updated_at?: string
  } | null
}

let active: GraphProfile | null = null
let unitLabels = new Map<number, string>()
let unitTitles = new Map<number, string>()

export function setActiveProfile(profile: GraphProfile | null) {
  active = profile
  unitLabels = new Map((profile?.units || []).filter((u) => u.label).map((u) => [u.no, u.label as string]))
  unitTitles = new Map((profile?.units || []).map((u) => [u.no, u.title]))
}

export function activeGraphId(): string | null {
  return active?.id ?? null
}

export function activeProfile(): GraphProfile {
  if (!active) throw new Error('图谱配置尚未加载')
  return active
}

export const terms = (): GraphTerms => activeProfile().terms

/** 单元标签：「第12回」/「七上·1.2」 */
export function unitLabel(no: number | string | null | undefined): string {
  if (no == null || no === '') return ''
  const n = Number(no)
  const named = unitLabels.get(n)
  if (named) return named
  return activeProfile().unit.template.replace('{n}', String(n))
}

export function unitTitle(no: number): string {
  return unitTitles.get(Number(no)) || ''
}

/** 单元标签 + 标题：「第12回 汴京城杨志卖刀」 */
export function unitFull(no: number): string {
  return `${unitLabel(no)} ${unitTitle(no)}`.trim()
}

/** 区间：「第1–10回」；有名称的单元用两端标签 */
export function unitRange(lo: number | null | undefined, hi: number | null | undefined): string {
  if (lo == null || hi == null) return ''
  if (unitLabels.size) return lo === hi ? unitLabel(lo) : `${unitLabel(lo)} – ${unitLabel(hi)}`
  const unit = activeProfile().unit.name
  return lo === hi ? `第${lo}${unit}` : `第${lo}–${hi}${unit}`
}

export function maxUnit(): number {
  const p = activeProfile()
  return p.unit.total || p.units?.length || 120
}

export function entityTypeName(code: string): string {
  return activeProfile().ontology.entity_types.find((t) => t.code === code)?.name || code
}

export function predicateName(code: string): string {
  return activeProfile().ontology.predicates.find((p) => p.code === code)?.name || code
}

export function ruleName(code: string): string {
  return activeProfile().rules[code]?.name || code
}
