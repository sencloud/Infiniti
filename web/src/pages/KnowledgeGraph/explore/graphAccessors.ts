/**
 * 图库访问器（节点/边的可见性、配色、提示、粗细、粒子）
 *
 * 全部用 useCallback 固定函数引用是关键：3d-force-graph 按引用比对属性，
 * 只要访问器换了新引用，就会重算可见性、重建边的圆柱几何体。不 memo 的话，
 * 点一下节点（父组件重渲染）就会把整张图的几何体重建一遍，肉眼可见地卡。
 *
 * 过滤走可见性访问器而不是裁数据，也是同一个道理：裁数据会让节点对象换引用，
 * 力导向把已经铺开的布局整个重算。
 */
import { useCallback } from 'react'

import type { EntityMedia } from '@/api/knowledge-graph'
import { nodeColor } from '@/utils/graphStyle'
import {
  edgeEndId,
  nodeTooltip,
  predicateColor,
  type SimLink,
  type SimNode,
} from './graph3dConfig'
import { nodeThumbUrl } from './nodeMedia'
import type { TimeDimension } from './timeDimension'

/** 被聚焦邻域排除在外的节点/边的压暗色（浅底上"压暗"其实是提浅） */
const DIM_COLOR = 'rgba(148,163,184,0.45)'

interface Options {
  media?: Record<string, EntityMedia | undefined>
  hiddenTypes: Set<string>
  hiddenPredicates: Set<string>
  /** 聚焦节点及其直接邻居；null = 未聚焦（全图可见） */
  focusNeighbors: Set<string> | null
  focusId?: string | null
  /** 聚焦时只留连着聚焦节点的边（小屏上邻居之间的边会糊成一团） */
  focusStar?: boolean
  timeDim?: TimeDimension | null
  yearLo?: number
  yearHi?: number
  /** id -> 节点对象，边的可见性要靠它反查两端 */
  nodeById: (id: string) => SimNode | undefined
  /** 边强度预计算结果（key 形如 `src::PRED::dst`）；有值时线宽按它渲染 */
  edgeWeights?: Record<string, number>
  /** 社区配色：按节点返回社区色（社区模式下把同一板块画成同色） */
  communityColorOf?: (nodeId: string) => string | undefined
}

export function useGraphAccessors({
  media,
  hiddenTypes,
  hiddenPredicates,
  focusNeighbors,
  focusId,
  focusStar,
  timeDim,
  yearLo,
  yearHi,
  nodeById,
  edgeWeights,
  communityColorOf,
}: Options) {
  const nodeVisibility = useCallback((node: SimNode) => {
    if (hiddenTypes.has(node.label)) return false
    if (focusNeighbors && !focusNeighbors.has(node.id)) return false
    // 时间轴筛选：区间外隐藏，聚焦节点豁免（否则会把当前上下文也筛掉）
    if (timeDim && yearLo != null && yearHi != null && node.id !== focusId) {
      const year = timeDim.years.get(node.id)
      if (year != null && (year < yearLo || year > yearHi)) return false
    }
    return true
  }, [hiddenTypes, focusNeighbors, timeDim, yearLo, yearHi, focusId])

  const linkVisibility = useCallback((link: SimLink) => {
    if (hiddenPredicates.has(link.type.toLowerCase())) return false
    const sourceId = edgeEndId(link.source)
    const targetId = edgeEndId(link.target)
    if (focusStar && focusId && sourceId !== focusId && targetId !== focusId) return false
    const source = nodeById(sourceId)
    const target = nodeById(targetId)
    return Boolean(source && target && nodeVisibility(source) && nodeVisibility(target))
  }, [hiddenPredicates, nodeVisibility, nodeById, focusStar, focusId])

  /** 聚焦时非邻域压暗；未聚焦时一律正常上色 */
  const dimmed = useCallback(
    (nodeId: string) => Boolean(focusNeighbors && !focusNeighbors.has(nodeId)),
    [focusNeighbors],
  )

  const nodeColorOf = useCallback(
    (node: SimNode) => {
      if (dimmed(node.id)) return DIM_COLOR
      // 社区模式优先用社区色：同一板块一眼同色，跨板块桥接才看得出来
      const community = communityColorOf?.(node.id)
      return community || nodeColor(node.label).main
    },
    [dimmed, communityColorOf],
  )

  const nodeTooltipOf = useCallback(
    (node: SimNode) => nodeTooltip(node, nodeThumbUrl(node, media?.[node.id])),
    [media],
  )

  /**
   * 一律不用图库的默认球体：节点长相全在 nodeThreeObject 里画
   * （有贴图的贴图，没贴图的画柔和光点），球体叠上去只会变成生硬的色块。
   */
  const nodeThreeObjectExtend = useCallback(
    () => false,
    [],
  )

  /**
   * 线宽：优先用预计算的边强度（多因子：事实数 / 档案数 / 共现 / 置信度），
   * 没有预算结果时退回"支持事实越多越粗"的旧口径。
   * 非零宽度会走圆柱几何体，线宽在 3D 下真实生效。
   */
  const linkWidth = useCallback(
    (link: SimLink) => {
      if (edgeWeights) {
        const key = `${edgeEndId(link.source)}::${link.type}::${edgeEndId(link.target)}`
        const weight = edgeWeights[key]
        if (weight != null) return 0.5 + weight * 2.2
      }
      // 线宽整体收细：旧口径最粗到 3.3，关系一多就糊成一团蓝线
      return 0.5 + Math.min(link.support_count || 1, 5) * 0.28
    },
    [edgeWeights],
  )

  /**
   * 箭头只在聚焦/悬停时画。全局视图里每条边都带箭头，方向信息没多多少，
   * 视觉噪声却翻倍；要看方向就点开某个节点。
   */
  const linkArrowLength = useCallback(
    (link: SimLink) => {
      if (hiddenPredicates.has(link.type.toLowerCase())) return 0
      const inFocus = Boolean(
        focusNeighbors
        && !dimmed(edgeEndId(link.source))
        && !dimmed(edgeEndId(link.target)),
      )
      return inFocus ? 3.2 : 0
    },
    [focusNeighbors, dimmed, hiddenPredicates],
  )

  const linkColorOf = useCallback((link: SimLink) => (
    dimmed(edgeEndId(link.source)) || dimmed(edgeEndId(link.target))
      ? DIM_COLOR
      : predicateColor(link.type)
  ), [dimmed])

  const arrowColorOf = useCallback((link: SimLink) => predicateColor(link.type), [])

  /** 聚焦邻域的边跑流动粒子，一眼看出关系走向；全局视图不开，避免拖性能 */
  const linkParticles = useCallback((link: SimLink) => (
    focusNeighbors && !dimmed(edgeEndId(link.source)) && !dimmed(edgeEndId(link.target)) ? 2 : 0
  ), [focusNeighbors, dimmed])

  return {
    nodeVisibility,
    linkVisibility,
    nodeColorOf,
    nodeTooltipOf,
    nodeThreeObjectExtend,
    linkWidth,
    linkArrowLength,
    linkColorOf,
    arrowColorOf,
    linkParticles,
  }
}
