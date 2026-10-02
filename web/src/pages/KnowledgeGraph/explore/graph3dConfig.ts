/**
 * 3D 图谱的样式与访问器计算
 *
 * 从画布组件里抽出来的纯函数：度数统计、节点大小、标签分级、谓词配色、
 * 悬停提示的 HTML。这些逻辑与 Three.js 无关，单独放一处便于调参。
 */
import type { EntityMedia, GraphData, GraphEdge, GraphNode } from '@/api/knowledge-graph'
import { nodeColor, nodeLabel, relationLabel } from '@/utils/graphStyle'
import i18n from '@/i18n'
import { clusterPalette } from '@/theme/palette'

/**
 * 参与力导向的节点对象。
 *
 * 力导向会往对象上写 x/y/z（拖拽钉住写 fx/fy/fz），所以同一实体的对象必须
 * 跨数据更新保持同一引用，否则每次展开邻域都会把整张图重排一遍。
 */
export type SimNode = GraphNode & {
  x?: number
  y?: number
  z?: number
  fx?: number
  fy?: number
  fz?: number
  /** 节点体积值（由度数算出），供 nodeVal 访问器读取 */
  __val?: number
}

/** 边对象：力导向跑起来后 source/target 会从 id 字符串换成节点对象 */
export interface SimLink {
  source: string | SimNode
  target: string | SimNode
  type: string
  label?: string
  support_count?: number
}

/** 常显标签的节点数：只给最重要的一批挂标签，其余靠悬停提示。
 *  旧实现给每个节点都挂常显标签，中文长题名互相叠压成一团糊字，这是主因。 */
export const LABEL_TOP_N = 12

/** 常显标签的最大字数，超出截断（全称在悬停提示里看） */
export const LABEL_MAX_CHARS = 10

/** 标签在屏幕上的目标高度（像素）。
 *  标签 sprite 会按相机距离逐帧反缩放，所以拉近拉远都是这个字号——
 *  不改的话，凑近看关系时中文题名会撑满半个画布。 */
export const LABEL_SCREEN_PX = 13

/** 标签反缩放的夹取范围：太远不缩成蚂蚁，太近不糊成大标题 */
export const LABEL_SCALE_MIN = 0.18
export const LABEL_SCALE_MAX = 2.4

/** 标签避让的粗略尺寸（像素）：宽按文字长宽比算，高按药丸高度算。
 *  用于屏幕空间去重，宁可高估也别低估，否则两个标签会贴在一起。 */
export const LABEL_BOX_PADDING_X = 12
export const LABEL_BOX_HEIGHT_RATIO = 2.2

/** 首屏取景的状态机（纯数据，方便单测与调参） */
export interface FitState {
  /** 这次加载是否允许自动取景（有探索锚点时由飞翔镜头负责，取景关闭） */
  armed: boolean
  /** 已经取过景了：取景只做一次，之后不再动镜头 */
  done: boolean
  /** 引擎停稳后的那次校正是否已做（整轮只做一次） */
  settled: boolean
  /** 用户自己动过视角（滚轮/拖拽）：把镜头交给用户 */
  userMoved: boolean
  /** 包围球半径连续稳定的帧数 */
  stableFrames: number
  lastRadius: number
  start: number
}

/** 布局稳定判定：半径变化小于 1.5% 记一帧稳定；连续 36 帧（约 0.6 秒）视为稳定 */
export const FIT_STABLE_RATIO = 0.015
export const FIT_STABLE_FRAMES = 36
/** 兜底：布局迟迟不稳（大图重排很久）也先给一个可用视角 */
export const FIT_FALLBACK_MS = 3000

export function newFitState(armed: boolean, now: number): FitState {
  return {
    armed, done: false, settled: false, userMoved: false,
    stableFrames: 0, lastRadius: 0, start: now,
  }
}

/**
 * 这一帧要不要取景。会就地更新状态（调用方持有 ref）。
 *
 * 刻意做成"最多触发一次"：之前是每 600ms 重取一次，相机动画把画面一卡一卡地
 * 拽着缩放，用户滚轮还会被下一次自动取景覆盖。现在只有布局稳下来（或兜底超时）
 * 才取一次，取完 done=true 永不再动；用户动过视角则一次都不取。
 */
export function shouldFitCamera(state: FitState, radius: number, now: number): boolean {
  if (!state.armed || state.done || state.userMoved) return false
  const change = state.lastRadius > 0 ? Math.abs(radius - state.lastRadius) / radius : 1
  state.lastRadius = radius
  state.stableFrames = change < FIT_STABLE_RATIO ? state.stableFrames + 1 : 0
  if (state.stableFrames >= FIT_STABLE_FRAMES || now - state.start > FIT_FALLBACK_MS) {
    state.done = true
    return true
  }
  return false
}

/** 节点半径系数（nodeRelSize）：球体半径 = 体积值的立方根 × 该系数。
 *  画布与节点对象工厂必须用同一个值，否则标签会浮在球体里或飘太高。 */
export const NODE_REL_SIZE = 4

/** 边的两端在原始数据里是 id 字符串，力导向跑起来后会被替换成节点对象 */
export const edgeEndId = (end: unknown): string => (
  typeof end === 'object' && end !== null
    ? String((end as { id?: string }).id || '')
    : String(end || '')
)

/** 谓词 -> 颜色：同一谓词永远同色，不依赖出现顺序；色板取纸墨色相并随主题提亮 */
export function predicateColor(type: string): string {
  let hash = 0
  for (let i = 0; i < type.length; i += 1) hash = (hash * 31 + type.charCodeAt(i)) | 0
  const colors = clusterPalette()
  return colors[Math.abs(hash) % colors.length]
}

/** 每个节点的连边数，用于节点大小与标签分级 */
export function degreeMap(edges: GraphEdge[]): Map<string, number> {
  const degrees = new Map<string, number>()
  const bump = (id: string) => degrees.set(id, (degrees.get(id) || 0) + 1)
  edges.forEach((edge) => {
    bump(edgeEndId(edge.source))
    bump(edgeEndId(edge.target))
  })
  return degrees
}

/**
 * 节点体积值（nodeVal）。3d-force-graph 把它当球体体积，半径按立方根算，
 * 所以度数差 10 倍时半径只差 2 倍多，不会出现巨球压死小球。
 * 度数封顶：关系探索里人物枢纽能有几十条边，不封顶就会画成压死一切的巨球。
 */
export function nodeValue(degree: number, isCenter: boolean): number {
  const weight = Math.min(degree, 12)
  return (isCenter ? 14 : 4) + weight * 1.5
}

/**
 * 该挂常显标签的节点集合：度数最高的前 N 个 + 探索中心。
 * 聚焦与悬停节点的标签由画布按当前状态另外补，不进这个集合。
 */
export function labeledNodeIds(
  data: GraphData,
  degrees: Map<string, number>,
  centerId?: string | null,
): Set<string> {
  const ranked = [...data.nodes]
    .sort((a, b) => (degrees.get(b.id) || 0) - (degrees.get(a.id) || 0))
    .slice(0, LABEL_TOP_N)
    .map((node) => node.id)
  const ids = new Set(ranked)
  if (centerId) ids.add(centerId)
  return ids
}

/** 常显标签文字：截断到可读长度，避免长题名横贯半个画布 */
export function shortLabel(name: string): string {
  const text = String(name || '')
  return text.length > LABEL_MAX_CHARS ? `${text.slice(0, LABEL_MAX_CHARS)}…` : text
}

const escapeHtml = (value: unknown) => String(value ?? '').replace(
  /[&<>"']/g,
  (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] || char,
)

/**
 * 悬停提示的 HTML（nodeLabel 支持 HTML 字符串）。
 * 没有常显标签的节点全靠它看全称，所以缩略图、类型、全名都要给全。
 */
export function nodeTooltip(node: GraphNode, thumbUrl: string | null): string {
  const color = nodeColor(node.label).main
  const thumb = thumbUrl
    ? `<img class="g3d-tip-thumb" src="${escapeHtml(thumbUrl)}" alt="" />`
    : ''
  return `<div class="g3d-tip">
    ${thumb}
    <div class="g3d-tip-text">
      <div class="g3d-tip-name">${escapeHtml(node.name)}</div>
      <div class="g3d-tip-type" style="color:${color}">${escapeHtml(nodeLabel(node.label))}</div>
    </div>
  </div>`
}

/** 边的悬停提示：谓词中文名 + 支持该关系的事实条数（有 Claim 时提示可点击下钻） */
export function edgeTooltip(edge: GraphEdge): string {
  const relation = edge.label || relationLabel(edge.type)
  const support = edge.support_count ? ` · ${i18n.t('timeline.support', { count: edge.support_count })}` : ''
  const hint = edge.claim_ids?.length ? `<div class="g3d-tip-hint">${i18n.t('timeline.clickClaims')}</div>` : ''
  return `<div class="g3d-tip g3d-tip-edge">${escapeHtml(relation)}${escapeHtml(support)}${hint}</div>`
}

/** 节点是不是该贴图（有缩略图可用） */
export function hasThumb(node: GraphNode, media?: EntityMedia): boolean {
  return Boolean(node.attachment_id && (node.label === 'Photo' || node.label === 'Video'))
    || Boolean(media?.thumb_url)
}
