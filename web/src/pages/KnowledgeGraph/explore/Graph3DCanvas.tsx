/**
 * 3D 图谱画布（基于 react-force-graph-3d / 3d-force-graph）
 *
 * 替换掉原来手写的 Three.js 力导向引擎。换库解决的是三个结构性问题：
 *   1. 布局：内部用 d3-force-3d（Barnes-Hut），斥力不做距离截断，
 *      图在三维里真正铺开，不再塌成一个平面圆饼。
 *   2. 边：linkWidth 非零时走圆柱几何体，线宽真实生效。
 *      手写版用 LineBasicMaterial，WebGL 下线宽恒为 1px，关系几乎看不见。
 *   3. 标签：CSS2DRenderer 渲染真 DOM 标签，且只给重要节点常显，
 *      其余靠悬停提示，中文长题名不再互相叠压成一团。
 *
 * 画布底色跟随纸墨主题（亮：纸色 / 暗：墨蓝）。不上 UnrealBloom 泛光，
 * 层次靠边的粗细、方向箭头、节点大小分级和聚焦时的压暗来做。
 *
 * 本文件只负责编排：数据装配、引擎参数、相机、标签与视频同步。
 * 节点长什么样在 nodeObject.ts，访问器在 graphAccessors.ts，贴图在 nodeMedia.ts。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ForceGraph3D, { type ForceGraphMethods } from 'react-force-graph-3d'
import * as THREE from 'three'
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js'

import type { EntityMedia, GraphData, GraphEdge, GraphNode } from '@/api/knowledge-graph'
import {
  degreeMap,
  edgeEndId,
  edgeTooltip,
  LABEL_SCALE_MAX,
  LABEL_SCALE_MIN,
  LABEL_BOX_HEIGHT_RATIO,
  LABEL_BOX_PADDING_X,
  LABEL_SCREEN_PX,
  labeledNodeIds,
  newFitState,
  NODE_REL_SIZE,
  nodeValue,
  shouldFitCamera,
  type FitState,
  type SimLink,
  type SimNode,
} from './graph3dConfig'
import { useGraphAccessors } from './graphAccessors'
import {
  buildNodeObject,
  LABEL_TEXT_HEIGHT,
  type LabelSprite,
  type NodeObjectRegistry,
} from './nodeObject'
import { playVideo } from './nodeMedia'
import { timeLayerForce, type TimeDimension } from './timeDimension'
import { palette } from '@/theme/palette'
import { useTheme } from '@/theme/ThemeProvider'
import { useIsMobile } from '@/hooks/useIsMobile'

export interface Graph3DHandle {
  /** 相机平滑飞到某节点 */
  focusOn: (nodeId: string) => void
  /** 回到能装下全图的视角 */
  resetView: () => void
  /** 松开所有被拖拽钉住的节点，交还给力导向 */
  unpinAll: () => void
}

interface Props {
  data: GraphData
  /** 探索中心（搜索锚点）：放大、常显标签，并把相机飞过去 */
  centerId?: string | null
  /** 聚焦节点：只显示它与直接邻居，邻接边跑流动粒子 */
  focusId?: string | null
  /** 实体缩略图（entity_id -> 媒体），决定节点贴不贴真图。
   *  值为 undefined 表示已解析过但没有可用媒体，避免上层反复请求 */
  media?: Record<string, EntityMedia | undefined>
  /** 时间维度：开启分层时按年代拉开 Y 轴 */
  timeDim?: TimeDimension | null
  timeLayer?: boolean
  /** 时间轴筛选区间：区间外的节点隐藏（聚焦节点豁免） */
  yearLo?: number
  yearHi?: number
  /** 图例过滤：被关掉的实体类型与关系谓词 */
  hiddenTypes: Set<string>
  hiddenPredicates: Set<string>
  /** 边强度预算结果（key 形如 `src::PRED::dst`）：强度模式下线宽改用它 */
  edgeWeights?: Record<string, number>
  /** 社区配色：社区模式下同一板块同色 */
  communityColorOf?: (nodeId: string) => string | undefined
  onNodeClick?: (node: GraphNode) => void
  onNodeRightClick?: (node: GraphNode) => void
  /** 点击边：打开关系详情抽屉（下钻看聚合边背后的 Claim 实例） */
  onLinkClick?: (edge: GraphEdge) => void
  onBackgroundClick?: () => void
  onCanvasReady?: (handle: Graph3DHandle) => void
}

export default function Graph3DCanvas({
  data,
  centerId,
  focusId,
  media,
  timeDim,
  timeLayer,
  yearLo,
  yearHi,
  hiddenTypes,
  hiddenPredicates,
  edgeWeights,
  communityColorOf,
  onNodeClick,
  onNodeRightClick,
  onLinkClick,
  onBackgroundClick,
  onCanvasReady,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const { theme } = useTheme()
  const mobile = useIsMobile()
  const fgRef = useRef<ForceGraphMethods<SimNode, SimLink> | undefined>(undefined)
  const [size, setSize] = useState({ width: 0, height: 0 })
  /** 节点对象仓库：同一实体跨更新复用对象，展开邻域时已有节点不会跳位 */
  const nodeStore = useRef(new Map<string, SimNode>())
  /** 节点内的标签与视频：靠直接改它们的 visible / style 切换，不重建三维对象 */
  const dom = useRef<NodeObjectRegistry>({ labels: new Map(), videos: new Map() })
  /** 当前悬停节点：标签避让每帧都要读，放 ref 免得把 rAF 循环挂到 state 上 */
  const hoverIdRef = useRef<string | null>(null)

  /* ---------- 尺寸自适应 ---------- */

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const observer = new ResizeObserver(() => {
      setSize({ width: host.clientWidth, height: host.clientHeight })
    })
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  /* ---------- 数据装配 ---------- */

  const degrees = useMemo(() => degreeMap(data.edges), [data.edges])
  const labeledIds = useMemo(
    () => labeledNodeIds(data, degrees, centerId),
    [data, degrees, centerId],
  )

  const graphData = useMemo(() => {
    const store = nodeStore.current
    const nextIds = new Set(data.nodes.map((node) => node.id))
    // 数据里已经没有的节点，连同它的标签/视频 DOM 一起清掉，避免游离元素堆积
    store.forEach((_, id) => {
      if (nextIds.has(id)) return
      store.delete(id)
      dom.current.labels.delete(id)
      ;(dom.current.videos.get(id)?.element as HTMLVideoElement | undefined)?.pause()
      dom.current.videos.delete(id)
    })
    const nodes = data.nodes.map((node) => {
      const existing = store.get(node.id)
      // Object.assign 只覆盖业务字段，x/y/z 不在源数据里，坐标因此保留
      if (existing) return Object.assign(existing, node)
      const created: SimNode = { ...node }
      store.set(node.id, created)
      return created
    })
    nodes.forEach((node) => {
      node.__val = nodeValue(degrees.get(node.id) || 0, node.id === centerId)
    })
    // 边不保存布局状态，每次重建；source/target 统一回落成 id 字符串
    const links: SimLink[] = data.edges.map((edge) => ({
      ...edge,
      source: edgeEndId(edge.source),
      target: edgeEndId(edge.target),
    }))
    return { nodes, links }
  }, [data, degrees, centerId])

  /** 聚焦节点的直接邻居（含自身）：可见性与高亮都看它 */
  const focusNeighbors = useMemo(() => {
    if (!focusId) return null
    const ids = new Set([focusId])
    data.edges.forEach((edge) => {
      const source = edgeEndId(edge.source)
      const target = edgeEndId(edge.target)
      if (source === focusId) ids.add(target)
      else if (target === focusId) ids.add(source)
    })
    return ids
  }, [focusId, data.edges])

  /* ---------- 引擎初始化：力参数 ---------- */

  // CSS2DRenderer 只为视频节点的内联 <video> 服务（标签用 SpriteText）
  const extraRenderers = useMemo(() => [new CSS2DRenderer()], [])

  useEffect(() => {
    const fg = fgRef.current
    if (!fg) return
    // 灯光：图库默认是 0xcccccc 环境光 + 0.6 方向光，配 MeshLambertMaterial
    // 会把实体配色洗成灰扑扑的。环境光给足 + 方向光只留一点塑形，
    // 颜色才是调色板里的那个颜色。
    const directional = new THREE.DirectionalLight(0xffffff, Math.PI * 0.35)
    directional.position.set(1, 1.4, 1)
    fg.lights([new THREE.AmbientLight(0xffffff, Math.PI * 1.15), directional])
    // 斥力不设距离上限（手写版在距离 60 外直接不算斥力，节点因此挤成一坨）
    fg.d3Force('charge')?.strength(-300)
    // 支持事实越多的关系拉得越近，簇结构自然浮现
    fg.d3Force('link')
      ?.distance((link: SimLink) => 82 - Math.min(link.support_count || 1, 5) * 7)
    // 相机远近要有边界，但边界不能卡住用户：近到 18（能贴脸看一个节点），
    // 远到 1200（大图也能退开看全貌）。之前把最小距离设成 90，
    // 结果是"图看着小，还怎么都放不大"。
    const controls = fg.controls() as { minDistance?: number; maxDistance?: number } | undefined
    if (controls) {
      controls.minDistance = 18
      controls.maxDistance = 1200
    }
    // 只在引擎就绪后跑一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.width > 0])

  /** 时间分层力：开关切换或时间轴区间变化时重挂。
   *  分层映射区间跟随时间轴选中区间（yearLo/yearHi），拖时间轴即联动重排：
   *  可见的锚点节点始终铺满 Y 轴跨度，各年代层不会挤成一团。
   *  注意：未开分层时区间变化不重热模拟（只是可见性过滤，不该扰动布局）。 */
  useEffect(() => {
    const fg = fgRef.current
    if (!fg) return
    if (timeLayer && timeDim) {
      fg.d3Force('time', timeLayerForce(timeDim, yearLo, yearHi))
      fg.d3ReheatSimulation()
    } else {
      fg.d3Force('time', null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeLayer, timeDim, timeLayer ? yearLo : null, timeLayer ? yearHi : null])

  /* ---------- 相机 ---------- */

  /**
   * 取景状态。
   *
   * 只有「选中实体/带锚点进来」时才自动对焦：布局稳定后框一次，引擎停稳后
   * 再校正一次，最多两次；用户一动视角就永久交还镜头。
   * 主页的完整视图（没有锚点）刻意不对焦——那里图一直在重排，
   * 自动对焦只会变成一卡一卡地拽画面。
   */
  const fitGuard = useRef<FitState>(newFitState(true, 0))
  /** 可见性访问器在下面才建，取景时通过 ref 读最新的一份（避免 hook 顺序倒挂） */
  const nodeVisibilityRef = useRef<(node: SimNode) => boolean>(() => true)
  const hasNodes = data.nodes.length > 0

  /** 可见节点的外接半径：只用来判断布局稳没稳 */
  const visibleRadius = useCallback(() => {
    const box = new THREE.Box3()
    const point = new THREE.Vector3()
    let visible = 0
    nodeStore.current.forEach((node) => {
      if (node.x == null) return
      if (!nodeVisibilityRef.current(node)) return
      box.expandByPoint(point.set(node.x, node.y || 0, node.z || 0))
      visible += 1
    })
    if (!visible) return 0
    return box.getSize(new THREE.Vector3()).length() / 2
  }, [])

  /**
   * 取景：按「可见节点在屏幕平面上的投影」反推相机距离。
   *
   * 图库自带的 zoomToFit 有两个坑，直接用会让图看起来很小：
   *   1. 它按三维包围盒的最大边长算距离，节点在 Z 方向一散开就把距离撑大
   *      （关系图大多是扁平的一层，投影后只占半屏）；
   *   2. 它统计的是 graphData 里的全部节点，被图例过滤掉、被聚焦隐藏的节点
   *      照样算进去——过滤后剩下的那点节点自然被挤成一小团。
   * 这里改成：只用可见节点，把它们投影到相机的 right/up 平面上求最大占比，
   * 迭代两三次把画面利用率顶到 88%（剩下 12% 留给节点半径与标签）。
   */
  const fitCamera = useCallback((duration = 400) => {
    const fg = fgRef.current
    const camera = fg?.camera() as THREE.PerspectiveCamera | undefined
    if (!fg || !camera) return

    const points: THREE.Vector3[] = []
    nodeStore.current.forEach((node) => {
      if (node.x == null) return
      if (!nodeVisibilityRef.current(node)) return
      points.push(new THREE.Vector3(node.x, node.y || 0, node.z || 0))
    })
    if (!points.length) return

    const center = points
      .reduce((acc, point) => acc.add(point), new THREE.Vector3())
      .multiplyScalar(1 / points.length)
    // 保持当前视线方向，只调距离：用户转过的角度不会被拽回去
    const dir = camera.position.clone().sub(center)
    if (!Number.isFinite(dir.x) || dir.lengthSq() < 1e-6) dir.set(0, 0, 1)
    dir.normalize()
    const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0))
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0)
    right.normalize()
    const screenUp = new THREE.Vector3().crossVectors(right, dir).normalize()

    const tanHalf = Math.tan((camera.fov * Math.PI) / 360)
    const aspect = camera.aspect || 1
    /** 画面利用率：留 18% 给节点半径与标签，最外圈不会被裁 */
    const TARGET = 0.82

    let distance = Math.max(camera.position.distanceTo(center), 1)
    const offset = new THREE.Vector3()
    for (let iter = 0; iter < 3; iter += 1) {
      let need = 0
      points.forEach((point) => {
        offset.copy(point).sub(center)
        const depth = Math.max(distance - offset.dot(dir), 1)
        const x = Math.abs(offset.dot(right)) / (depth * tanHalf * aspect)
        const y = Math.abs(offset.dot(screenUp)) / (depth * tanHalf)
        need = Math.max(need, x, y)
      })
      if (need <= 0) return
      distance *= need / TARGET
    }

    const next = center.clone().add(dir.multiplyScalar(Math.max(distance, 24)))
    fg.cameraPosition(
      { x: next.x, y: next.y, z: next.z },
      { x: center.x, y: center.y, z: center.z },
      duration,
    )
  }, [])

  /**
   * 什么时候允许自动取景：只有选中了实体（带锚点进来 / 点了快速定位 / 搜索到实体）。
   * 主页完整视图（centerId 为空）不自动对焦——那里的图一直在重排，
   * 自动对焦就是"一卡一卡地拽画面"，用户明确不要。
   */
  useEffect(() => {
    const userMoved = fitGuard.current.userMoved
    fitGuard.current = { ...newFitState(Boolean(centerId), performance.now()), userMoved }
  }, [centerId, hasNodes])

  /**
   * 引擎停稳后再校正一次构图。
   *
   * 第一次取景用的是"布局刚稳"的包围球，力导向还会继续把图铺开一点，
   * 于是画面会偏在一侧。这里等 cooldown 结束（引擎自然停下）补一次 600ms 的
   * 平滑校正——整轮只做一次，不会像之前那样每 600ms 拉一下造成抖动。
   */
  const handleEngineStop = useCallback(() => {
    const guard = fitGuard.current
    if (!guard.armed || guard.settled || guard.userMoved || !guard.done) return
    guard.settled = true
    fitCamera(600)
  }, [fitCamera])

  /** 相机平滑飞到某节点：1200ms 过渡，不是硬跳视角。返回是否真的飞了 */
  const flyTo = useCallback((nodeId: string) => {
    const node = nodeStore.current.get(nodeId)
    const fg = fgRef.current
    if (!fg || !node || node.x == null) return false
    // 飞过去了就别再自动取景，否则会把刚聚焦的视角又拉回全图
    fitGuard.current.done = true
    // 沿当前视线方向退到 150 单位外：够近看得清人脸贴图，又装得下第一圈邻居
    const ratio = 1 + 150 / (Math.hypot(node.x, node.y || 0, node.z || 0) || 1)
    fg.cameraPosition(
      { x: node.x * ratio, y: (node.y || 0) * ratio, z: (node.z || 0) * ratio },
      { x: node.x, y: node.y || 0, z: node.z || 0 },
      1200,
    )
    return true
  }, [])

  useEffect(() => {
    if (!onCanvasReady) return
    onCanvasReady({
      focusOn: flyTo,
      resetView: () => {
        fitGuard.current.done = true
        fitCamera(600)
      },
      unpinAll: () => {
        nodeStore.current.forEach((node) => {
          node.fx = undefined
          node.fy = undefined
          node.fz = undefined
        })
        fgRef.current?.d3ReheatSimulation()
      },
    })
  }, [onCanvasReady, flyTo, fitCamera])

  /**
   * 换探索中心后飞过去。中心节点刚进画布时还没有坐标（力导向要先跑几帧），
   * 所以逐帧等它出现，最多等 4 秒——直接调用会因为 x 还是 undefined 而静默失败。
   */
  useEffect(() => {
    if (!centerId) return
    let frames = 0
    let raf = requestAnimationFrame(function attempt() {
      if (flyTo(centerId)) return
      if (frames++ < 240) raf = requestAnimationFrame(attempt)
    })
    return () => cancelAnimationFrame(raf)
  }, [centerId, flyTo])

  /* ---------- 标签与视频：直接操作 DOM，避免重建三维对象 ---------- */

  /** 标签显示规则：Top N / 探索中心 / 聚焦节点 / 悬停节点。
   *  放进 ref 是因为节点对象工厂不能依赖它（否则每次聚焦都重建全部节点），
   *  但建元素时又必须读到最新规则，否则新元素的初始显隐是旧闭包算出来的。 */
  const showLabelRef = useRef<(nodeId: string, hoverId: string | null) => boolean>(() => false)
  showLabelRef.current = (nodeId, hoverId) => (
    labeledIds.has(nodeId) || nodeId === focusId || nodeId === hoverId
  )

  const syncLabels = useCallback((hoverId: string | null) => {
    dom.current.labels.forEach((label, nodeId) => {
      label.visible = showLabelRef.current(nodeId, hoverId)
    })
  }, [])

  // 聚焦/中心变化会改变标签规则，节点对象重建也会产生新元素，都要重新同步
  useEffect(() => { syncLabels(null) }, [syncLabels, labeledIds, focusId, graphData])

  /**
   * 标签保持「屏幕上的字号恒定」。
   *
   * sprite 是三维对象，默认随镜头缩放：凑近看某个人的关系时，中文题名会放大成
   * 撑满画布的大字，互相叠压——这正是关系探索看着乱的主因。这里每帧按相机距离
   * 反缩放（世界高度 = 目标像素 × 每像素世界尺寸），远近观感一致，
   * 再用 LABEL_SCALE_MIN/MAX 夹住，避免极近极远时变成标题或蚂蚁。
   *
   * 同时做一次屏幕空间去重：一圈事件题名彼此重叠时，只保留优先级高的那几个
   * （探索中心 > 聚焦 > 悬停 > 度数），其余让位给悬停提示。这是标签可读性的关键，
   * 光把字号定住还不够。
   */
  const syncLabelScale = useCallback(() => {
    const fg = fgRef.current
    const camera = fg?.camera() as THREE.PerspectiveCamera | undefined
    if (!fg || !camera || !size.height) return
    const tanHalfFov = Math.tan((camera.fov * Math.PI) / 360)
    const world = new THREE.Vector3()
    const ndc = new THREE.Vector3()
    const placed: Array<[number, number, number, number]> = []
    const candidates: Array<{
      nodeId: string
      sprite: LabelSprite
      x: number
      y: number
      halfWidth: number
      halfHeight: number
      priority: number
      distance: number
      worldPerPx: number
    }> = []

    dom.current.labels.forEach((label, nodeId) => {
      const sprite = label as LabelSprite
      const base = sprite.__baseScale
      // 显隐规则每帧重算：规则（Top N / 中心 / 聚焦 / 悬停）与去重都在这里收口，
      // 避免上一帧藏掉的标签一直挂着
      if (!base || !showLabelRef.current(nodeId, hoverIdRef.current)) {
        sprite.visible = false
        return
      }
      label.getWorldPosition(world)
      ndc.copy(world).project(camera)
      const distance = Math.max(camera.position.distanceTo(world), 1)
      const worldPerPx = (2 * tanHalfFov * distance) / size.height
      if (ndc.z > 1) {
        sprite.visible = false
        return
      }
      const aspect = base.x / Math.max(base.y, 0.0001)
      candidates.push({
        nodeId,
        sprite,
        x: (ndc.x * 0.5 + 0.5) * size.width,
        y: (-ndc.y * 0.5 + 0.5) * size.height,
        halfWidth: (LABEL_SCREEN_PX * aspect + LABEL_BOX_PADDING_X) / 2,
        halfHeight: (LABEL_SCREEN_PX * LABEL_BOX_HEIGHT_RATIO) / 2,
        priority: nodeId === centerId ? 3 : nodeId === focusId ? 2
          : nodeId === hoverIdRef.current ? 1 : 0,
        distance,
        worldPerPx,
      })
    })

    candidates.sort((a, b) => (
      b.priority - a.priority
      || (degrees.get(b.nodeId) || 0) - (degrees.get(a.nodeId) || 0)
    ))

    candidates.forEach((item) => {
      const left = item.x - item.halfWidth
      const right = item.x + item.halfWidth
      const top = item.y - item.halfHeight
      const bottom = item.y + item.halfHeight
      const overlaps = placed.some(([l, t, r, b]) => left < r && right > l && top < b && bottom > t)
      item.sprite.visible = !overlaps
      if (overlaps) return
      placed.push([left, top, right, bottom])
      const factor = Math.min(
        Math.max((LABEL_SCREEN_PX * item.worldPerPx) / LABEL_TEXT_HEIGHT, LABEL_SCALE_MIN),
        LABEL_SCALE_MAX,
      )
      const base = item.sprite.__baseScale as THREE.Vector3
      item.sprite.scale.set(base.x * factor, base.y * factor, 1)
    })
  }, [size.height, size.width, degrees, centerId, focusId])

  /** 用户自己动过视角（缩放/旋转/拖拽）后就不再自动取景，把镜头交还给他 */
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const mark = () => { fitGuard.current.userMoved = true }
    host.addEventListener('wheel', mark, { passive: true })
    host.addEventListener('pointerdown', mark)
    return () => {
      host.removeEventListener('wheel', mark)
      host.removeEventListener('pointerdown', mark)
    }
  }, [])

  // 图库这一版没有 render 后置钩子，自己跑一个 rAF 循环：
  // 把标签反缩放到屏幕字号；顺带等布局稳下来做一次首屏取景（见 fitGuard）
  useEffect(() => {
    let raf = 0
    const tick = () => {
      const guard = fitGuard.current
      if (!guard.done && !guard.userMoved) {
        const radius = visibleRadius()
        // 规则见 shouldFitCamera：稳下来才取景，且最多取一次
        if (radius > 0 && shouldFitCamera(guard, radius, performance.now())) fitCamera(600)
      }
      syncLabelScale()
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [syncLabelScale, fitCamera, visibleRadius])

  /** 聚焦的视频节点开始内联播放，其余暂停并让位给封面。
   *  显隐改 CSS2DObject.visible：CSS2DRenderer 每帧按它覆写 element.style.display，
   *  直接改元素 style 会被抹掉，结果是所有未加载的 <video> 都以黑块形式露出来。 */
  useEffect(() => {
    dom.current.videos.forEach((holder, nodeId) => {
      const active = nodeId === focusId
      const video = holder.element as HTMLVideoElement
      holder.visible = active
      if (active) playVideo(video)
      else video.pause()
    })
  }, [focusId, graphData])

  /* ---------- 访问器与交互 ---------- */

  // 依赖是 media 与配色模式：节点对象很贵，只在缩略图到位或切到社区配色时重建一次。
  // 聚焦、悬停、过滤都不重建（分别走上面的 DOM 同步与下面的可见性访问器）。
  const colorModeKey = communityColorOf ? 'community' : 'type'
  const nodeThreeObject = useCallback(
    (node: SimNode) => buildNodeObject(
      node,
      media?.[node.id],
      dom.current,
      showLabelRef.current(node.id, null),
      communityColorOf?.(node.id),
    ),
    // 主题变了标签底色要换，也重建一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [media, colorModeKey, theme],
  )

  // 手机 GPU 弱、屏幕像素比高：限制像素比并降低几何精度，避免发热掉帧
  useEffect(() => {
    if (!mobile) return
    const renderer = fgRef.current?.renderer?.()
    renderer?.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
  }, [mobile, size.width])

  // 边的可见性要反查两端节点；引用固定，否则会连带重建所有边的几何体
  const nodeById = useCallback((id: string) => nodeStore.current.get(id), [])

  const accessors = useGraphAccessors({
    media,
    hiddenTypes,
    hiddenPredicates,
    focusNeighbors,
    focusId,
    focusStar: mobile,
    timeDim,
    yearLo,
    yearHi,
    nodeById,
    edgeWeights,
    communityColorOf,
  })
  // 取景只算可见节点：过滤条件变了立即生效
  nodeVisibilityRef.current = accessors.nodeVisibility
  const handleHover = useCallback(
    (node: SimNode | null) => {
      hoverIdRef.current = node ? String(node.id) : null
      syncLabels(hoverIdRef.current)
    },
    [syncLabels],
  )

  const handleDragEnd = useCallback((node: SimNode) => {
    // 拖过的节点钉在原处，方便人工整理布局（「重新加载」会全部松开）
    node.fx = node.x
    node.fy = node.y
    node.fz = node.z
  }, [])

  return (
    <div ref={hostRef} className="g3d-host">
      {size.width > 0 && (
        <ForceGraph3D<SimNode, SimLink>
          ref={fgRef}
          width={size.width}
          height={size.height}
          backgroundColor={palette(theme).bg}
          showNavInfo={false}
          rendererConfig={mobile ? { antialias: false, powerPreference: 'low-power' } : { antialias: true, alpha: true }}
          extraRenderers={extraRenderers}
          graphData={graphData}
          /* 节点：不透明，重叠的球体才不会互相透出脏色 */
          nodeVal="__val"
          nodeRelSize={NODE_REL_SIZE}
          nodeOpacity={1}
          nodeResolution={mobile ? 10 : 20}
          nodeColor={accessors.nodeColorOf}
          nodeLabel={accessors.nodeTooltipOf}
          nodeVisibility={accessors.nodeVisibility}
          nodeThreeObject={nodeThreeObject}
          nodeThreeObjectExtend={accessors.nodeThreeObjectExtend}
          /* 边 */
          linkWidth={accessors.linkWidth}
          linkOpacity={0.42}
          linkResolution={mobile ? 3 : 4}
          linkColor={accessors.linkColorOf}
          linkLabel={edgeTooltip}
          linkVisibility={accessors.linkVisibility}
          linkDirectionalArrowLength={accessors.linkArrowLength}
          linkDirectionalArrowRelPos={1}
          linkDirectionalArrowColor={accessors.arrowColorOf}
          linkDirectionalParticles={mobile ? 0 : accessors.linkParticles}
          linkDirectionalParticleWidth={1.2}
          linkDirectionalParticleSpeed={0.006}
          /* 交互 */
          enableNodeDrag
          onNodeClick={onNodeClick}
          onNodeRightClick={onNodeRightClick}
          onLinkClick={onLinkClick}
          onNodeHover={handleHover}
          onNodeDragEnd={handleDragEnd}
          onBackgroundClick={onBackgroundClick}
          onEngineStop={handleEngineStop}
          cooldownTime={mobile ? 4000 : 8000}
        />
      )}
    </div>
  )
}
