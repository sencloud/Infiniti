/**
 * 关系流向聚合（「流转」视图的数据源）
 *
 * 桑基图的三列 = **来源实体 → 关系 → 目标实体**，量取事实条数。
 * 于是流转视图回答的是：画布上的关系**从哪个实体、经由什么关系、落到哪个实体**——
 * 哪件公文支撑了哪件事、哪个部门在承办谁的活，一眼看得出来。
 *
 * 为什么是实体级而不是类型级：类型级只有"9 类实体 x 14 类谓词"这点格子，
 * 读出来的是"文献经常涉及主题"这种看一眼就知道的常识；真正要回答的是
 * **这件公文支撑了哪件事**，那是实体级才有的信息。
 *
 * 为什么不把时间放进桑基：时序视图已经用横轴表达时间（Timeline2DScene），
 * 再把它压成一列分类，只会把"哪条关系连的哪两个实体"丢掉，换回一张交叉表。
 *
 * 三条硬约束写在这里，避免以后被误读：
 *   1. 节点 name 必须唯一。同一个实体既可能是来源也可能是去向（A→B、B→C），
 *      桑基图里必须拆成左右两个节点，否则会形成环，echarts 直接报错。
 *      所以 name 用 `src::实体id` / `rel::谓词` / `dst::实体id` 作键，展示名另给。
 *   2. 只统计当前画布上的已发布关系，权重是事实条数而不是档案件数。
 *   3. 一张画布可能有上百个实体、上百条关系，全画出来是一团糊：
 *      按流量保留每列前 N 个实体、总共前 M 条流向，其余在面板里报数。
 *
 * 零额外请求：数据就是画布上已有的节点与边（页面的图例过滤已经生效）。
 */
import type { GraphData } from '@/api/knowledge-graph'
import { relationLabel } from '@/utils/graphStyle'
import { edgeEndId } from './graph3dConfig'

/** 每列保留的实体数上限（按流量降序） */
export const FLOW_ENTITY_LIMIT = 20
/** 保留的流向条数上限：桑基图读的是"主要通道"，画满就什么都读不出来 */
export const FLOW_LINK_LIMIT = 40
/** 实体名在画布上的截断长度（全名留给提示框与面板） */
export const FLOW_LABEL_MAX_CHARS = 14

/** 一条流向：来源实体 → 谓词 → 目标实体，量 = 事实条数 */
export interface FlowGroup {
  key: string
  srcId: string
  srcName: string
  srcLabel: string
  dstId: string
  dstName: string
  dstLabel: string
  /** 谓词原值（小写化，与图例过滤保持一致） */
  predicate: string
  value: number
}

export interface FlowNode {
  /** 桑基图的唯一键（见文件头约束 1），不直接展示 */
  name: string
  kind: 'src' | 'rel' | 'dst'
  /** 选中回传用的主键：实体 id（src/dst）或谓词（rel） */
  key: string
  /** 配色依据：实体类型（src/dst）或谓词（rel） */
  tone: string
  /** 画布上的展示名（实体名会截断） */
  display: string
  /** 全名：提示框与面板用 */
  fullName: string
  value: number
}

export interface FlowLink {
  source: string
  target: string
  value: number
  /** 回到 FlowGroup.key，点带子时下钻用 */
  groupKey: string
}

export interface FlowAggregate {
  nodes: FlowNode[]
  links: FlowLink[]
  groups: FlowGroup[]
  /** 画布上的流向总数（同一对实体的同一谓词已合并） */
  totalLinks: number
  /** 画布上涉及的实体数 */
  totalEntities: number
  /** 因可读性被截断掉的流向条数 */
  droppedLinks: number
  /** 被截断掉的实体数 */
  droppedEntities: number
  /** 全部流向的事实条数合计 */
  totalValue: number
  empty: boolean
}

/**
 * 流转视图里的"当前选中"：画布点选与面板筛选共用一套语义。
 *   group    单条流向（来源实体 → 谓词 → 目标实体）
 *   predicate 某个关系（中间列节点）
 *   src      某个来源实体（左列节点）
 *   dst      某个目标实体（右列节点）
 */
export interface FlowSelection {
  kind: 'group' | 'predicate' | 'src' | 'dst'
  key: string
}

export const EMPTY_FLOW: FlowAggregate = {
  nodes: [],
  links: [],
  groups: [],
  totalLinks: 0,
  totalEntities: 0,
  droppedLinks: 0,
  droppedEntities: 0,
  totalValue: 0,
  empty: true,
}

/** 展示名截断：画布上两三列标签挤在一起时，长题名必须让位给可读性 */
function truncate(name: string, max = FLOW_LABEL_MAX_CHARS): string {
  const text = String(name || '')
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/** 按权重取前 N 个键（同分按 id 排序，保证结果可复现） */
function topKeys(weights: Map<string, number>, limit: number): Set<string> {
  return new Set(
    [...weights.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, limit)
      .map(([key]) => key),
  )
}

/**
 * 边的"量"：优先用支撑该关系的事实条数。
 * support_count 缺失时退回 1（画布上的边本身就是一条已发布关系），
 * 这样既不会把权重算成 0（桑基图里 0 值会被丢弃），也不会凭空放大。
 */
function edgeValue(edge: { support_count?: number; claim_ids?: string[] }): number {
  if (edge.support_count != null && edge.support_count > 0) return edge.support_count
  if (edge.claim_ids?.length) return edge.claim_ids.length
  return 1
}

/** 画布图数据 -> 桑基图数据 + 流向明细 */
export function buildFlowAggregate(data: GraphData): FlowAggregate {
  const nodeById = new Map(data.nodes.map((node) => [node.id, node]))
  const groups = new Map<string, FlowGroup>()
  /** 实体作为来源 / 作为去向的流量：决定哪些实体值得画出来 */
  const srcWeight = new Map<string, number>()
  const dstWeight = new Map<string, number>()

  data.edges.forEach((edge) => {
    const src = nodeById.get(edgeEndId(edge.source))
    const dst = nodeById.get(edgeEndId(edge.target))
    // 图例过滤后仍可能有悬空边（只对画布可见性生效时不会），这里直接跳过
    if (!src || !dst || src.id === dst.id) return

    const predicate = String(edge.type || '').toLowerCase()
    if (!predicate) return
    const value = edgeValue(edge)
    const key = `${src.id}|${predicate}|${dst.id}`

    let group = groups.get(key)
    if (!group) {
      group = {
        key,
        srcId: src.id,
        srcName: src.name,
        srcLabel: src.label,
        dstId: dst.id,
        dstName: dst.name,
        dstLabel: dst.label,
        predicate,
        value: 0,
      }
      groups.set(key, group)
    }
    group.value += value
    srcWeight.set(src.id, (srcWeight.get(src.id) || 0) + value)
    dstWeight.set(dst.id, (dstWeight.get(dst.id) || 0) + value)
  })

  const all = [...groups.values()]
  // 先各列取前 N 个实体，再在它们之间取前 M 条流向：两刀下去才画得下
  const keptSrc = topKeys(srcWeight, FLOW_ENTITY_LIMIT)
  const keptDst = topKeys(dstWeight, FLOW_ENTITY_LIMIT)
  const kept = all
    .filter((group) => keptSrc.has(group.srcId) && keptDst.has(group.dstId))
    .sort((a, b) => b.value - a.value || a.key.localeCompare(b.key))
    .slice(0, FLOW_LINK_LIMIT)

  const nodes: FlowNode[] = []
  const nodeIndex = new Map<string, FlowNode>()
  const links: FlowLink[] = []

  /** 同键节点只建一次，值累加（左列实体 / 中间谓词 / 右列实体各自独立） */
  const ensureNode = (
    name: string,
    kind: FlowNode['kind'],
    key: string,
    tone: string,
    fullName: string,
    value: number,
  ) => {
    const hit = nodeIndex.get(name)
    if (hit) {
      hit.value += value
      return
    }
    const node: FlowNode = {
      name,
      kind,
      key,
      tone,
      display: kind === 'rel' ? relationLabel(key) : truncate(fullName),
      fullName: kind === 'rel' ? relationLabel(key) : fullName,
      value,
    }
    nodeIndex.set(name, node)
    nodes.push(node)
  }

  kept.forEach((group) => {
    const srcKey = `src::${group.srcId}`
    const relKey = `rel::${group.predicate}`
    const dstKey = `dst::${group.dstId}`
    ensureNode(srcKey, 'src', group.srcId, group.srcLabel, group.srcName, group.value)
    ensureNode(relKey, 'rel', group.predicate, group.predicate, group.predicate, group.value)
    ensureNode(dstKey, 'dst', group.dstId, group.dstLabel, group.dstName, group.value)
    links.push({ source: srcKey, target: relKey, value: group.value, groupKey: group.key })
    links.push({ source: relKey, target: dstKey, value: group.value, groupKey: group.key })
  })

  const allEntities = new Set(all.flatMap((group) => [group.srcId, group.dstId]))
  const drawnEntities = new Set(kept.flatMap((group) => [group.srcId, group.dstId]))

  return {
    nodes,
    links,
    groups: kept,
    totalLinks: all.length,
    totalEntities: allEntities.size,
    droppedLinks: all.length - kept.length,
    droppedEntities: allEntities.size - drawnEntities.size,
    totalValue: all.reduce((sum, group) => sum + group.value, 0),
    empty: kept.length === 0,
  }
}
