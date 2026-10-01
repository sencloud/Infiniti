/**
 * 实体属性键的中文映射（详情卡展示用）
 *
 * 属性来自 Neo4j Entity 节点（src/scripts/kg/load.js 写入）；
 * 图谱特有的属性名（水浒的「星号/座次」、三国的「表字」）由当前图谱配置 props 提供。
 * 未收录的键原样显示（宁缺勿错，不猜翻译）。
 */
import { activeProfile, unitLabel } from '@/graph/profile'

const BASE_LABELS: Record<string, string> = {
  entity_id: '实体标识',
  entity_type: '实体类型',
  canonical_name: '规范名',
  normalized_name: '归一名',
  aliases: '别称',
  nickname: '别号',
  star: '星号',
  rank: '座次',
  role: '身份',
  description: '简介',
  identity_hint: '身份提示',
  title: '身份',
  claim_count: '关系事实数',
  mention_count: '原文提及',
  chapter_count: '出场次数',
  first_chapter: '首次出现',
  last_chapter: '最后出现',
  degree: '直接关系数',
  hub_score: '枢纽分',
  community_span: '跨社区数',
}

export function propLabel(key: string): string {
  const custom = activeProfile().props.find((p) => p.key === key)?.label
  if (custom) return custom
  if (key === 'chapter_count') return `出现${activeProfile().unit.name}数`
  return BASE_LABELS[key] || key
}

export function formatPropValue(value: unknown, maxLen = 60, key?: string): string {
  if (value == null) return ''
  if (key === 'first_chapter' || key === 'last_chapter') return unitLabel(Number(value))
  if (key === 'rank') return `第${value}位`
  if (Array.isArray(value)) return value.slice(0, 5).join('、')
  if (typeof value === 'number' && !Number.isInteger(value)) return value.toFixed(3)
  const text = String(value)
  return text.length > maxLen ? `${text.slice(0, maxLen)}…` : text
}

/** 详情卡展示时跳过这些纯技术字段 */
export const SKIPPED_PROPS = new Set([
  'entity_id',
  'entity_type',
  'graph_id',
  'key',
  'name',
  'canonical_name',
  'normalized_name',
  'status',
  'is_hero',
  'community_key',
  'community_id',
  'weighted_degree',
  'hub_rank',
  'hub_score',
  'community_span',
  'media',
])
