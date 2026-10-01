/**
 * 时间维度推导：时间轴就是单元序号（水浒传第 1–120 回、史记第 1–130 篇、数学按课时排序）。
 *
 * 实体的时间 = 首次出现的单元序号（后端 Entity.first_chapter）。
 * 为了少改下游，字段名沿用 year / lo / hi，取值都是单元序号。
 */
import type { GraphData } from '@/api/knowledge-graph'
import { maxUnit } from '@/graph/profile'

/** 时间锚点：单元序号；month 恒为 0（单元没有更细的粒度） */
export interface YearMoment {
  year: number
  month: number
  value: number
}

export interface TimeDimension {
  /** 实体 id -> 回数（有时间锚点的实体才有条目） */
  years: Map<string, number>
  /** 实体 id -> 时间锚点（时序视图横轴用，键集合与 years 一致） */
  moments: Map<string, YearMoment>
  /** 数据自适应的单元范围（最小跨度 10，夹在 1–总单元数之内） */
  lo: number
  hi: number
}

function chapterOf(value: unknown): number | null {
  const n = Number(value)
  return Number.isFinite(n) && n >= 1 && n <= maxUnit() ? n : null
}

/** 无任何时间锚点时返回 null（此时隐藏时间轴与地层） */
export function deriveTimeDimension(data: GraphData): TimeDimension | null {
  const years = new Map<string, number>()
  data.nodes.forEach((node) => {
    const ch = chapterOf(node.properties?.first_chapter)
    if (ch != null) years.set(node.id, ch)
  })
  const values = [...years.values()]
  if (!values.length) return null
  let lo = Math.min(...values)
  let hi = Math.max(...values)
  if (hi - lo < 10) {
    const mid = (lo + hi) / 2
    lo = mid - 5
    hi = mid + 5
  }
  lo = Math.max(1, Math.floor(lo))
  hi = Math.min(maxUnit(), Math.ceil(hi))

  const moments = new Map<string, YearMoment>()
  years.forEach((year, id) => moments.set(id, { year, month: 0, value: year }))
  return { years, moments, lo, hi }
}

/** 时间分层的 Y 轴总跨度（图坐标单位）：前面的回在上，后面的回在下 */
export const TIME_LAYER_SPAN = 420

/** 回数 -> 分层高度。范围外的回数夹到端点，跨度为 0 时落在中央平面 */
export function yearToLayerY(year: number, lo: number, hi: number): number {
  const span = hi - lo
  if (span <= 0) return 0
  const ratio = (Math.min(Math.max(year, lo), hi) - lo) / span
  return TIME_LAYER_SPAN / 2 - ratio * TIME_LAYER_SPAN
}

/** d3-force 的力函数：只需要 (alpha) 调用签名 + initialize 拿到节点数组 */
interface LayoutNode {
  id?: string | number
  y?: number
  vy?: number
}

/**
 * 时间分层力：把有时间锚点的实体拉到自己的章回层。
 *
 * rangeLo/rangeHi 是分层映射区间（默认用维度全范围）。拖左侧章回轴时分层跟着重映射，
 * 可见的锚点节点始终铺满整个 Y 轴跨度。
 *
 * 只对有锚点的节点施力：没锚点的节点继续由斥力/弹簧在三维里自由铺开，
 * 否则整张图会被压成一个平面。
 */
export function timeLayerForce(
  dimension: TimeDimension,
  rangeLo?: number,
  rangeHi?: number,
) {
  const hasRange = rangeLo != null && rangeHi != null && rangeHi > rangeLo
  const lo = hasRange ? (rangeLo as number) : dimension.lo
  const hi = hasRange ? (rangeHi as number) : dimension.hi
  let nodes: LayoutNode[] = []
  const force = (alpha: number) => {
    nodes.forEach((node) => {
      const year = dimension.years.get(String(node.id))
      if (year == null) return
      const targetY = yearToLayerY(year, lo, hi)
      node.vy = (node.vy || 0) + (targetY - (node.y || 0)) * 0.28 * alpha
    })
  }
  force.initialize = (simulationNodes: LayoutNode[]) => { nodes = simulationNodes }
  return force
}
