/**
 * 关系探索页
 *
 * 画布用 react-force-graph-3d（见 Graph3DCanvas），页面负责数据与交互：
 * - 顶部实体搜索：搜到即以其为中心重展开（换中心 = 清空旧画布）
 * - 右上「快速定位」下拉：人物 / 势力 / 地点 / 事件 / 器物库，打开右侧面板按库点选实体
 * - 单击节点 = 选中看详情（视角不动）；右键 = 展开邻域（无限生长）
 * - 聚焦（只看某实体的关系网络）走详情卡按钮或 F 键，不再和单击混在一起
 * - 图例即过滤器：谓词/实体类型可点击开关，交给画布做可见性，不裁数据
 * - 详情卡：属性 + 直接关系清单 + 出场章回（点开看原文高亮）
 *
 * 数据来自 /data-governance/knowledge-graph 语义图接口。
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Button, Dropdown, Segmented, message } from 'antd'
import {
  AimOutlined,
  CloseOutlined,
  CompassOutlined,
  DownOutlined,
  ExpandOutlined,
  FilterOutlined,
  NodeIndexOutlined,
  ReloadOutlined,
  SearchOutlined,
} from '@ant-design/icons'

import {
  getEntityMedia,
  getEntityNeighbors,
  getEntitySources,
  getKnowledgeGraphEntity,
  getKnowledgeGraphOntology,
  getSemanticGraph,
  searchKnowledgeGraphEntities,
  type EntityMedia,
  type EntitySearchItem,
  type EntitySource,
  type GraphData,
  type GraphEdge,
  type GraphNode,
  type Ontology,
} from '@/api/knowledge-graph'
import { getCommunityMembers, getEdgeMetrics } from '@/api/kg-analysis'
import { nodeColor, nodeLabel, relationLabel } from '@/utils/graphStyle'
import { edgeEndId } from './graph3dConfig'
import { deriveTimeDimension } from './timeDimension'
import Timeline2DScene from './Timeline2DScene'
import FlowSankeyScene from './FlowSankeyScene'
import AnalysisPanel, { type ExploreMode } from './AnalysisPanel'
import { buildFlowAggregate, EMPTY_FLOW, type FlowSelection } from './flowAggregate'
import { formatPropValue, propLabel, SKIPPED_PROPS } from './entityProps'
import EvidenceHighlightDrawer, { type EvidenceStop } from '@/components/EvidenceHighlightDrawer'
import RelationDetailDrawer from './RelationDetailDrawer'
import QuickLocatePanel from './QuickLocatePanel'
import NodeGallery from './NodeGallery'
import MobileEntitySheet from './MobileEntitySheet'
import VideoModal, { episodeTarget, episodesForChapters, useVideoCatalog, type VideoTarget } from '@/components/VideoModal'
import { locateLibraries, type LocateLibrary } from './locateLibraries'
import { activeProfile, unitLabel, unitRange } from '@/graph/profile'
import i18n from '@/i18n'
import { clusterPalette } from '@/theme/palette'
import { useTheme } from '@/theme/ThemeProvider'
import { isMobileNow, useIsMobile } from '@/hooks/useIsMobile'
import type { Citation } from '@/api/kg-learn'
import { citationTarget } from './CitedText'
import EntityNote from './EntityNote'
import RelatedEntities from './RelatedEntities'
import '../tokens.css'
import '../graph.css'
import './explore.css'
import './learn.css'
// three.js + 图库体积大，懒加载拆 chunk：只在进入本页时才下载
const Graph3DCanvas = lazy(() => import('./Graph3DCanvas'))
// 类型只做静态引用（编译期擦除，不会把实现拉进主包）
type Graph3DHandle = import('./Graph3DCanvas').Graph3DHandle

/** 初始加载与每次展开新增的节点上限 */
const BATCH_LIMIT = 120
/** 画布节点总数软上限，超过后提示先清理再展开 */
const MAX_NODES = 600

const MODE_VALUES: ExploreMode[] = ['browse', 'ask', 'path', 'strength', 'community', 'timeline', 'flow', 'clue', 'review']

function modeOptions(): { label: string; value: ExploreMode }[] {
  return MODE_VALUES.map((value) => ({ value, label: i18n.t(`explore.${value}`) }))
}

const parseMode = (raw: string | null): ExploreMode =>
  MODE_VALUES.find((value) => value === raw) ?? 'browse'

/** 社区指纹 -> 稳定颜色（同一指纹每次进入页面颜色一致）；同一板块同色，跨板块桥接才看得出来 */
function communityColor(key: string, colors: string[]): string {
  let hash = 0
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) % 100000
  }
  return colors[hash % colors.length]
}

interface SelectedEntity {
  id: string
  name: string
  label: string
  properties?: Record<string, unknown>
}

/** 时间轴手柄：圆形把手 + 年份标签，可拖动。
 *  标签放在轨道外侧（手柄行内只留把手），拖动时高亮提示当前年份。 */
function TimeHandle({ top, label, onDrag }: {
  top: number // 百分比位置（0=轨道顶，100=轨道底）
  label: string
  onDrag: (pct: number) => void // pct 0~1
}) {
  const handleRef = useRef<HTMLDivElement>(null)
  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const el = handleRef.current
    if (!el) return
    el.setPointerCapture(e.pointerId)
    el.classList.add('drag')
    const move = (ev: PointerEvent) => {
      const rail = el.closest('.inf-ta-rail') as HTMLElement | null
      if (!rail) return
      const rect = rail.getBoundingClientRect()
      // 指针 Y -> 轨道百分比，夹紧 0~1
      const pct = Math.min(Math.max((ev.clientY - rect.top) / rect.height, 0), 1)
      onDrag(pct)
    }
    const up = () => {
      el.classList.remove('drag')
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }
  return (
    <>
      <div
        ref={handleRef}
        className="inf-ta-handle"
        style={{ top: `${top}%` }}
        onPointerDown={onPointerDown}
        title={label}
      />
      <div className="inf-ta-label" style={{ top: `${top}%` }}>{label}</div>
    </>
  )
}

export default function ExploreGraphPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { theme } = useTheme()
  const mobile = useIsMobile()
  const profile = activeProfile()
  const axisName = profile.unit.axis
  const searchHint = useMemo(() => {
    const joiner = i18n.language.startsWith('en') ? ', ' : '、'
    if (mobile) return i18n.t('explore.searchShort', { names: profile.ontology.entity_types.slice(0, 2).map((t) => t.name).join(joiner) })
    const names = profile.ontology.entity_types.slice(0, 4).map((t) => t.name).join(joiner)
    const example = profile.examples?.search ? i18n.t('explore.searchExample', { q: profile.examples.search }) : ''
    return i18n.t('explore.search', { names, example })
  }, [profile, mobile])
  const [data, setData] = useState<GraphData>({ nodes: [], edges: [] })
  // 探索中心（搜索锚点）：画布上放大高亮的节点
  const [centerId, setCenterId] = useState<string | null>(null)
  // 聚焦节点：只显示它和直接邻居（Infiniti 的 enterFocus）
  const [focusId, setFocusId] = useState<string | null>(null)
  const [selected, setSelected] = useState<SelectedEntity | null>(null)
  // 图例即过滤器：被关掉的实体类型 / 关系谓词
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set())
  const [hiddenPredicates, setHiddenPredicates] = useState<Set<string>>(new Set())
  const [keyword, setKeyword] = useState('')
  const [searchItems, setSearchItems] = useState<EntitySearchItem[]>([])
  const [searching, setSearching] = useState(false)
  const canvasRef = useRef<Graph3DHandle | null>(null)
  // 首次加载完成后不再显示全屏空态（无限生长语义：画布常驻）
  const [booted, setBooted] = useState(false)
  const [loading, setLoading] = useState(true)
  // 实体缩略图：Person 人脸头像 / Photo/Video 附件封面
  const [media, setMedia] = useState<Record<string, EntityMedia | undefined>>({})
  const videoCatalog = useVideoCatalog()
  const [video, setVideo] = useState<VideoTarget | null>(null)
  // 快速定位面板当前打开的库（null = 关闭）。桌面端默认打开第一个库；
  // 手机上面板是底部抽屉，默认展开会盖住画布
  const [locateLib, setLocateLib] = useState<LocateLibrary | null>(
    () => (isMobileNow() ? null : locateLibraries()[0]?.key ?? null),
  )

  // ---------------- 出场章回（下钻定位原文） ----------------
  // 详情卡里的关系/出场章回点击后打开 EvidenceHighlightDrawer：
  // 抽屉里显示该回全文，并把本回事实的证据区间高亮 + 滚动定位
  const [entitySources, setEntitySources] = useState<EntitySource[]>([])
  const [sourcesLoading, setSourcesLoading] = useState(false)
  const [evidenceTarget, setEvidenceTarget] = useState<{
    recordId: string
    claimId?: string
    trail?: EvidenceStop[]
  } | null>(null)
  // 关系详情抽屉（点边下钻）：聚合边 + 它背后的 Claim 实例 id 列表
  const [relationEdge, setRelationEdge] = useState<{
    edgeId: string
    predicate: string
    subjectName: string
    objectName: string
    claimIds: string[]
  } | null>(null)
  // 本体（谓词中文名）：证据抽屉里展示 Claim 用
  const [ontology, setOntology] = useState<Ontology | null>(null)
  useEffect(() => {
    getKnowledgeGraphOntology()
      .then((res) => setOntology(res.data || null))
      .catch(() => {})
  }, [])

  // ---------------- 时间维度（按首次出场章回推导） ----------------
  // 有时间锚点才显示时间轴；范围手柄跟随数据自适应（Infiniti 的 updateTimeRange）
  const timeDim = useMemo(() => deriveTimeDimension(data), [data])
  const [yearLo, setYearLo] = useState<number>(0)
  const [yearHi, setYearHi] = useState<number>(0)
  // 时间分层默认关闭：按年代拉开 Y 轴很直观，但会牺牲关系簇的紧凑度，
  // 让用户按需切换，而不是一上来就把布局约束死。
  const [timeLayer, setTimeLayer] = useState(false)
  // 时间轴面板默认收起，从图例里打开；收起时恢复全范围，免得留下看不见的过滤
  const [showTimeAxis, setShowTimeAxis] = useState(false)
  const toggleTimeAxis = () => {
    if (showTimeAxis && timeDim) { setYearLo(timeDim.lo); setYearHi(timeDim.hi) }
    setShowTimeAxis((prev) => !prev)
  }

  // ---------------- 分析模式（从"看图"到"找线索"） ----------------
  // browse 保持原来的纯浏览；其余模式把画布或右侧面板切成分析视图。
  // 时序模式会自动切换到 2D 场景：3D 的坐标是拓扑位置，没有时间方向，
  // 播放时节点只会飘动；2D 把横轴让给时间，演进才看得出来（见 Timeline2DScene）。
  // 模式记在地址栏（?mode=clue）：手机顶栏的「线索」直接链过来，也便于分享
  const mode = parseMode(searchParams.get('mode'))
  const setMode = useCallback((next: ExploreMode) => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev)
      if (next === 'browse') params.delete('mode')
      else params.set('mode', next)
      return params
    }, { replace: true })
  }, [setSearchParams])
  /** 边强度预计算（key `src::PRED::dst` -> 0-1 权重），强度模式下画线宽 */
  const [edgeWeights, setEdgeWeights] = useState<Record<string, number>>({})
  /** 实体 -> 社区指纹，社区模式下按社区上色 */
  const [communityOf, setCommunityOf] = useState<Record<string, string>>({})
  /** 时序播放游标（当前年份），右侧台账只显示"截至此刻"的事件 */
  const [cursorYear, setCursorYear] = useState<number | null>(null)
  /** 流转视图的当前选中（画布点选与右侧面板共用一份状态） */
  const [flowSelection, setFlowSelection] = useState<FlowSelection | null>(null)

  /** 分析面板的上下文锚点：优先当前选中实体，其次聚焦、探索中心 */
  const panelAnchor = useMemo(() => {
    const anchorId = selected?.id || focusId || centerId
    if (!anchorId) return null
    const node = data.nodes.find((item) => item.id === anchorId)
    return { id: anchorId, name: node?.name || anchorId }
  }, [selected?.id, focusId, centerId, data.nodes])

  // 强度模式：按当前画布上的边批量取权重（不整图下拉，2000 条一批）
  useEffect(() => {
    if (mode !== 'strength') return undefined
    const keys: string[] = []
    data.edges.forEach((edge) => {
      const key = `${edgeEndId(edge.source)}::${edge.type}::${edgeEndId(edge.target)}`
      if (!keys.includes(key)) keys.push(key)
    })
    if (!keys.length) return undefined
    let alive = true
    getEdgeMetrics(keys.slice(0, 2000))
      .then((res) => {
        if (!alive) return
        const next: Record<string, number> = {}
        Object.entries(res.items || {}).forEach(([key, value]) => {
          next[key] = (value as { weight: number }).weight
        })
        setEdgeWeights(next)
      })
      .catch(() => { if (alive) setEdgeWeights({}) })
    return () => { alive = false }
  }, [mode, data.edges])

  // 社区模式：按当前画布上的实体批量取社区归属
  useEffect(() => {
    if (mode !== 'community') return undefined
    const ids = data.nodes.map((node) => node.id).slice(0, 2000)
    if (!ids.length) return undefined
    let alive = true
    getCommunityMembers(ids)
      .then((res) => { if (alive) setCommunityOf(res.items || {}) })
      .catch(() => { if (alive) setCommunityOf({}) })
    return () => { alive = false }
  }, [mode, data.nodes])

  /** 社区模式下的节点配色；其它模式返回 undefined，走默认的实体类型色 */
  const communityColorOf = useCallback((nodeId: string) => {
    if (mode !== 'community') return undefined
    const key = communityOf[nodeId]
    return key ? communityColor(key, clusterPalette(theme)) : undefined
  }, [mode, communityOf, theme])

  /** 图例过滤后的图数据：时序 2D 场景与流转桑基都吃它（3D 走可见性访问器，不裁数据） */
  const filteredGraph = useMemo(() => {
    const nodes = data.nodes.filter((node) => !hiddenTypes.has(node.label))
    const ids = new Set(nodes.map((node) => node.id))
    const edges = data.edges.filter((edge) => (
      ids.has(edgeEndId(edge.source))
      && ids.has(edgeEndId(edge.target))
      && !hiddenPredicates.has(edge.type.toLowerCase())
    ))
    return { nodes, edges }
  }, [data, hiddenTypes, hiddenPredicates])

  /**
   * 流转视图的聚合结果：只在流转模式下算，切换模式不做无用功。
   * 面板与画布共用同一份，保证"面板列的流向"和"画布画的带子"永远一致。
   */
  const flow = useMemo(
    () => (mode === 'flow' ? buildFlowAggregate(filteredGraph) : EMPTY_FLOW),
    [mode, filteredGraph],
  )

  /** 流转视图要让开右侧面板，否则主带子被面板压住 */
  const flowRightInset = mode === 'flow' ? (locateLib ? 700 : 380) : 0

  /**
   * 画布点选：再点同一个就取消高亮（与面板里的"清除"是同一个入口）。
   * 用派生比较而不是读 state，避免把 flowSelection 写进依赖导致回调每次重建。
   */
  const handleFlowPick = useCallback((selection: FlowSelection | null) => {
    setFlowSelection((prev) => (
      selection && prev && prev.kind === selection.kind && prev.key === selection.key
        ? null
        : selection
    ))
  }, [])

  /**
   * 离开流转模式就不再显示高亮。
   * 用派生值而不是"进 effect 清 state"：在 effect 里同步 setState 会触发级联渲染，
   * 而且回到流转模式时还能保留上一次的选中，便于接着看。
   */
  const activeFlowSelection = mode === 'flow' ? flowSelection : null

  /** 节点索引：台账要把关系的对端 id 还原成名称（画布上正好有这份数据） */
  const nodeById = useMemo(
    () => new Map(data.nodes.map((node) => [node.id, node])),
    [data.nodes],
  )
  const resolveEntity = useCallback((entityId: string) => {
    const node = nodeById.get(entityId)
    return node ? { name: node.name, label: node.label } : null
  }, [nodeById])

  /** 路径探查结果并入画布：命中的链路直接出现在图上 */
  const mergeGraph = useCallback((patch: { nodes: GraphNode[]; edges: GraphEdge[] }) => {
    setData((current) => {
      const nodeMap = new Map(current.nodes.map((node) => [node.id, node]))
      patch.nodes.forEach((node) => {
        nodeMap.set(node.id, { ...(nodeMap.get(node.id) || {}), ...node })
      })
      const edgeMap = new Map(
        current.edges.map((edge) => [edge.id || `${edge.source}::${edge.type}::${edge.target}`, edge]),
      )
      patch.edges.forEach((edge) => {
        const key = edge.id || `${edge.source}::${edge.type}::${edge.target}`
        if (!edgeMap.has(key)) edgeMap.set(key, edge)
      })
      return { nodes: Array.from(nodeMap.values()), edges: Array.from(edgeMap.values()) }
    })
  }, [])
  useEffect(() => {
    if (timeDim) {
      setYearLo(timeDim.lo)
      setYearHi(timeDim.hi)
    }
  }, [timeDim])
  const timeActive = Boolean(timeDim) && yearHi > yearLo

  // ---------------- 实体缩略图（多媒体贴图） ----------------
  // 画布上出现新实体就批量解析一次。只补差集：展开邻域是增量的，
  // 已解析过的实体不重复请求。
  useEffect(() => {
    const pending = data.nodes
      .map((node) => node.id)
      .filter((id) => !(id in media))
    if (!pending.length) return
    let cancelled = false
    getEntityMedia(pending)
      .then((res) => {
        if (cancelled) return
        const items = res.data?.items || {}
        // 没有媒体的实体也写进来（值为 undefined 占位），避免反复请求
        setMedia((current) => {
          const next = { ...current }
          pending.forEach((id) => { next[id] = items[id] })
          return next
        })
      })
      .catch(() => { /* 缩略图解析失败时节点画球体，不影响图谱本身 */ })
    return () => { cancelled = true }
  }, [data.nodes, media])

  // 时间轴工具：年份 <-> 轨道百分比（顶部 = lo 早年，底部 = hi 晚年）
  const railRef = useRef<HTMLDivElement>(null)
  const pctOf = (year: number) => {
    if (!timeDim) return 0
    return ((Math.min(Math.max(year, timeDim.lo), timeDim.hi) - timeDim.lo)
      / (timeDim.hi - timeDim.lo)) * 100
  }
  const pctToYear = (pct: number) => {
    if (!timeDim) return 0
    return Math.round(timeDim.lo + pct * (timeDim.hi - timeDim.lo))
  }
  const bandStyle = {
    top: `${pctOf(yearLo)}%`,
    height: `${pctOf(yearHi) - pctOf(yearLo)}%`,
  }

  // ---------------- 初始加载：概览图 ----------------
  // 深链（?entity=xxx，如人员库跳转）在 jumpToEntity 定义后处理（见下）
  const deepLinkId = searchParams.get('entity')

  // ---------------- 搜索实体（防抖 300ms，与 Infiniti 一致） ----------------
  useEffect(() => {
    const kw = keyword.trim()
    if (!kw) { setSearchItems([]); return }
    const timer = window.setTimeout(async () => {
      setSearching(true)
      try {
        const res = await searchKnowledgeGraphEntities({ keyword: kw, page_size: 8 })
        setSearchItems(res.data?.items || [])
      } catch {
        setSearchItems([])
      } finally {
        setSearching(false)
      }
    }, 300)
    return () => window.clearTimeout(timer)
  }, [keyword])

  // 以选中实体为中心重展开（Infiniti 的 jumpTo：换探索中心 = 清空旧画布）
  // 返回加载到的图数据，调用方（如快速定位）可据此顺手选中中心节点看详情
  const jumpToEntity = useCallback(async (entityId: string): Promise<GraphData | null> => {
    setLoading(true)
    setSearchItems([])
    try {
      const res = await getSemanticGraph({ entity_id: entityId, limit: BATCH_LIMIT })
      const next = res.data || { nodes: [], edges: [] }
      setData(next)
      setCenterId(entityId)
      setFocusId(null)
      setSelected(null)
      setBooted(true)
      // 相机飞行交给画布：中心节点刚进场还没有坐标，画布会等它算出来再飞
      return next
    } catch {
      message.error(i18n.t('explore.expandFail'))
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  // 首次挂载：有深链时交给下方 locateEntity 展开并打开详情，否则加载概览图
  useEffect(() => {
    if (deepLinkId) return
    getSemanticGraph({ limit: BATCH_LIMIT, min_confidence: 0 })
      .then((res) => {
        setData(res.data || { nodes: [], edges: [] })
        setBooted(true)
      })
      .catch(() => message.error(i18n.t('explore.loadFail')))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---------------- 右键展开邻域（无限生长） ----------------
  const expandNode = useCallback(async (nodeId: string, silent = false) => {
    if (data.nodes.length >= MAX_NODES) {
      if (!silent) message.warning(i18n.t('explore.maxNodes', { max: MAX_NODES }))
      return
    }
    try {
      const res = await getEntityNeighbors(nodeId, { limit: BATCH_LIMIT })
      const patch: GraphData = (res as { data?: GraphData }).data
        || { nodes: [], edges: [] }
      if (!patch.nodes?.length) {
        if (!silent) message.info(i18n.t('explore.noMore'))
        return
      }
      setData((current) => {
        // 追加合并：已有节点保持坐标（无限生长），新节点交给力导向铺开
        const nodeMap = new Map(current.nodes.map((n) => [n.id, n]))
        patch.nodes.forEach((n) => nodeMap.set(n.id, nodeMap.get(n.id) || n))
        const edgeMap = new Map(
          current.edges.map((e) => [`${e.source}|${e.target}|${e.type}`, e]),
        )
        patch.edges?.forEach((e) => {
          edgeMap.set(`${e.source}|${e.target}|${e.type}`, e)
        })
        return { nodes: [...nodeMap.values()], edges: [...edgeMap.values()] }
      })
    } catch {
      if (!silent) message.error(i18n.t('explore.expandNeighborFail'))
    }
  }, [data.nodes.length])

  // ---------------- 节点点击：单击只看详情，视角不动 ----------------
  // 旧实现把「聚焦 + 详情」绑在单击上，还要靠 230ms 延时和双击区分，
  // 结果是每次想看详情都被拽走视角，而且总有明显延迟。现在拆开：
  // 单击 = 详情，右键 = 展开邻域，聚焦是详情卡上的显式动作。
  const handleNodeClick = useCallback(async (node: GraphNode) => {
    setSelected({ id: node.id, name: node.name, label: node.label, properties: node.properties })
    // 手机上详情抽屉占掉下半屏，剩下的画布只够看清一圈邻居：选中即聚焦，等画布让位后重新取景
    if (isMobileNow()) {
      setFocusId(node.id)
      void expandNode(node.id, true)
      setTimeout(() => canvasRef.current?.resetView(), 450)
    }
    // 来源档案列表：详情卡「来源档案」区数据（下钻入口）
    setEntitySources([])
    setSourcesLoading(true)
    getEntitySources(node.id, 6)
      .then((res) => setEntitySources(res.data?.items || []))
      .catch(() => setEntitySources([]))
      .finally(() => setSourcesLoading(false))
    try {
      // 详情属性补全（失败不阻塞：画布节点已带基础属性）
      const res = await getKnowledgeGraphEntity(node.id)
      setSelected((cur) => (cur?.id === node.id
        ? { id: node.id, name: node.name, label: node.label, properties: res.data || node.properties }
        : cur))
    } catch { /* 保持画布属性 */ }
  }, [expandNode])

  /**
   * 聚焦某实体：只显示它与直接邻居，相机飞过去。
   *
   * 聚焦即展开——只亮出已加载的那一圈、不把关系拉全，聚焦就没意义；
   * 展开失败的提示按 silent 处理，避免每次聚焦都弹一句"没有更多邻居"。
   */
  const focusOn = useCallback((nodeId: string) => {
    const entering = focusId !== nodeId
    setFocusId(entering ? nodeId : null)
    canvasRef.current?.focusOn(nodeId)
    if (entering) void expandNode(nodeId, true)
  }, [focusId, expandNode])

  // 点画布空白：关详情 + 退出聚焦
  const handleBackgroundClick = useCallback(() => {
    setSelected(null)
    setFocusId(null)
  }, [])

  /**
   * 重置视图：手动整理过布局之后想回到"干净"的状态时用。
   * 松开所有拖拽钉住的节点 → 退出聚焦与详情 → 相机回到全图。
   */
  const handleResetView = useCallback(() => {
    setFocusId(null)
    setSelected(null)
    canvasRef.current?.unpinAll()
    canvasRef.current?.resetView()
  }, [])

  // 点边：打开关系详情抽屉，还原聚合边背后的 Claim 关系体实例。
  // 本体视角：语义图的边是派生物质关系，Claim 才是让关系为真的一手事实，
  // 这里提供「投影 → 真源」的下钻通道（见 RelationDetailDrawer）。
  const handleLinkClick = useCallback((edge: GraphEdge) => {
    if (!edge.claim_ids?.length) return
    // 画布回调里 source/target 可能已被换成节点对象，统一取回 id
    const sourceId = edgeEndId(edge.source)
    const targetId = edgeEndId(edge.target)
    const sourceName = data.nodes.find((n) => n.id === sourceId)?.name || sourceId
    const targetName = data.nodes.find((n) => n.id === targetId)?.name || targetId
    setRelationEdge({
      edgeId: edge.id || `${sourceId}::${edge.type}::${targetId}`,
      predicate: edge.type,
      subjectName: sourceName,
      objectName: targetName,
      claimIds: edge.claim_ids,
    })
  }, [data.nodes])

  // Escape 退出聚焦与详情；F 聚焦当前选中实体（键入框内不拦）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return
      if (e.key === 'Escape') { setFocusId(null); setSelected(null) }
      else if ((e.key === 'f' || e.key === 'F') && selected) focusOn(selected.id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected, focusOn])

  // ---------------- 图例开关 ----------------
  const toggleType = (label: string) => {
    setHiddenTypes((prev) => {
      const next = new Set(prev)
      if (next.has(label)) next.delete(label)
      else next.add(label)
      return next
    })
  }
  const togglePredicate = (code: string) => {
    setHiddenPredicates((prev) => {
      const next = new Set(prev)
      if (next.has(code)) next.delete(code)
      else next.add(code)
      return next
    })
  }

  // ---------------- 图例过滤后的规模（只用于 HUD 计数） ----------------
  // 过滤本身交给画布的 nodeVisibility / linkVisibility，不再裁数据：
  // 裁数据会让节点对象换引用，力导向把已铺开的布局整个重算一遍。
  const visibleCount = useMemo(() => {
    const nodes = data.nodes.filter((n) => !hiddenTypes.has(n.label))
    const nodeIds = new Set(nodes.map((n) => n.id))
    const edges = data.edges.filter((e) => (
      nodeIds.has(e.source)
      && nodeIds.has(e.target)
      && !hiddenPredicates.has(e.type.toLowerCase())
    ))
    return { nodes: nodes.length, edges: edges.length }
  }, [data, hiddenTypes, hiddenPredicates])

  // 画布上实际出现的实体类型与谓词，作为图例数据源
  const presentTypes = useMemo(
    () => Array.from(new Set(data.nodes.map((n) => n.label))),
    [data.nodes],
  )
  const presentPredicates = useMemo(
    () => Array.from(new Set(data.edges.map((e) => e.type.toLowerCase()))),
    [data.edges],
  )

  // 详情卡直接关系清单：桌面卡片最多 8 条（与 Infiniti 一致），手机抽屉按原文依据多少排序列全
  const selectedRelations = useMemo(() => {
    if (!selected) return []
    const edges = data.edges.filter((e) => edgeEndId(e.source) === selected.id || edgeEndId(e.target) === selected.id)
    const picked = mobile
      ? [...edges].sort((a, b) => (b.claim_ids?.length || 0) - (a.claim_ids?.length || 0))
      : edges.slice(0, 8)
    return picked
      .map((e) => {
        const otherId = edgeEndId(e.source) === selected.id ? edgeEndId(e.target) : edgeEndId(e.source)
        const other = nodeById.get(otherId)
        return { edge: e, otherName: other?.name || otherId, otherLabel: other?.label || '' }
      })
  }, [data, selected, mobile, nodeById])

  const relationOf = (edge: GraphEdge) => edge.label || relationLabel(edge.type)

  // 快速定位点选：以该实体为中心重展开，并直接打开它的详情卡（关系清单 + 出场章回）
  const locateEntity = useCallback(async (entityId: string) => {
    const next = await jumpToEntity(entityId)
    const node = next?.nodes.find((n) => n.id === entityId)
    if (node) handleNodeClick(node)
  }, [jumpToEntity, handleNodeClick])

  useEffect(() => {
    if (deepLinkId) locateEntity(deepLinkId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const submitSearch = () => {
    if (searchItems[0]) locateEntity(searchItems[0].entity_id)
    else if (keyword.trim()) jumpToEntity(keyword.trim())
  }

  /**
   * 面板里点实体名：先切回浏览模式再定位。
   * 流转模式下画布是桑基图，不切模式的话用户看不到落点——图重新拉了，眼睛还停在桑基上。
   */
  const locateFromPanel = useCallback((entityId: string) => {
    if (!entityId) return
    if (mode === 'flow') setMode('browse')
    locateEntity(entityId)
  }, [mode, locateEntity])

  const openCitation = useCallback((citation: Citation, all: Citation[]) => {
    setEvidenceTarget(citationTarget(citation, all))
  }, [])

  const focusNode = focusId ? data.nodes.find((n) => n.id === focusId) : null
  const selectedMedia = selected ? media[selected.id] : undefined
  const selectedEpisodes = useMemo(
    () => episodesForChapters(videoCatalog, entitySources.map((s) => s.chapter_no || 0).filter(Boolean)),
    [videoCatalog, entitySources],
  )

  // ---------------- 渲染 ----------------
  return (
    <div className={`kg-explore-page inf-page ${locateLib ? 'has-locate' : ''} ${mode !== 'browse' ? 'has-panel' : ''} ${relationEdge || evidenceTarget ? 'has-drill' : ''}`}>
      {/* 画布：全屏铺底。Suspense 内为懒加载的 three.js + 图库 chunk */}
      <div className="inf-canvas-wrap">
        {/* 时序模式自动切到 2D 场景：时间必须占一条轴，3D 的拓扑布局表达不了演进 */}
        {mode === 'timeline' ? (
          <Timeline2DScene
            data={filteredGraph}
            timeDim={timeDim}
            yearLo={timeDim?.lo}
            yearHi={timeDim?.hi}
            onNodeClick={handleNodeClick}
            onCursorChange={setCursorYear}
          />
        ) : mode === 'flow' ? (
          <FlowSankeyScene
            flow={flow}
            selection={activeFlowSelection}
            rightInset={flowRightInset}
            onPick={handleFlowPick}
          />
        ) : (
          <Suspense fallback={<div className="inf-boot">{i18n.t('explore.booting')}</div>}>
            <Graph3DCanvas
              data={data}
              centerId={centerId}
              focusId={focusId}
              media={media}
              timeDim={timeDim}
              timeLayer={timeLayer}
              yearLo={timeActive ? yearLo : undefined}
              yearHi={timeActive ? yearHi : undefined}
              hiddenTypes={hiddenTypes}
              hiddenPredicates={hiddenPredicates}
              edgeWeights={mode === 'strength' ? edgeWeights : undefined}
              communityColorOf={communityColorOf}
              onNodeClick={handleNodeClick}
              onNodeRightClick={(node) => expandNode(node.id)}
              onLinkClick={handleLinkClick}
              onBackgroundClick={handleBackgroundClick}
              onCanvasReady={(handle) => { canvasRef.current = handle }}
            />
          </Suspense>
        )}
        {mode === 'timeline' && (
          <div className="inf-scene-badge">{i18n.t('explore.badgeTimeline')}</div>
        )}
        {mode === 'flow' && (
          <div className="inf-scene-badge">{i18n.t('explore.badgeFlow')}</div>
        )}
        {loading && <div className="inf-boot">{i18n.t('explore.loadingGraph')}</div>}
        {!loading && !booted && data.nodes.length === 0 && (
          <div className="inf-welcome">
            <h1>{i18n.t('explore.welcome')}{i18n.t('explore.welcomeEm') ? <b>{i18n.t('explore.welcomeEm')}</b> : null}</h1>
            <p className="inf-tagline">{i18n.t('explore.welcomeTag')}</p>
          </div>
        )}
      </div>

      {/* 顶部搜索（Infiniti 的 search-wrap）：悬浮居中 */}
      <div className="inf-search-wrap">
        <div className="inf-search-box">
          <SearchOutlined />
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submitSearch() }}
            placeholder={searchHint}
            aria-label={i18n.t('explore.searchAria')}
            enterKeyHint="search"
            autoComplete="off"
          />
          <button
            type="button"
            className="inf-search-go"
            onClick={submitSearch}
            disabled={!keyword.trim()}
          >
            {i18n.t('explore.go')}
          </button>
        </div>
        {/* 搜索下拉（Infiniti 的 search-drop） */}
        {(searching || searchItems.length > 0) && (
          <div className="inf-search-drop">
            {searching && <div className="inf-drop-status">{i18n.t('explore.searching')}</div>}
            {!searching && searchItems.map((item) => (
              <div
                key={item.entity_id}
                className="inf-drop-item"
                onClick={() => { setKeyword(''); locateEntity(item.entity_id) }}
              >
                <div>
                  <div className="inf-drop-name">{item.canonical_name}</div>
                  <div className="inf-drop-sub">
                    {item.title && item.title !== item.canonical_name ? `${item.title} · ` : ''}
                    {nodeLabel(item.entity_type)} · {i18n.t('explore.factCount', { count: item.claim_count })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 聚焦提示条（Infiniti 的 focus-bar） */}
      {/* 分析模式切换：从"看图"进入"找线索"。时序模式会自动切到 2D 场景 */}
      {!mobile && (
        <div className="inf-mode-bar">
          <Segmented
            size="small"
            value={mode}
            onChange={(value) => setMode(value as ExploreMode)}
            options={modeOptions()}
          />
        </div>
      )}

      {focusNode && (
        <div className="inf-focus-bar">
          <span><AimOutlined /> {i18n.t('explore.focusBar')} <b>{focusNode.name}</b> {i18n.t('explore.focusOnly')}</span>
          <button type="button" onClick={() => setFocusId(null)}>{i18n.t('explore.exit')}</button>
        </div>
      )}

      {/* 详情卡（Infiniti 的 node-card）：点击点右侧，这里固定右上 */}
      {selected && mobile && (
        <MobileEntitySheet
          entity={selected}
          relations={selectedRelations}
          relationOf={relationOf}
          sources={entitySources}
          sourcesLoading={sourcesLoading}
          axisName={axisName}
          media={selectedMedia}
          videos={selectedEpisodes.length > 0 && videoCatalog?.source ? (
            <div className="inf-nc-videos">
              <div className="inf-nc-sec-title">{videoCatalog.source.title}</div>
              <div className="ep-chips">
                {selectedEpisodes.slice(0, 8).map((ep) => (
                  <button type="button" key={ep.ep} className="ep-chip" onClick={() => setVideo(episodeTarget(videoCatalog, ep))}>
                    {i18n.t('video.episode', { ep: ep.ep, title: ep.title })}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          focused={focusId === selected.id}
          onFocus={() => focusOn(selected.id)}
          onClose={() => {
            setSelected(null)
            setFocusId(null)
          }}
          onOpenRelation={handleLinkClick}
          onOpenSource={(recordId) => setEvidenceTarget({ recordId })}
          onCite={openCitation}
          onLocate={locateEntity}
        />
      )}

      {selected && !mobile && (
        <div className="inf-node-card">
          <div className="inf-nc-head">
            <h3>{selected.name}</h3>
            <span
              className="inf-nc-type"
              style={{
                background: `${nodeColor(selected.label).main}22`,
                color: nodeColor(selected.label).main,
              }}
            >
              {nodeLabel(selected.label)}
            </span>
            <button type="button" className="inf-nc-close" onClick={() => setSelected(null)} aria-label={i18n.t('common.close')}><CloseOutlined /></button>
          </div>
          <div className="inf-nc-body">
            <div className="inf-nc-note">
              <div className="inf-nc-sec-title">{i18n.t('explore.tabNote')}</div>
              <EntityNote entityId={selected.id} compact onCite={openCitation} />
            </div>
            {selectedMedia?.thumb_url && <NodeGallery name={selected.name} media={selectedMedia} />}
            {selectedEpisodes.length > 0 && videoCatalog?.source && (
              <div className="inf-nc-videos">
                <div className="inf-nc-sec-title">{videoCatalog.source.title}</div>
                <div className="ep-chips">
                  {selectedEpisodes.slice(0, 6).map((ep) => (
                    <button
                      type="button"
                      key={ep.ep}
                      className="ep-chip"
                      onClick={() => setVideo(episodeTarget(videoCatalog, ep))}
                      title={i18n.t('explore.episode', { chapters: ep.chapters.join(i18n.language.startsWith('en') ? ', ' : '、'), unit: activeProfile().unit.name })}
                    >
                      {i18n.t('video.episode', { ep: ep.ep, title: ep.title })}
                    </button>
                  ))}
                  {selectedEpisodes.length > 6 && <span className="inf-nc-more">{i18n.t('explore.moreEpisodes', { count: selectedEpisodes.length - 6 })}</span>}
                </div>
              </div>
            )}
            <div className="inf-nc-meta">
              {Object.entries(selected.properties || {})
                .filter(([key, v]) => v != null && v !== '' && !SKIPPED_PROPS.has(key))
                .slice(0, 6)
                .map(([key, value]) => (
                  <div key={key} className="inf-nc-prop">
                    <span>{propLabel(key)}</span>
                    <span>{formatPropValue(value, 60, key)}</span>
                  </div>
                ))}
            </div>
            <div className="inf-nc-rels">
              {selectedRelations.length ? (
                selectedRelations.map(({ edge, otherName }, index) => (
                  <div
                    key={edge.id || index}
                    className="inf-nc-rel"
                    onClick={() => handleLinkClick(edge)}
                    title={edge.claim_ids?.length ? i18n.t('explore.viewFacts', { count: edge.claim_ids.length }) : undefined}
                    style={edge.claim_ids?.length ? { cursor: 'pointer' } : undefined}
                  >
                    <span className="inf-nc-rel-type">{relationOf(edge)}</span>
                    <span className="inf-nc-rel-name">{otherName}</span>
                  </div>
                ))
              ) : (
                <div className="inf-nc-empty">{i18n.t('explore.noDirect')}</div>
              )}
            </div>
            <RelatedEntities entityId={selected.id} onLocate={locateEntity} />
            {/* 出现的单元（下钻入口）：点击打开该单元原文，证据高亮 */}
            <div className="inf-nc-sources">
              <div className="inf-nc-sec-title">{i18n.t('explore.appearedIn', { axis: axisName })}</div>
              {sourcesLoading && <div className="inf-nc-empty">{i18n.t('explore.loading')}</div>}
              {!sourcesLoading && entitySources.length === 0 && (
                <div className="inf-nc-empty">{i18n.t('explore.noAppearances')}</div>
              )}
              {!sourcesLoading && entitySources.map((src) => (
                <div
                  key={src.record_id}
                  className="inf-nc-source"
                  onClick={() => setEvidenceTarget({ recordId: src.record_id })}
                  title={src.title || src.record_id}
                >
                  <span className="inf-nc-source-title">{src.title || src.record_id}</span>
                  <span className="inf-nc-source-meta">
                    {i18n.t('explore.mentions', { count: src.mention_count })}{src.claim_count ? i18n.t('explore.factsJoin', { count: src.claim_count }) : ''}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="inf-nc-foot">
            <Button
              type="primary"
              size="small"
              block
              icon={<AimOutlined />}
              onClick={() => focusOn(selected.id)}
            >
              {focusId === selected.id ? i18n.t('explore.exitFocus') : i18n.t('explore.focus')}
            </Button>
          </div>
        </div>
      )}

      <VideoModal target={video} sourceTitle={videoCatalog?.source?.title} onClose={() => setVideo(null)} />

      {/* 原文证据定位抽屉：单元全文 + 本单元事实的证据高亮 */}
      <EvidenceHighlightDrawer
        recordId={evidenceTarget?.recordId || null}
        focusClaimId={evidenceTarget?.claimId || null}
        trail={evidenceTarget?.trail}
        onStep={(stop) => setEvidenceTarget((prev) => (prev ? { ...prev, ...stop } : prev))}
        ontology={ontology}
        onClose={() => setEvidenceTarget(null)}
      />

      {/* 关系详情抽屉：点边下钻，还原聚合边背后的 Claim 关系体实例 */}
      <RelationDetailDrawer
        edgeId={relationEdge?.edgeId || null}
        predicate={relationEdge?.predicate || null}
        subjectName={relationEdge?.subjectName || ''}
        objectName={relationEdge?.objectName || ''}
        claimIds={relationEdge?.claimIds || []}
        ontology={ontology}
        onOpenEvidence={(recordId, claimId, trail) => setEvidenceTarget({ recordId, claimId, trail })}
        onClose={() => setRelationEdge(null)}
      />

      {/* 左下图例（Infiniti 的 legend-tip）：类型 + 谓词开关 */}
      <div className="inf-legend-tip">
        <button type="button" className="inf-lt-btn"><FilterOutlined /> {i18n.t('explore.legend')}</button>
        <div className="inf-lt-body">
          <h5>{i18n.t('explore.entityTypes')}</h5>
          <div className="inf-lg-grid">
            {presentTypes.map((label) => (
              <span
                key={label}
                className={`inf-lg-toggle ${hiddenTypes.has(label) ? 'off' : ''}`}
                onClick={() => toggleType(label)}
              >
                <span className="inf-lg-dot" style={{ background: nodeColor(label).main }} />
                {nodeLabel(label)}
              </span>
            ))}
          </div>
          <h5>{i18n.t('explore.predicates')}</h5>
          <div className="inf-lg-grid">
            {presentPredicates.map((code) => (
              <span
                key={code}
                className={`inf-lg-toggle ${hiddenPredicates.has(code) ? 'off' : ''}`}
                onClick={() => togglePredicate(code)}
              >
                {relationLabel(code)}
              </span>
            ))}
          </div>
          {timeDim && mode !== 'timeline' && mode !== 'flow' && (
            <div className="inf-lg-time">
              <h5>{i18n.t('explore.axisTitle', { axis: axisName })}</h5>
              <div className="inf-lg-grid">
                <span
                  className={`inf-lg-switch ${showTimeAxis ? 'on' : ''}`}
                  onClick={toggleTimeAxis}
                  title={i18n.t('explore.showAxis', { axis: axisName })}
                >
                  <span className="inf-lg-check" />
                  {i18n.t('explore.showAxisShort', { axis: axisName })}
                </span>
                <span
                  className={`inf-lg-switch ${timeLayer ? 'on' : ''}`}
                  onClick={() => setTimeLayer((prev) => !prev)}
                  title={i18n.t('explore.layerBy', { axis: axisName })}
                >
                  <span className="inf-lg-check" />
                  {i18n.t('explore.layers')}
                </span>
              </div>
              {showTimeAxis && (
                <div className="inf-lg-time-range">
                  {unitRange(yearLo, yearHi)} · {i18n.t('explore.spanCount', { count: yearHi - yearLo + 1, unit: profile.unit.name })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 时间轴面板（左侧）：垂直双柄缩放章回范围 + 分层开关。
          只有画布实体带首次出场章回时才显示。
          区间变化同时驱动：① 可见性过滤（区间外隐藏）② 分层映射（开着分层时重排）。 */}
      {/* 时序 / 流转模式下画布不是 3D 图谱，年代轴与分层都没有作用对象 */}
      {/* 默认收起，由左下图例里的「显示…轴」打开 */}
      {showTimeAxis && timeDim && mode !== 'timeline' && mode !== 'flow' && (
        <div className="inf-time-axis">
          {/* 标题行：标题 + 分层开关（与时间轴一体，替代右上角旧按钮） */}
          <div className="inf-ta-head">
            <span className="inf-ta-title">{axisName}</span>
            <button
              type="button"
              className={`inf-ta-layer-btn ${timeLayer ? 'on' : ''}`}
              onClick={() => setTimeLayer((prev) => !prev)}
              title={i18n.t('explore.layerByFollow', { axis: axisName })}
            >
              {i18n.t('explore.layers')}
            </button>
            <button
              type="button"
              className="inf-ta-reset"
              onClick={() => { setYearLo(timeDim.lo); setYearHi(timeDim.hi) }}
              title={i18n.t('explore.restoreAxis', { axis: axisName })}
            >
              {i18n.t('explore.resetShort')}
            </button>
            <button
              type="button"
              className="inf-ta-reset inf-ta-close"
              onClick={toggleTimeAxis}
              title={i18n.t('explore.collapseLegend')}
              aria-label={i18n.t('explore.collapseLegend')}
            >
              <CloseOutlined />
            </button>
          </div>

          {/* 轨道 + 双柄 + 刻度 */}
          <div className="inf-ta-body">
            <div className="inf-ta-rail" ref={railRef}>
              {/* 高亮区段（两柄之间） */}
              <div className="inf-ta-band" style={bandStyle} />
              {/* 上柄 = 范围上限（更早的年代），下柄 = 范围下限（更晚的年代） */}
              <TimeHandle
                top={pctOf(yearLo)}
                label={unitLabel(yearLo)}
                onDrag={(pct) => setYearLo(Math.min(pctToYear(pct), yearHi - 3))}
              />
              <TimeHandle
                top={pctOf(yearHi)}
                label={unitLabel(yearHi)}
                onDrag={(pct) => setYearHi(Math.max(pctToYear(pct), yearLo + 3))}
              />
            </div>
            {/* 年份刻度：均匀五等分，帮助定位年代位置 */}
            <div className="inf-ta-ticks">
              {[0, 1, 2, 3, 4].map((i) => {
                const year = Math.round(timeDim.lo + (timeDim.hi - timeDim.lo) * (i / 4))
                return (
                  <span key={i} className="inf-ta-tick" style={{ top: `${(i / 4) * 100}%` }}>
                    {profile.units?.some((u) => u.label) ? unitLabel(year) : year}
                  </span>
                )
              })}
            </div>
          </div>

          {/* 底部读数：当前区间 + 跨度，拖动时一眼看清筛选状态 */}
          <div className="inf-ta-readout">
            <span className="inf-ta-range">{unitRange(yearLo, yearHi)}</span>
            <span className="inf-ta-span">{i18n.t('explore.spanCount', { count: yearHi - yearLo + 1, unit: profile.unit.name })}</span>
          </div>
        </div>
      )}

      {/* 右下 HUD：规模统计 + 回到全图视角 */}
      <div className="inf-hud">
        <div className="inf-stats">
          <span className="inf-dot-live" />
          <span><b>{visibleCount.nodes}</b> {i18n.t('explore.entityWord')} · <b>{visibleCount.edges}</b> {i18n.t('explore.relationWord')}</span>
        </div>
        <div className="inf-zoomer">
          {/* zoomToFit：平滑飞到能装下全图的视角（2D 场景没有相机，隐藏） */}
          {mode !== 'timeline' && mode !== 'flow' && (
            <>
              <button
                type="button"
                title={i18n.t('explore.resetTitle')}
                aria-label={i18n.t('explore.reset')}
                onClick={handleResetView}
              >
                <ReloadOutlined />
              </button>
              <button
                type="button"
                title={i18n.t('explore.fit')}
                aria-label={i18n.t('explore.fit')}
                onClick={() => canvasRef.current?.resetView()}
              >
                <ExpandOutlined />
              </button>
            </>
          )}
        </div>
      </div>

      {/* 顶部右侧操作：快速定位下拉（按实体类型分库），选中后打开右侧面板 */}
      <div className="inf-top-actions">
        <Dropdown
          trigger={['click']}
          menu={{
            items: locateLibraries().map((lib) => ({
              key: lib.key,
              label: lib.label,
              icon: <span className="inf-lg-dot" style={{ background: nodeColor(lib.key).main }} />,
            })),
            selectedKeys: locateLib ? [locateLib] : [],
            onClick: ({ key }) => setLocateLib(key as LocateLibrary),
          }}
        >
          <Button icon={<CompassOutlined />} type={locateLib ? 'primary' : 'default'} aria-label={i18n.t('explore.locate')}>
            {mobile ? i18n.t('explore.locateShort') : <>{i18n.t('explore.locate')} <DownOutlined style={{ fontSize: 10 }} /></>}
          </Button>
        </Dropdown>
        {mobile && (
          <Dropdown
            trigger={['click']}
            menu={{
              items: modeOptions().filter((o) => o.value !== 'clue').map((o) => ({ key: o.value, label: o.label })),
              selectedKeys: [mode],
              onClick: ({ key }) => setMode(key as ExploreMode),
            }}
          >
            <Button
              icon={<NodeIndexOutlined />}
              type={mode !== 'browse' && mode !== 'clue' ? 'primary' : 'default'}
              aria-label={i18n.t('explore.analysis')}
            >
              {i18n.t('explore.analyze')}
            </Button>
          </Dropdown>
        )}
      </div>

      {/* 快速定位面板（右侧）：按库列出实体，点选即以其为中心展开关系。
          key=库：切库重挂载，面板内筛选词与分页归零 */}
      {locateLib && (
        <QuickLocatePanel
          key={locateLib}
          library={locateLib}
          activeId={centerId}
          onChangeLibrary={setLocateLib}
          onPick={(item) => locateEntity(item.entity_id)}
          onClose={() => setLocateLib(null)}
        />
      )}

      {/* 分析面板（右侧）：与画布共用同一份图数据，只读呈现线索 */}
      <AnalysisPanel
        mode={mode}
        anchor={panelAnchor}
        cursorYear={cursorYear ?? undefined}
        resolveEntity={resolveEntity}
        flow={flow}
        flowSelection={activeFlowSelection}
        onFlowSelect={handleFlowPick}
        onLocate={locateFromPanel}
        onMergeGraph={(graph) => mergeGraph(
          graph as unknown as { nodes: GraphNode[]; edges: GraphEdge[] },
        )}
        onOpenArchive={(recordId, claimId) => setEvidenceTarget({ recordId, claimId })}
        onOpenCitation={openCitation}
        onClose={() => setMode('browse')}
      />

      {/* 底部提示条 */}
      <div className="inf-tipbar">
        {mode === 'timeline'
          ? i18n.t('explore.tipTimeline', { axis: axisName })
          : mode === 'flow'
            ? i18n.t('explore.tipFlow')
            : i18n.t('explore.tipBrowse')}
      </div>
    </div>
  )
}
