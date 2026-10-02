/**
 * 语义星图页（/g/:graphId/galaxy）
 *
 * 当前图谱原文片段的宏观语义分布：scatter 画 UMAP 2D 投影点。
 * 界面口径取图谱术语（terms.cluster：情节群 / 议题群 / 知识群，本文件注释里仍会写作"簇/族"）是一组内容相近的
 * 片段；界面上不出现"簇 / 族"等算法叫法，算法词一律不上屏，参数收进顶栏「高级选项」。
 *
 * 顶栏按"找 / 看 / 分析 / 做"分层，而不是把算法开关平铺一行：
 *   找   搜索原文（全书）
 *   看   视图状态徽章 + 点的大小 + 回到全貌
 *   分析 「分析」下拉（情节关联 / 疑似错位片段 / 情节重心变化），默认收起
 *   做   导出片段清单
 *   调参 「高级选项」Popover（联系强度、关联算法、重新分析）
 *
 * LOD（分层取数）两级：
 *   - 视口跨度大（看全局）→ 网格聚合气泡，一格一个泡
 *   - 视口跨度小（放大到局部）→ 按当前 bbox 拉单件档案点
 * 库内档案数不超过 POINT_MODE_MAX 时直接全量点，不进气泡模式——
 * 几百个点画成一百个气泡是体验降级。
 *
 * 本次精修新增：
 *   - 画布内主题群标签（按缩放与 size 分级显示）
 *   - 底部时间面板（年度堆叠面积 + 拖选区间压暗区间外点）
 *   - 全库标题搜索（后端 LIKE，命中飞到坐标并高亮）
 *   - Skeleton 加载态 / 空态带重新分析 CTA / 截断提示 / 交互提示条
 *   - 侧栏情节群勾选：多选对比 + 自动聚焦联合范围 + 导出清单
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Button, Checkbox, Dropdown, Empty, Input, InputRef, message, Popover, Select, Skeleton,
  Slider, Tag,
} from 'antd'
import { DownOutlined, SettingOutlined, SlidersOutlined } from '@ant-design/icons'
import * as echarts from 'echarts'
import {
  getGalaxyClusters,
  getGalaxyCoverage,
  getGalaxyEraClusters,
  getGalaxyGrid,
  getGalaxyPoints,
  getGalaxySimilar,
  getGalaxyTimeline,
  getGalaxyClusterBoard,
  getGalaxyDrift,
  getGalaxyDriftReport,
  getGalaxyLinks,
  getGalaxyOutliers,
  getGalaxySubclusters,
  downloadGalaxyDriftReport,
  rebuildGalaxy,
  searchGalaxy,
  type GalaxyCluster,
  type GalaxyClusterBoard,
  type GalaxyClusterLink,
  type GalaxyCoverage,
  type GalaxyDriftResult,
  type GalaxyEraCluster,
  type GalaxyGridCell,
  type GalaxyOutlier,
  type GalaxyPoint,
  type GalaxySimilarItem,
  type GalaxySubcluster,
  type GalaxyTimelineCell,
} from '../../../api/kg-explore'
import {
  buildClusterAnchorSeries,
  buildClusterLabelSeries,
  buildClusterLinkSeries,
  buildGalaxySeries,
  buildGridSeries,
  buildSimilarSeries,
  buildSubclusterLabelSeries,
  setDimKeepSet,
  setSearchHitSet,
  CANVAS_HALF_SPAN,
  AXIS_HALF_SPAN,
  clusterColor,
  clusterListModel,
  galaxyBaseOption,
  subClusterColor,
} from './buildGalaxyOption'
import TimelinePanel from './TimelinePanel'
import { activeProfile, displayUnitText, unitLabel, unitRange } from '@/graph/profile'
import i18n from '@/i18n'
import { displayText } from '@/utils/mathText'
import { useTheme } from '@/theme/ThemeProvider'
import { useIsMobile } from '@/hooks/useIsMobile'
import EvidenceHighlightDrawer from '../../../components/EvidenceHighlightDrawer'
import HintBar from '../components/HintBar'
import { useHotkeys } from '../components/useHotkeys'
import '../tokens.css'
import '../graph.css'

/** 不超过这个片段数就一直用点模式（后端单次取数上限也是 5000） */
const POINT_MODE_MAX = 5000
/** 视口跨度占全域比例低于此值时切到点模式 */
const POINT_MODE_SPAN_RATIO = 0.35
/** 单次按 bbox 取点的上限 */
const BBOX_POINT_LIMIT = 4000

/** dataZoom 百分比换算用轴域（±AXIS_HALF_SPAN），LOD/搜索定位与轴保持一致 */
const FULL_SPAN = AXIS_HALF_SPAN * 2

/** 实例还在、可安全调用 setOption/resize/off。dispose 后对象非空但已作废。 */
const chartAlive = (chart: echarts.ECharts | null): chart is echarts.ECharts => (
  !!chart && !chart.isDisposed()
)

/** 看板里的小条形图：名称 + 条 + 计数（年度/单位/类型/体量共用） */
function BoardBars({
  title, items, suffix = '', hint,
}: {
  title: string
  items: Array<{ label: string; count: number }>
  suffix?: string
  hint?: string
}) {
  const max = Math.max(...items.map((item) => item.count), 1)
  return (
    <div className="kgg-board-block">
      <div className="kgg-board-title">
        {title}
        {hint && <span className="kgg-board-hint">{hint}</span>}
      </div>
      {items.length === 0 && <div className="kgg-board-empty">{i18n.t('galaxy.empty')}</div>}
      {items.map((item) => (
        <div key={item.label} className="kgg-board-row">
          <span className="kgg-board-label" title={item.label}>{item.label}</span>
          <span className="kgg-board-bar">
            <span style={{ width: `${(item.count / max) * 100}%` }} />
          </span>
          <span className="kgg-board-count">{item.count}{suffix}</span>
        </div>
      ))}
    </div>
  )
}

export default function GalaxyPage() {
  const { theme } = useTheme()
  const mobile = useIsMobile()
  const gp = activeProfile()
  const t = gp.terms
  const unitName = gp.unit.name
  const chartRef = useRef<HTMLDivElement>(null)
  const chartInstance = useRef<echarts.ECharts | null>(null)
  /** 上次取数的视口，避免细微平移就重拉 */
  const lastFetchRef = useRef<{ minX: number; maxX: number; minY: number; maxY: number } | null>(null)
  const searchInputRef = useRef<InputRef>(null)

  const [points, setPoints] = useState<GalaxyPoint[]>([])
  const [cells, setCells] = useState<GalaxyGridCell[]>([])
  const [lodMode, setLodMode] = useState<'grid' | 'points'>('points')
  const [clusters, setClusters] = useState<GalaxyCluster[]>([])
  const [coverage, setCoverage] = useState<GalaxyCoverage | null>(null)
  const [activeCluster, setActiveCluster] = useState<number | null>(null)
  /**
   * 多簇对比选中集（需求 1）：侧栏 checkbox 勾选的簇。
   * 非空（≥1）时主画布未选中簇压暗保留——散点交叠处就是语义相近的证据，
   * 隐藏掉反而看不出"断层 vs 交叠"。
   * 与 activeCluster 互斥：单选聚焦是硬过滤模式，勾选是对比模式。
   */
  const [compareSet, setCompareSet] = useState<Set<number>>(new Set())
  const [highlight, setHighlight] = useState<string | null>(null)
  /** 搜索命中全集（需求 3：多命中高亮）——highlight 只保留首个命中 */
  const [searchHits, setSearchHits] = useState<string[]>([])
  /** 原文抽屉目标（点详情 → 查看原文）：片段 id + 片段原文（用于在整回里标出） */
  const [evidence, setEvidence] = useState<{ recordId: string; text?: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [searching, setSearching] = useState(false)
  const [detail, setDetail] = useState<GalaxyPoint | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [timeline, setTimeline] = useState<GalaxyTimelineCell[]>([])
  const [yearRange, setYearRange] = useState<[number, number] | null>(null)
  /** 侧栏语义族关键词筛选（族名 / 摘要 / 高频词任一命中） */
  const [clusterKw, setClusterKw] = useState('')
  /** 节点大小映射维度：none=固定 / persons=出场人物数 / chars=篇幅 */
  const [sizeField, setSizeField] = useState<'none' | 'persons' | 'chars'>('none')
  /** 锚点点击后打开的簇详情（需求 4：主题摘要 + 高频词） */
  const [anchorCluster, setAnchorCluster] = useState<GalaxyCluster | null>(null)
  /** 手机上簇列表是底部抽屉，默认收起 */
  const [sheetOpen, setSheetOpen] = useState(false)

  // ---------------- 语义星图增强（簇间关联 / 子簇 / 离群 / 漂移 / 看板） ----------------
  // 关联连线一次取回、前端按阈值过滤：拖动滑条不该每次打请求
  const [links, setLinks] = useState<GalaxyClusterLink[]>([])
  const [linkThreshold, setLinkThreshold] = useState(0.62)
  const [linkCaliber, setLinkCaliber] = useState<'centroid' | 'avg'>('centroid')
  const [showLinks, setShowLinks] = useState(false)
  const [showOutliers, setShowOutliers] = useState(false)
  /** 当前聚焦簇的子簇（有值时主画布按子簇改色并标名） */
  const [subClusters, setSubClusters] = useState<GalaxySubcluster[] | null>(null)
  const [outliers, setOutliers] = useState<GalaxyOutlier[]>([])
  const [outlierPanelOpen, setOutlierPanelOpen] = useState(false)
  const [board, setBoard] = useState<GalaxyClusterBoard | null>(null)
  const [drift, setDrift] = useState<GalaxyDriftResult | null>(null)
  const [driftOpen, setDriftOpen] = useState(false)
  const [driftPeriod, setDriftPeriod] = useState<string>('')
  const [driftPlaying, setDriftPlaying] = useState(false)
  const [outlierPattern, setOutlierPattern] = useState<'all' | 'misplaced' | 'drifted'>('all')
  /* ---------- 语义找相似（Embedding Atlas F5 的在线版） ---------- */
  /** 相似探索锚点（含画布坐标），非空时画布画锚点→相似件连线 */
  const [similar, setSimilar] = useState<{
    anchor: GalaxyPoint
    items: GalaxySimilarItem[]
  } | null>(null)
  const [similarLoading, setSimilarLoading] = useState(false)
  /** 年代区间主力语义族（时间面板 brush 后联动查询） */
  const [eraClusters, setEraClusters] = useState<GalaxyEraCluster[] | null>(null)

  /* ---------- 初始化加载 ---------- */

  useEffect(() => {
    let cancelled = false
    // 覆盖率依赖 Milvus，可能单独失败；簇与时间线仍应能出图
    Promise.allSettled([getGalaxyClusters(), getGalaxyCoverage(), getGalaxyTimeline()])
      .then(async ([cRes, covRes, tlRes]) => {
        if (cancelled) return
        if (cRes.status === 'fulfilled') setClusters(cRes.value.clusters)
        else message.error(i18n.t('galaxy.loadClusterFail', { cluster: t.cluster, error: cRes.reason?.message || cRes.reason }))

        const cov = covRes.status === 'fulfilled'
          ? covRes.value
          : { vectorized: 0, total_records: 0, coverage: 0 } as GalaxyCoverage
        if (covRes.status === 'rejected') {
          message.warning(i18n.t('galaxy.indexDown'))
        }
        setCoverage(cov)

        if (tlRes.status === 'fulfilled') setTimeline(tlRes.value.matrix)

        // 规模决定初始层级：小库直接上点，大库先给全局气泡
        if (cov.vectorized <= POINT_MODE_MAX) {
          const p = await getGalaxyPoints({
            min_x: -CANVAS_HALF_SPAN, max_x: CANVAS_HALF_SPAN,
            min_y: -CANVAS_HALF_SPAN, max_y: CANVAS_HALF_SPAN,
            limit: POINT_MODE_MAX,
          })
          if (cancelled) return
          setPoints(p.points)
          setTruncated(p.truncated)
          setLodMode('points')
        } else {
          const g = await getGalaxyGrid()
          if (cancelled) return
          setCells(g.cells)
          setLodMode('grid')
        }
      })
      .catch((e) => message.error(i18n.t('galaxy.distFail', { error: e.message })))
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  /* ---------- LOD：按视口切层级并取数 ---------- */

  const isLargeLibrary = (coverage?.vectorized ?? 0) > POINT_MODE_MAX

  /** 当前视口跨度占全域比例（簇标签分级显示用） */
  const viewportSpanRatio = useRef(1)
  const [spanRatio, setSpanRatio] = useState(1)

  const syncViewport = useCallback(() => {
    const chart = chartInstance.current
    if (!chartAlive(chart) || !isLargeLibrary) return

    // 从 dataZoom 的百分比区间反算画布坐标区间
    const zooms = (chart.getOption() as any).dataZoom || []
    const xz = zooms[0] || { start: 0, end: 100 }
    const yz = zooms[1] || { start: 0, end: 100 }
    const toCoord = (pct: number) => -AXIS_HALF_SPAN + (FULL_SPAN * pct) / 100
    const minX = toCoord(xz.start)
    const maxX = toCoord(xz.end)
    const minY = toCoord(yz.start)
    const maxY = toCoord(yz.end)

    const ratio = Math.max((maxX - minX) / FULL_SPAN, (maxY - minY) / FULL_SPAN)
    viewportSpanRatio.current = ratio
    setSpanRatio(ratio)

    if (ratio > POINT_MODE_SPAN_RATIO) {
      setLodMode('grid')
      lastFetchRef.current = null
      return
    }

    // 视口没实质变化就不重拉（滚轮会连发很多次事件）
    const last = lastFetchRef.current
    const moved = !last
      || Math.abs(last.minX - minX) > (maxX - minX) * 0.2
      || Math.abs(last.minY - minY) > (maxY - minY) * 0.2
      || Math.abs((last.maxX - last.minX) - (maxX - minX)) > (maxX - minX) * 0.2
    if (!moved) {
      setLodMode('points')
      return
    }
    lastFetchRef.current = { minX, maxX, minY, maxY }
    getGalaxyPoints({
      min_x: minX, max_x: maxX, min_y: minY, max_y: maxY, limit: BBOX_POINT_LIMIT,
    })
      .then((p) => {
        setPoints(p.points)
        setTruncated(p.truncated)
        setLodMode('points')
      })
      .catch((e) => message.error(i18n.t('galaxy.viewFail', { error: e.message })))
  }, [isLargeLibrary])

  useEffect(() => {
    const chart = chartInstance.current
    if (!chartAlive(chart) || !isLargeLibrary) return
    // 滚轮缩放会连续触发，节流后再取数
    let timer = 0
    const onZoom = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(syncViewport, 260)
    }
    chart.on('dataZoom', onZoom)
    return () => {
      window.clearTimeout(timer)
      if (chartAlive(chart)) chart.off('dataZoom', onZoom)
    }
  }, [syncViewport, isLargeLibrary])

  /* ---------- 渲染 ---------- */

  // 时间面板堆叠只画 size 最大的前 8 个簇，其余合并为"其他簇"
  const topClusters = useMemo(
    () => clusterListModel(clusters).slice(0, 8).map((c) => c.cluster_id),
    [clusters],
  )

  const option = useMemo(() => {
    const base = galaxyBaseOption()
    // 簇标签两种模式都要：气泡模式看簇名更有意义，点模式是精确定位
    const labels = buildClusterLabelSeries(clusters, spanRatio, activeCluster, compareSet)
    // 相似探索激活时：同步保留集合（锚点+相似件），主系列按它压暗其他点
    setDimKeepSet(similar ? [similar.anchor.record_id, ...similar.items.map((i) => i.record_id)] : null)
    // 搜索命中集合注入（多命中高亮）：清空搜索时移除
    setSearchHitSet(searchHits.length ? searchHits : null)
    // 簇中心锚点（需求 4）：五角星标记语义质心，点击开簇详情卡。
    // 对比模式/单选聚焦时只画选中簇的锚点，与主画布过滤一致。
    const anchors = buildClusterAnchorSeries(
      clusters,
      activeCluster !== null ? new Set([activeCluster]) : compareSet.size ? compareSet : null,
    )
    // 簇间关联层（可开关）：阈值与口径都在前端，拖动即时生效、不打请求。
    // 相似度来自高维空间，线只是"把关系画在画布上"，不参与距离判断。
    const scope = activeCluster !== null
      ? new Set([activeCluster])
      : (compareSet.size ? compareSet : null)
    const linkSeries = showLinks && links.length
      ? buildClusterLinkSeries(links, linkThreshold, linkCaliber, scope)
      : null
    // 子簇标签层：只有聚焦到分过子群的簇时才有内容
    const subLabelSeries = subClusters && subClusters.length
      ? buildSubclusterLabelSeries(subClusters, activeCluster)
      : null
    const similarSeries = similar
      ? buildSimilarSeries(
          {
            x: similar.anchor.x,
            y: similar.anchor.y,
            cluster_id: similar.anchor.cluster_id,
            record_id: similar.anchor.record_id,
            title: similar.anchor.title,
            year: similar.anchor.year,
            category_code: similar.anchor.category_code,
            archive_number: similar.anchor.archive_number,
          },
          similar.items,
        )
      : []
    if (lodMode === 'grid') {
      // 气泡模式也注入相似连线层：大库缩回全局时相似探索状态仍在，
      // 连线（自带坐标）不依赖点模式数据，画在气泡之上保持视觉连续
      return {
        ...base,
        series: [
          ...(linkSeries ? [linkSeries] : []),
          ...(cells.length ? [buildGridSeries(cells, activeCluster, compareSet)] : []),
          ...(subLabelSeries ? [subLabelSeries] : []),
          labels,
          anchors,
          ...similarSeries,
        ],
      }
    }
    return {
      ...base,
      series: [
        ...(linkSeries ? [linkSeries] : []),
        ...(points.length
          ? [buildGalaxySeries(
              points, activeCluster, highlight, yearRange, !!similar, compareSet,
              sizeField, subClusters, showOutliers,
            )]
          : []),
        ...(subLabelSeries ? [subLabelSeries] : []),
        labels,
        anchors,
        ...similarSeries,
      ],
    }
  }, [
    lodMode, cells, points, activeCluster, compareSet, highlight, searchHits, clusters,
    spanRatio, yearRange, similar, sizeField,
    links, linkThreshold, linkCaliber, showLinks, showOutliers, subClusters, theme,
  ])

  /* ---------- 时间→语义联动：brush 年度区间后查主力语义族 ---------- */

  useEffect(() => {
    // 没有区间就清空徽章（避免残留上一次的查询结果）
    if (!yearRange) {
      setEraClusters(null)
      return
    }
    let stale = false
    getGalaxyEraClusters(yearRange[0], yearRange[1], 8)
      .then((r) => { if (!stale) setEraClusters(r.clusters) })
      .catch(() => { if (!stale) setEraClusters(null) })
    return () => { stale = true }
  }, [yearRange])

  /* ---------- 增强分析数据（关联 / 子簇 / 看板 / 离群 / 漂移） ---------- */

  /** 簇集合签名：重建后簇编号会变，用它判断"要不要重新拉关联线" */
  const clusterSig = useMemo(
    () => clusters.map((c) => c.cluster_id).join(','),
    [clusters],
  )

  // 关联线与重建任务同生命周期：重建完成后簇编号会变，旧连线必须作废
  useEffect(() => {
    let stale = false
    getGalaxyLinks(0, 400)
      .then((r) => { if (!stale) setLinks(r.items) })
      .catch(() => { if (!stale) setLinks([]) })
    return () => { stale = true }
  }, [clusterSig])

  // 聚焦到某个簇时才需要它的子簇（无关簇的子簇不拉，省一次往返）
  useEffect(() => {
    if (activeCluster === null) {
      setSubClusters(null)
      return
    }
    let stale = false
    getGalaxySubclusters(activeCluster)
      .then((r) => { if (!stale) setSubClusters(r.items) })
      .catch(() => { if (!stale) setSubClusters(null) })
    return () => { stale = true }
  }, [activeCluster])

  // 点击簇锚点即拉多维看板（件数/年度/词云/单位/类型/体量）
  useEffect(() => {
    if (!anchorCluster) {
      setBoard(null)
      return
    }
    let stale = false
    getGalaxyClusterBoard(anchorCluster.cluster_id)
      .then((r) => { if (!stale) setBoard(r) })
      .catch(() => { if (!stale) setBoard(null) })
    return () => { stale = true }
  }, [anchorCluster])

  // 离群清单：图层或面板任一需要时取一次
  useEffect(() => {
    if (!showOutliers && !outlierPanelOpen) return
    let stale = false
    getGalaxyOutliers({ limit: 200 })
      .then((r) => { if (!stale) setOutliers(r.items) })
      .catch(() => { if (!stale) setOutliers([]) })
    return () => { stale = true }
  }, [showOutliers, outlierPanelOpen])

  // 漂移：打开面板时取一次
  useEffect(() => {
    if (!driftOpen) return
    let stale = false
    getGalaxyDrift()
      .then((r) => {
        if (stale) return
        setDrift(r)
        setDriftPeriod((prev) => (prev && r.periods.includes(prev)
          ? prev
          : (r.periods[0] || '')))
      })
      .catch(() => { if (!stale) setDrift(null) })
    return () => { stale = true }
  }, [driftOpen])

  /** 漂移播放/拖动到某个时段：复用既有的章回筛选（时段形如「第1–10回」） */
  const applyDriftPeriod = useCallback((period: string) => {
    setDriftPeriod(period)
    if (!period) { setYearRange(null); return }
    const match = /(\d+)\D+(\d+)/.exec(period)
    if (!match) { setYearRange(null); return }
    setYearRange([Number(match[1]), Number(match[2])])
  }, [])

  const stepDrift = useCallback((delta: number) => {
    if (!drift || drift.periods.length === 0) return
    const index = drift.periods.indexOf(driftPeriod)
    const next = Math.min(Math.max((index < 0 ? 0 : index) + delta, 0), drift.periods.length - 1)
    applyDriftPeriod(drift.periods[next])
  }, [drift, driftPeriod, applyDriftPeriod])

  /** 漂移自动播放：按时段步进，走完停在末段（不循环，避免看不出"结束"） */
  useEffect(() => {
    if (!driftPlaying || !drift || drift.periods.length === 0) return
    const timer = window.setInterval(() => {
      const index = drift.periods.indexOf(driftPeriod)
      if (index >= drift.periods.length - 1) {
        setDriftPlaying(false)
        return
      }
      applyDriftPeriod(drift.periods[index + 1])
    }, 1200)
    return () => window.clearInterval(timer)
  }, [driftPlaying, drift, driftPeriod, applyDriftPeriod])

  /** 当前漂移时段的构成：件数 Top 簇 + 新增/消退关键词 */
  const driftSnapshot = useMemo(() => {
    if (!drift || !driftPeriod) return null
    const rows: Array<{ clusterId: number; count: number; share: number }> = []
    const added: string[] = []
    const gone: string[] = []
    drift.series.forEach((series) => {
      const point = series.points.find((p) => p.period === driftPeriod)
      if (!point) return
      rows.push({ clusterId: series.cluster_id, count: point.count, share: point.share })
      point.new_keywords.forEach((word) => { if (!added.includes(word)) added.push(word) })
      point.gone_keywords.forEach((word) => { if (!gone.includes(word)) gone.push(word) })
    })
    rows.sort((a, b) => b.count - a.count)
    const metric = drift.metrics.find(
      (m) => m.period === driftPeriod && m.cluster_id === rows[0]?.clusterId,
    )
    return {
      top: rows.slice(0, 6),
      added: added.slice(0, 8),
      gone: gone.slice(0, 8),
      significant: Boolean(metric?.significant),
    }
  }, [drift, driftPeriod])

  const visibleOutliers = useMemo(() => (
    outlierPattern === 'all'
      ? outliers
      : outliers.filter((item) => (outlierPattern === 'misplaced'
        ? item.misplaced === 1
        : item.misplaced === 0))
  ), [outliers, outlierPattern])

  useEffect(() => {
    if (!chartRef.current) return
    // StrictMode 会先 dispose 再二次挂载：已作废的实例要重建，不能直接 setOption
    if (!chartAlive(chartInstance.current)) {
      chartInstance.current = echarts.init(chartRef.current)
    }
    // notMerge 会重置 dataZoom 状态，把用户刚缩放的视口弹回去。
    // 只有切换 LOD 层级（series 类型变了）时才需要整体替换。
    chartInstance.current.setOption(option, { replaceMerge: ['series'] })
  }, [option])

  useEffect(() => {
    const onResize = () => {
      const chart = chartInstance.current
      if (chartAlive(chart)) chart.resize()
    }
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      if (chartAlive(chartInstance.current)) chartInstance.current.dispose()
      chartInstance.current = null
    }
  }, [])

  /* ---------- 交互 ---------- */

  /** 把视口缩到以 (cx, cy) 为中心的一格附近，dataZoom 变更会带出点级取数 */
  const zoomToBox = useCallback((cx: number, cy: number) => {
    const chart = chartInstance.current
    if (!chartAlive(chart)) return
    const halfWin = FULL_SPAN * POINT_MODE_SPAN_RATIO * 0.4
    const toPct = (coord: number) =>
      Math.max(0, Math.min(100, ((coord + AXIS_HALF_SPAN) / FULL_SPAN) * 100))
    chart.dispatchAction({
      type: 'dataZoom', dataZoomIndex: 0,
      start: toPct(cx - halfWin), end: toPct(cx + halfWin),
    })
    chart.dispatchAction({
      type: 'dataZoom', dataZoomIndex: 1,
      start: toPct(cy - halfWin), end: toPct(cy + halfWin),
    })
  }, [])

  /**
   * 飞视口到坐标范围（语义族侧栏点击聚焦用）。
   *
   * 关键点：
   * 1. 留边距——范围直接贴边会被面板遮住四角，20% padding 让整簇
   *    舒适地落在画布内；大库（气泡模式）下还要预留"点气泡下钻"的
   *    判断余量，聚焦后 ratio 低于阈值自动切点模式。
   * 2. 宽高分别适配——簇在画布上是狭长形状时，按较宽的一轴决定缩放，
   *    另一轴居中即可（两边 dataZoom 各自独立）。
   * 3. 范围退化（单点/极小簇）时保底一个最小视口，避免无限放大。
   */
  const flyToBBox = useCallback((
    minX: number, maxX: number, minY: number, maxY: number,
  ) => {
    const chart = chartInstance.current
    if (!chartAlive(chart)) return
    // padding 后的范围；minSpan 保底（画布全域 200，最小看 12 宽）
    const PAD = 0.2
    let spanX = (maxX - minX) || 0
    let spanY = (maxY - minY) || 0
    const minSpan = FULL_SPAN * 0.06
    spanX = Math.max(spanX, minSpan)
    spanY = Math.max(spanY, minSpan)
    // 较宽的轴决定缩放级别，另一轴用同样的跨度居中（等比缩放不变形）
    const span = Math.max(spanX, spanY) * (1 + PAD)
    const cx = (minX + maxX) / 2
    const cy = (minY + maxY) / 2
    const toPct = (coord: number) =>
      Math.max(0, Math.min(100, ((coord + AXIS_HALF_SPAN) / FULL_SPAN) * 100))
    chart.dispatchAction({
      type: 'dataZoom', dataZoomIndex: 0,
      start: toPct(cx - span / 2), end: toPct(cx + span / 2),
    })
    chart.dispatchAction({
      type: 'dataZoom', dataZoomIndex: 1,
      start: toPct(cy - span / 2), end: toPct(cy + span / 2),
    })
  }, [])

  useEffect(() => {
    const chart = chartInstance.current
    if (!chartAlive(chart)) return
    const onClick = (params: any) => {
      if (params.data?.record_id) {
        setDetail(params.data as GalaxyPoint)
        return
      }
      // 簇锚点（需求 4）：点击五角星打开簇详情卡（主题摘要 + 高频词）
      if (params.data?.cluster) {
        setAnchorCluster(params.data.cluster as GalaxyCluster)
        return
      }
      // 点网格气泡：缩放到该格，触发点级取数（气泡本身不是档案，无详情可看）
      if (params.data?.count != null) {
        const [cx, cy] = params.data.value
        zoomToBox(cx, cy)
      }
    }
    chart.on('click', onClick)
    return () => {
      if (chartAlive(chart)) chart.off('click', onClick)
    }
  }, [option, zoomToBox])

  /* ---------- 全库搜索（后端 LIKE，不受视口限制） ---------- */

  const doSearch = useCallback(async (kw: string) => {
    if (!kw.trim()) {
      setHighlight(null)
      setSearchHits([])
      return
    }
    setSearching(true)
    try {
      const res = await searchGalaxy(kw.trim(), 20)
      if (!res.items.length) {
        setHighlight(null)
        setSearchHits([])
        message.info(i18n.t('galaxy.noHit', { q: kw.trim() }))
        return
      }
      const hit = res.items[0]
      // 多命中检索联动（需求 3）：全部命中点白心高亮 + 其余点压暗。
      // highlight 仍是首个命中（详情卡 + 飞视口目标）。
      setSearchHits(res.items.map((it) => it.record_id))
      setHighlight(hit.record_id)
      setDetail(hit)
      if (res.total > res.items.length) {
        message.info(i18n.t('galaxy.hitPaged', { total: res.total, shown: res.items.length }))
      } else {
        message.info(i18n.t('galaxy.hitAll', { count: res.items.length }))
      }
      // 飞到命中点：大库时视口切换会触发点级取数，飞过去后点已在数据里
      zoomToBox(hit.x, hit.y)
    } catch (e: any) {
      message.error(e.message || i18n.t('galaxy.searchFail'))
    } finally {
      setSearching(false)
    }
  }, [zoomToBox])

  const resetView = useCallback(() => {
    const chart = chartInstance.current
    if (chartAlive(chart)) {
      chart.dispatchAction({ type: 'dataZoom', dataZoomIndex: 0, start: 0, end: 100 })
      chart.dispatchAction({ type: 'dataZoom', dataZoomIndex: 1, start: 0, end: 100 })
    }
    setActiveCluster(null)
    setCompareSet(new Set())
    setHighlight(null)
    setSearchHits([])
    setYearRange(null)
    setSimilar(null)
    setSizeField('none')
  }, [])

  /**
   * 语义找相似：以 detail 档案为锚点，Milvus 原始向量空间 ANN 检索。
   * 结果画成"锚点→相似件"连线层；相似件可能落在多个语义族——
   * 这正是"语义族找同类"的直观形态：同类不一定都在一个簇里。
   */
  const doSimilar = useCallback(async (record: GalaxyPoint) => {
    setSimilarLoading(true)
    try {
      const res = await getGalaxySimilar(record.record_id, 30)
      setSimilar({ anchor: record, items: res.items })
      // 视口飞到锚点附近（连线层自带坐标，不依赖主系列是否加载了这些点）
      zoomToBox(record.x, record.y)
      message.success(i18n.t('galaxy.similarOk', { count: res.items.length }))
    } catch (e) {
      message.error(e instanceof Error ? e.message : i18n.t('galaxy.similarFail'))
    } finally {
      setSimilarLoading(false)
    }
  }, [zoomToBox])

  /**
   * 侧栏点语义族：过滤 + 飞视口一步完成。
   *
   * 此前只 setActiveCluster 不动视口，用户点了族还要自己在全域画布上
   * 找那族点在哪——侧栏的意义就是"点它→看它"，视口必须跟着走。
   * 簇的 bbox 由后端 clusters 接口带出（MIN/MAX 实时聚合）。
   * 再次点击同一族 = 取消聚焦（回全部），不飞视口（用户可能在看别处）。
   * 进入单选聚焦时清空对比勾选：两种模式互斥，混用会让压暗语义混乱。
   */
  // 簇相关 Map 在交互回调之前声明：exportSelectedCsv（CSV 所属簇列）
  // 与详情卡都要读 clusterName，声明在使用之后 TS 会报 block-scoped 错误。
  const clusterList = useMemo(() => clusterListModel(clusters), [clusters])
  const clusterName = useMemo(
    () => new Map(clusters.map((c) => [c.cluster_id, c])),
    [clusters],
  )
  // 簇 id -> 簇名（轻量 Map）：时间面板 tooltip 显示 LLM 命名的簇名，
  // 避免"簇 13"这种编号（编号只在 debug 时有意义）
  const clusterNameMap = useMemo(
    () => new Map(clusters.map((c) => [c.cluster_id, c.name])),
    [clusters],
  )
  const selectCluster = useCallback((c: GalaxyCluster) => {
    setSheetOpen(false)
    if (activeCluster === c.cluster_id) {
      setActiveCluster(null)
      return
    }
    setCompareSet(new Set())
    setActiveCluster(c.cluster_id)
    // 有 bbox 才飞：质心为 null 的簇（无点数据）飞了也是空画布
    if (
      c.min_x != null && c.max_x != null
      && c.min_y != null && c.max_y != null
    ) {
      flyToBBox(c.min_x, c.max_x, c.min_y, c.max_y)
    }
  }, [activeCluster, flyToBBox])

  /**
   * 勾选集合的联合 bbox → 飞视口。
   * 勾了几族画布就把这几族一起框进来：多选对比的意义是"同屏看交叠/断层"，
   * 只飞第一族的话后勾的族很可能在屏外，用户还得手动缩放去找。
   */
  const flyToClusters = useCallback((ids: Set<number>) => {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    clusters.forEach((c) => {
      if (!ids.has(c.cluster_id)) return
      if (c.min_x == null || c.max_x == null || c.min_y == null || c.max_y == null) return
      minX = Math.min(minX, c.min_x)
      maxX = Math.max(maxX, c.max_x)
      minY = Math.min(minY, c.min_y)
      maxY = Math.max(maxY, c.max_y)
    })
    if (Number.isFinite(minX) && Number.isFinite(minY)) {
      flyToBBox(minX, maxX, minY, maxY)
    }
  }, [clusters, flyToBBox])

  /**
   * 多簇对比勾选：checkbox 切换某簇的选中态。
   * 勾选任何簇就退出单选聚焦（两种模式互斥）。
   * 每次勾选变化都重新聚焦到所有已勾选族的联合范围；
   * 取消到一族不剩时不动视口（用户可能正在看别处）。
   */
  const toggleCompare = useCallback((c: GalaxyCluster, checked: boolean) => {
    if (activeCluster !== null) setActiveCluster(null)
    const next = new Set(compareSet)
    if (checked) next.add(c.cluster_id)
    else next.delete(c.cluster_id)
    setCompareSet(next)
    if (next.size) flyToClusters(next)
  }, [activeCluster, compareSet, flyToClusters])

  /** 侧栏关键词筛选后的语义族列表（族名 / 摘要 / 高频词任一命中） */
  const filteredClusterList = useMemo(() => {
    const kw = clusterKw.trim().toLowerCase()
    if (!kw) return clusterList
    return clusterList.filter((c) =>
      (c.name || '').toLowerCase().includes(kw)
      || (c.summary || '').toLowerCase().includes(kw)
      || (c.keywords || []).some((k) => k.toLowerCase().includes(kw)))
  }, [clusterList, clusterKw])

  /** 已勾选语义族在当前已加载点中的成员（导出元数据用） */
  const selected = useMemo(
    () => (compareSet.size ? points.filter((p) => compareSet.has(p.cluster_id)) : []),
    [points, compareSet],
  )
  /** 已勾选语义族的片段总数（后端簇 size 之和，不受视口取数限制） */
  const selectedTotal = useMemo(
    () => clusters.reduce((s, c) => s + (compareSet.has(c.cluster_id) ? c.size : 0), 0),
    [clusters, compareSet],
  )

  /**
   * 导出 CSV：勾选情节群的片段一键下载。
   * 纯前端拼 CSV，BOM 头让 Excel 正确识别 UTF-8。
   */
  const exportSelectedCsv = useCallback(() => {
    if (!selected.length) {
      message.info(
        compareSet.size
          ? i18n.t('galaxy.exportNeedZoom')
          : i18n.t('galaxy.exportNeedPick', { cluster: t.cluster }),
      )
      return
    }
    const header = [i18n.t('galaxy.csvPos'), gp.unit.axis, i18n.t('galaxy.csvCluster', { cluster: t.cluster }), t.primary, t.secondary, i18n.t('galaxy.csvChars'), i18n.t('galaxy.csvLead')]
    const esc = (v: unknown) => {
      const s = String(v ?? '')
      // CSV 注入防护：以 = + - @ 开头的值前置单引号，防止 Excel 公式执行
      return /^[=+\-@]/.test(s) ? `'${s}` : s
    }
    const rows = selected.map((p: any) => [
      esc(p.archive_number), p.year ? esc(unitLabel(p.year)) : '',
      esc(clusterName.get(p.cluster_id)?.name || `${t.cluster} ${p.cluster_id}`),
      esc((p.persons || []).join('、')), esc((p.places || []).join('、')),
      p.char_count ?? '', esc(p.title),
    ])
    const csv = '\uFEFF' + [header, ...rows]
      .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
      .join('\r\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${gp.name}_${t.cluster}_${t.segment}_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
    message.success(i18n.t('galaxy.exported', { count: selected.length, segment: t.segment }))
  }, [selected, compareSet, clusterName, gp, t])

  useHotkeys({
    '/': () => searchInputRef.current?.focus(),
    Escape: () => {
      if (evidence) setEvidence(null)
      else if (anchorCluster) setAnchorCluster(null)
      else if (detail) setDetail(null)
      else if (similar) setSimilar(null)
      else if (highlight) { setHighlight(null); setSearchHits([]) }
      else if (activeCluster !== null) setActiveCluster(null)
      else if (compareSet.size) setCompareSet(new Set())
      else if (yearRange) setYearRange(null)
    },
    r: resetView,
  })

  const doRebuild = useCallback(() => {
    rebuildGalaxy()
      .then(() => message.success(i18n.t('galaxy.rebuildOk')))
      .catch((e) => message.error(e.message))
  }, [])

  /* ---------- 渲染 ---------- */

  const hasData = points.length > 0 || cells.length > 0

  /**
   * 「分析」下拉：三个分析入口收进一个菜单，状态直接写进菜单文案。
   *
   * 收进下拉后：顶栏只留"找 / 看 / 做"，想深入看的时候才展开分析菜单。
   */
  const analysisMenu = {
    items: [
      {
        key: 'links',
        disabled: !links.length,
        label: showLinks
          ? i18n.t('galaxy.linksOn', { cluster: t.cluster, count: links.length, threshold: linkThreshold.toFixed(2) })
          : (links.length
            ? i18n.t('galaxy.linksOffCount', { cluster: t.cluster, count: links.length })
            : i18n.t('galaxy.linksOff', { cluster: t.cluster })),
      },
      {
        key: 'outliers',
        disabled: !points.length,
        label: showOutliers
          ? i18n.t('galaxy.outliersOn', { count: visibleOutliers.length, segment: t.segment })
          : i18n.t('galaxy.outliersOff'),
      },
      { type: 'divider' as const },
      { key: 'outlierList', label: i18n.t('galaxy.outlierList') },
      { key: 'drift', label: i18n.t('galaxy.drift', { cluster: t.cluster, size: gp.period_size, unit: unitName }) },
    ],
    onClick: ({ key }: { key: string }) => {
      if (key === 'links') setShowLinks((prev) => !prev)
      else if (key === 'outliers') setShowOutliers((prev) => !prev)
      else if (key === 'outlierList') setOutlierPanelOpen(true)
      else if (key === 'drift') setDriftOpen(true)
    },
  }

  /** 手机工具条只留搜索 + 这一个菜单：点的大小、分析、回到全貌；调参与导出留给桌面 */
  const mobileViewMenu = {
    selectedKeys: [`size:${sizeField}`],
    items: [
      {
        type: 'group' as const,
        label: i18n.t('galaxy.size'),
        children: [
          { key: 'size:none', label: i18n.t('galaxy.sizeNone') },
          { key: 'size:persons', label: i18n.t('galaxy.sizePrimary', { primary: t.primary }) },
          { key: 'size:chars', label: i18n.t('galaxy.sizeChars') },
        ],
      },
      { type: 'divider' as const },
      { type: 'group' as const, label: i18n.t('galaxy.analyze'), children: analysisMenu.items.filter((item) => !('type' in item)) },
      { type: 'divider' as const },
      { key: 'reset', label: i18n.t('galaxy.reset') },
    ],
    onClick: ({ key }: { key: string }) => {
      if (key.startsWith('size:')) setSizeField(key.slice(5) as typeof sizeField)
      else if (key === 'reset') resetView()
      else analysisMenu.onClick({ key })
    },
  }

  /**
   * 「高级选项」：算法参数与重新分析。
   *
   * 联系强度、关联算法这些是调参用的，默认不占顶栏；但也不能藏得找不到——
   * 每个参数后面都跟一句人话说明，而不是把算法名丢给用户自己猜。
   */
  const advancedPanel = (
    <div className="kgg-advanced">
      <div className="kgg-adv-group">
        <div className="kgg-adv-title">{i18n.t('galaxy.linksTitle', { cluster: t.cluster })}</div>
        <div className="kgg-link-controls">
          <span className="kgg-adv-label">{i18n.t('galaxy.strengthAtLeast')}</span>
          <Slider
            min={0.3}
            max={0.95}
            step={0.01}
            value={linkThreshold}
            onChange={setLinkThreshold}
            className="kgg-link-slider"
            tooltip={{ formatter: (v) => i18n.t('galaxy.linkTip', { value: v }) }}
          />
          <span className="kgg-link-readout">{linkThreshold.toFixed(2)}</span>
        </div>
        <div className="kgg-adv-hint">{i18n.t('galaxy.strengthHint', { cluster: t.cluster })}</div>
        <div className="kgg-link-controls">
          <span className="kgg-adv-label">{i18n.t('galaxy.algorithm')}</span>
          <Select
            size="small"
            value={linkCaliber}
            onChange={setLinkCaliber}
            options={[
              { value: 'centroid', label: i18n.t('galaxy.byCentroid', { cluster: t.cluster }) },
              { value: 'avg', label: i18n.t('galaxy.byAvg') },
            ]}
          />
        </div>
        <div className="kgg-adv-hint">{i18n.t('galaxy.algorithmHint')}</div>
      </div>
      <div className="kgg-adv-group">
        <div className="kgg-adv-title">{i18n.t('galaxy.data')}</div>
        <Button size="small" onClick={doRebuild}>{i18n.t('galaxy.rebuild')}</Button>
        <div className="kgg-adv-hint">
          {i18n.t('galaxy.reanalyzeNote')}
        </div>
      </div>
    </div>
  )

  return (
    <div className="kg-galaxy-page">
      <div className="kg-topbar">
        <Input.Search
          ref={searchInputRef}
          className="kg-search"
          placeholder={mobile ? i18n.t('galaxy.searchPhShort') : i18n.t('galaxy.searchPh', { example: gp.examples?.search ? i18n.t('explore.searchExample', { q: gp.examples.search }) : '' })}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            // 顶栏不再放"检索命中"徽章，清空输入即清除高亮
            if (!e.target.value) { setHighlight(null); setSearchHits([]) }
          }}
          onSearch={doSearch}
          loading={searching}
          allowClear
          size={mobile ? 'large' : 'small'}
        />
        {mobile && (
          <Dropdown trigger={['click']} menu={mobileViewMenu} placement="bottomRight">
            <Button size="large" icon={<SlidersOutlined />} aria-label={i18n.t('galaxy.viewAria')}>{i18n.t('galaxy.view')}</Button>
          </Dropdown>
        )}
        {!mobile && isLargeLibrary && (
          <Tag color={lodMode === 'grid' ? 'orange' : 'blue'}>
            {lodMode === 'grid'
              ? i18n.t('galaxy.overview', { cluster: t.cluster, count: cells.length })
              : i18n.t('galaxy.detail', { segment: t.segment, count: points.length })}
          </Tag>
        )}
        {!mobile && (<>
        <Select
          size="small"
          className="kgg-sizefield-select"
          value={sizeField}
          onChange={setSizeField}
          options={[
            { value: 'none', label: i18n.t('galaxy.sizeNoneFull') },
            { value: 'persons', label: i18n.t('galaxy.sizePrimaryFull', { primary: t.primary }) },
            { value: 'chars', label: i18n.t('galaxy.sizeCharsFull') },
          ]}
        />

        {/* 分析入口：三个分析能力收进下拉（图层开关的状态写在菜单文案里） */}
        <Dropdown trigger={['click']} menu={analysisMenu}>
          <Button size="small">
            {i18n.t('galaxy.analyze')} <DownOutlined style={{ fontSize: 10 }} />
          </Button>
        </Dropdown>
        {/* 高级选项：算法参数与重新分析，默认收起 */}
        <Popover
          trigger={['click']}
          placement="bottomLeft"
          title={i18n.t('galaxy.advanced')}
          content={advancedPanel}
        >
          <Button size="small" icon={<SettingOutlined />}>{i18n.t('galaxy.advanced')}</Button>
        </Popover>

        {/* 业务出口靠右：导出清单 / 回到全貌 */}
        <div className="kg-topbar-actions">
          <Button size="small" onClick={exportSelectedCsv} disabled={!selected.length}>
            {i18n.t('galaxy.exportList', { extra: selected.length ? ` (${selected.length})` : '' })}
          </Button>
          <Button size="small" onClick={resetView}>{i18n.t('galaxy.reset')}</Button>
        </div>
        </>)}
      </div>

      <div className="kg-main">
        <div className="kgg-canvas" ref={chartRef} />

        {loading && (
          <div className="kgg-detail-drawer">
            <Skeleton active title={false} paragraph={{ rows: 6 }} />
          </div>
        )}

        {!loading && !hasData && (
          <div className="kg-empty">
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                <span className="kg-empty-desc">
                  {i18n.t('galaxy.emptyGalaxy', { id: gp.id, segment: t.segment, cluster: t.cluster })}
                </span>
              }
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <Button type="primary" onClick={doRebuild}>{i18n.t('galaxy.rebuild')}</Button>
            </div>
          </div>
        )}

        {!loading && truncated && lodMode === 'points' && (
          <div className="kgg-truncated">
            {i18n.t('galaxy.truncation', { limit: BBOX_POINT_LIMIT, segment: t.segment })}
          </div>
        )}

        {detail && (
          <div className="kgg-detail-drawer">
            <div className="kgc-trace-head">
              <div className="kgc-trace-title">{detail.archive_number || detail.record_id}</div>
              <button className="kgc-trace-back" onClick={() => setDetail(null)}>{i18n.t('galaxy.close')}</button>
            </div>
            <div style={{ fontSize: 12, color: 'var(--kg-text-dim)', lineHeight: 2 }}>
              <div style={{ color: 'var(--kg-text)', lineHeight: 1.7, marginBottom: 4 }}>
                {displayText(detail.title)}…
              </div>
              <div>
                {i18n.t('galaxy.belongs', { cluster: t.cluster })}
                <span style={{ color: clusterColor(detail.cluster_id) }}>
                  {clusterName.get(detail.cluster_id)?.name || `${t.cluster} ${detail.cluster_id}`}
                </span>
              </div>
              {(detail as any).page != null && <div>{i18n.t('galaxy.pageNo', { page: (detail as any).page })}</div>}
              {(detail as any).persons?.length > 0 && (
                <div>{t.primary}：{(detail as any).persons.slice(0, 8).join('、')}</div>
              )}
              {(detail as any).places?.length > 0 && (
                <div>{t.secondary}：{(detail as any).places.slice(0, 6).join('、')}</div>
              )}
              {(detail as any).char_count ? <div>{i18n.t('galaxy.lengthChars', { count: (detail as any).char_count })}</div> : null}
              <div style={{ marginTop: 4 }}>
                {i18n.t('galaxy.keywordLabel')}
                {(clusterName.get(detail.cluster_id)?.keywords || []).slice(0, 6).map((k) => (
                  <Tag key={k} style={{ fontSize: 11, marginInlineEnd: 4 }}>{k}</Tag>
                ))}
                {!clusterName.get(detail.cluster_id)?.keywords?.length && (
                  <span style={{ color: 'var(--kg-text-faint)' }}>—</span>
                )}
              </div>
            </div>
            {/* 星图点 → 原文：打开整回原文，并标出这一段 */}
            {detail.record_id && (
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <Button
                  size="small"
                  type="primary"
                  onClick={() => setEvidence({ recordId: detail.record_id, text: (detail as any).text })}
                >
                  {i18n.t('galaxy.viewSource')}
                </Button>
                {/* 语义找相似：在原始向量空间找同类（2D 距离不可信） */}
                <Button
                  size="small"
                  loading={similarLoading}
                  onClick={() => doSimilar(detail)}
                >
                  {i18n.t('galaxy.findSimilar')}
                </Button>
              </div>
            )}
          </div>
        )}

        {/* 簇锚点详情卡（需求 4）：点击五角星打开，展示主题摘要 + 高频词 */}
        {anchorCluster && (
          <div className="kgg-detail-drawer" data-anchor-card>
            <div className="kgc-trace-head">
              <div className="kgc-trace-title" style={{ color: clusterColor(anchorCluster.cluster_id) }}>
                {anchorCluster.name || `${t.cluster} ${anchorCluster.cluster_id}`}
              </div>
              <button className="kgc-trace-back" onClick={() => setAnchorCluster(null)}>{i18n.t('galaxy.close')}</button>
            </div>
            <div style={{ fontSize: 12, color: 'var(--kg-text-dim)', lineHeight: 2 }}>
              <div>{i18n.t('galaxy.sizeLabel', { count: anchorCluster.size, segments: t.segments })}</div>
              {(anchorCluster.min_year || anchorCluster.max_year) && (
                <div>
                  {i18n.t('galaxy.axisSpan', {
                    axis: gp.unit.axis,
                    range: unitRange(anchorCluster.min_year || anchorCluster.max_year, anchorCluster.max_year || anchorCluster.min_year),
                  })}
                </div>
              )}
              {anchorCluster.summary && (
                <div style={{ marginTop: 6, lineHeight: 1.7 }}>
                  <div style={{ color: 'var(--kg-text-faint)', marginBottom: 2 }}>{i18n.t('galaxy.summary', { cluster: t.cluster })}</div>
                  {anchorCluster.summary}
                </div>
              )}
              {anchorCluster.keywords?.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ color: 'var(--kg-text-faint)', marginBottom: 4 }}>{i18n.t('galaxy.words')}</div>
                  {anchorCluster.keywords.map((k) => (
                    <Tag key={k} style={{ fontSize: 11, marginInlineEnd: 4 }}>{k}</Tag>
                  ))}
                </div>
              )}
            </div>

            {/* 多维看板：章回分布 / 细分方向 / 高频词 / 主要人物 / 主要地点 / 人物数 / 篇幅。
                数据来自 /clusters/<id>/board，与簇卡片分开取——
                卡片要秒开，看板可以稍微等一下。 */}
            {board && (
              <div className="kgg-board">
                <BoardBars
                  title={i18n.t('galaxy.spread', { unit: unitName })}
                  items={board.years.map((y) => ({ label: unitLabel(y.year), count: y.count }))}
                  suffix={` ${t.segment}`}
                />
                {board.subclusters.length > 0 && (
                  <div className="kgg-board-block">
                    <div className="kgg-board-title">
                      {i18n.t('galaxy.subDirection')}
                      <span className="kgg-board-hint">{i18n.t('galaxy.subCount', { count: board.subclusters.length })}</span>
                    </div>
                    {board.subclusters.map((sub) => (
                      <div key={sub.sub_cluster_id} className="kgg-sub-row">
                        <span
                          className="kgg-sub-dot"
                          style={{ background: subClusterColor(anchorCluster.cluster_id, sub.sub_cluster_id) }}
                        />
                        <span className="kgg-sub-name">{sub.name || i18n.t('galaxy.sub', { n: sub.sub_cluster_id + 1 })}</span>
                        <span className="kgg-sub-meta">
                          {sub.size} {t.segment}
                          {sub.year_from ? ` · ${unitRange(sub.year_from, sub.year_to)}` : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                <BoardBars
                  title={i18n.t('galaxy.keywords')}
                  items={(board.cluster.keyword_weights?.length
                    ? board.cluster.keyword_weights.map((kw) => ({
                        label: kw.word, count: Math.round(kw.weight * 1000),
                      }))
                    : board.cluster.keywords.map((word) => ({ label: word, count: 1 })))}
                  hint={i18n.t('galaxy.represent')}
                />
                <BoardBars
                  title={i18n.t('galaxy.mainPrimary', { primary: t.primary })}
                  items={board.units.map((u) => ({ label: u.name, count: u.count }))}
                  suffix={` ${t.segment}`}
                />
                <BoardBars
                  title={i18n.t('galaxy.mainSecondary', { secondary: t.secondary })}
                  items={board.file_types.map((ft) => ({ label: ft.name, count: ft.count }))}
                  suffix={` ${t.segment}`}
                />
                <BoardBars
                  title={i18n.t('galaxy.perSegment', { segment: t.segment, primary: t.primary })}
                  items={board.size_buckets.map((b) => ({ label: b.bucket, count: b.count }))}
                  suffix={` ${t.segment}`}
                />
                <BoardBars
                  title={i18n.t('galaxy.length')}
                  items={board.page_buckets.map((b) => ({ label: b.bucket, count: b.count }))}
                  suffix={` ${t.segment}`}
                />
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              {/* 聚焦该族：与侧栏点击同语义（飞视口 + 硬过滤单簇） */}
              <Button
                size="small"
                type="primary"
                onClick={() => {
                  if (clusters.find((c) => c.cluster_id === anchorCluster.cluster_id)) {
                    selectCluster(anchorCluster)
                    setAnchorCluster(null)
                  }
                }}
              >
                {i18n.t('galaxy.onlyThis', { cluster: t.cluster })}
              </Button>
            </div>
          </div>
        )}

        {/* 语义离群清单：「内容更像别组」与「与同组差异大」两种迹象，点开看原文 */}
        {outlierPanelOpen && (
          <div className="kgg-detail-drawer" data-outlier-card>
            <div className="kgc-trace-head">
              <div className="kgc-trace-title">
                {i18n.t('galaxy.outlierTitle', { count: visibleOutliers.length, segment: t.segment })}
              </div>
              <button className="kgc-trace-back" onClick={() => setOutlierPanelOpen(false)}>
                {i18n.t('galaxy.close')}
              </button>
            </div>
            <div className="kgg-outlier-filter">
              {([
                ['all', i18n.t('common.all')],
                ['misplaced', i18n.t('galaxy.likeOther', { cluster: t.cluster })],
                ['drifted', i18n.t('galaxy.unlike')],
              ] as const).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className={outlierPattern === key ? 'on' : ''}
                  onClick={() => setOutlierPattern(key)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="kgg-outlier-hint">
              {i18n.t('galaxy.outlierHelp', { cluster: t.cluster })}
            </div>
            {visibleOutliers.length === 0 && (
              <div className="kgg-board-empty">{i18n.t('galaxy.noPassages')}</div>
            )}
            {visibleOutliers.map((item) => (
              <div key={item.record_id} className="kgg-outlier-row">
                <div className="kgg-outlier-head">
                  <Tag color={item.misplaced ? 'red' : 'orange'} style={{ fontSize: 11 }}>
                    {item.misplaced ? i18n.t('galaxy.likeOther', { cluster: t.cluster }) : i18n.t('galaxy.unlike')}
                  </Tag>
                  <span className="kgg-outlier-score">{i18n.t('galaxy.score', { score: item.score })}</span>
                </div>
                <div
                  className="kgg-outlier-title"
                  title={item.title}
                  onClick={() => {
                    const hit = points.find((p) => p.record_id === item.record_id)
                    if (hit) {
                      setDetail(hit)
                      zoomToBox(hit.x, hit.y)
                    } else {
                      // 点级数据是按视口加载的，离群片段可能不在当前视口，
                      // 静默无反应会让用户以为点击失效
                      message.info(i18n.t('galaxy.offscreen'))
                    }
                  }}
                >
                  {item.title || item.record_id}
                </div>
                <div className="kgg-outlier-meta">
                  {item.cluster_name || `${t.cluster} ${item.cluster_id}`}
                  {item.nearest_cluster_name ? i18n.t('galaxy.likeNamed', { name: item.nearest_cluster_name }) : ''}
                  {item.archive_number ? ` · ${item.archive_number}` : ''}
                </div>
                <div className="kgg-outlier-actions">
                  <Button
                    size="small"
                    onClick={() => setEvidence({ recordId: item.record_id })}
                  >
                    {i18n.t('galaxy.viewPassage')}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 语义漂移面板：按十回一段播放"情节构成"的变化，
            播放复用既有的章回筛选（区间=该时段），画布同步压暗 */}
        {driftOpen && (
          <div className="kgg-drift-drawer">
            <div className="kgc-trace-head">
              <div className="kgc-trace-title">
                {i18n.t('galaxy.driftTitle', { cluster: t.cluster, count: drift?.periods.length || 0 })}
              </div>
              <button className="kgc-trace-back" onClick={() => {
                setDriftOpen(false)
                setDriftPlaying(false)
                // 关闭面板要还原章回筛选：播放是把"当前时段"映射成章回区间实现的，
                // 不还原的话画布会一直停在被筛选的状态，用户看不出原因
                setYearRange(null)
              }}>
                {i18n.t('galaxy.close')}
              </button>
            </div>
            <div className="kgg-drift-hint">
              {i18n.t('galaxy.driftHelp', { size: gp.period_size, unit: unitName, cluster: t.cluster })}
              {i18n.t('galaxy.driftNote', { axis: gp.unit.axis, segment: t.segment })}
            </div>
            {!drift || drift.periods.length === 0 ? (
              <div className="kgg-board-empty">{i18n.t('galaxy.noDrift')}</div>
            ) : (
              <>
                <div className="kgg-drift-controls">
                  <button type="button" onClick={() => stepDrift(-1)}>◀</button>
                  <button
                    type="button"
                    className="kgg-drift-play"
                    onClick={() => setDriftPlaying((prev) => !prev)}
                  >
                    {driftPlaying ? i18n.t('common.pause') : i18n.t('galaxy.playChange')}
                  </button>
                  <button type="button" onClick={() => stepDrift(1)}>▶</button>
                  <Select
                    size="small"
                    value={driftPeriod}
                    onChange={applyDriftPeriod}
                    style={{ width: 180 }}
                    options={drift.periods.map((p) => ({ value: p, label: displayUnitText(p) }))}
                  />
                </div>
                <input
                  className="kgg-drift-scrub"
                  type="range"
                  min={0}
                  max={Math.max(drift.periods.length - 1, 0)}
                  value={Math.max(drift.periods.indexOf(driftPeriod), 0)}
                  onChange={(event) => applyDriftPeriod(
                    drift.periods[Number(event.target.value)] || driftPeriod,
                  )}
                />
                {driftSnapshot && (
                  <div className="kgg-drift-snapshot">
                    <div className="kgg-board-title">
                      {i18n.t('galaxy.composition', { period: displayUnitText(driftPeriod) })}
                      {driftSnapshot.significant && <Tag color="orange" style={{ marginLeft: 6, fontSize: 11 }}>{i18n.t('galaxy.keyPeriod')}</Tag>}
                    </div>
                    {driftSnapshot.top.map((row) => (
                      <div key={row.clusterId} className="kgg-drift-row">
                        <span
                          className="kgg-drift-dot"
                          style={{ background: clusterColor(row.clusterId) }}
                        />
                        <span className="kgg-drift-name">
                          {clusterName.get(row.clusterId)?.name || `${t.cluster} ${row.clusterId}`}
                        </span>
                        <span className="kgg-drift-count">
                          {row.count} {t.segment} · {(row.share * 100).toFixed(0)}%
                        </span>
                      </div>
                    ))}
                    {driftSnapshot.added.length > 0 && (
                      <div className="kgg-drift-keywords">
                        <span>{i18n.t('galaxy.appeared')}</span>
                        {driftSnapshot.added.map((word) => (
                          <Tag key={word} color="volcano" style={{ fontSize: 11 }}>{word}</Tag>
                        ))}
                      </div>
                    )}
                    {driftSnapshot.gone.length > 0 && (
                      <div className="kgg-drift-keywords">
                        <span>{i18n.t('galaxy.faded')}</span>
                        {driftSnapshot.gone.map((word) => (
                          <Tag key={word} style={{ fontSize: 11 }}>{word}</Tag>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                <div className="kgg-drift-actions">
                  <Button
                    size="small"
                    onClick={() => {
                      downloadGalaxyDriftReport()
                        .then(() => message.success(i18n.t('galaxy.reportOk')))
                        .catch((error: unknown) => message.error(
                          (error as Error)?.message || i18n.t('galaxy.reportFail'),
                        ))
                    }}
                  >
                    {i18n.t('galaxy.exportReport')}
                  </Button>
                </div>
              </>
            )}
          </div>
        )}

        {/* 相似探索结果面板：锚点 + 相似件清单（点条目飞过去看详情） */}
        {similar && (
          <div className="kgg-similar-drawer">            <div className="kgc-trace-head">
              <div className="kgc-trace-title">
                {i18n.t('galaxy.similarTitle', { count: similar.items.length, segment: t.segment })}
              </div>
              <button className="kgc-trace-back" onClick={() => setSimilar(null)}>{i18n.t('galaxy.close')}</button>
            </div>
            <div style={{ fontSize: 11, color: 'var(--kg-text-faint)', marginBottom: 6 }}>
              {i18n.t('galaxy.similarRef', { name: similar.anchor.archive_number || similar.anchor.title })}
            </div>
            <div className="kgg-similar-list">
              {similar.items.map((it) => (
                <div
                  key={it.record_id}
                  className="kgg-similar-item"
                  onClick={() => {
                    setDetail(it)
                    zoomToBox(it.x, it.y)
                  }}
                >
                  <span
                    className="kgg-similar-dot"
                    style={{ background: clusterColor(it.cluster_id) }}
                  />
                  <span className="kgg-similar-name" title={it.title}>{it.title}</span>
                  <span className="kgg-similar-score">
                    {(it.similarity * 100).toFixed(0)}%
                    <span style={{ color: 'var(--kg-text-faint)' }}> · {it.year ? unitLabel(it.year) : '-'}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <EvidenceHighlightDrawer
          recordId={evidence?.recordId || null}
          highlightText={evidence?.text || null}
          onClose={() => setEvidence(null)}
        />

        <HintBar
          hints={[
            i18n.t('galaxy.hintSegment', { segment: t.segment }),
            mobile ? i18n.t('galaxy.hintTouch') : i18n.t('galaxy.hintMouse'),
            lodMode === 'grid' ? i18n.t('galaxy.hintBubble') : i18n.t('galaxy.hintDot'),
            i18n.t('galaxy.hintStar', { cluster: t.cluster }),
            mobile ? i18n.t('galaxy.hintFilter', { cluster: t.cluster }) : i18n.t('galaxy.hintCompare'),
            i18n.t('galaxy.hintMenu', { cluster: t.cluster }),
          ]}
          avoidBottom={timeline.length > 0}
        />

        {timeline.length > 0 && (
          <div className="kgg-timeline">
            <div className="kgg-timeline-head">
              <span className="kgg-timeline-title">
                {i18n.t('galaxy.distribution', { unit: unitName, cluster: t.cluster })}
                {/* 聚焦某组时标题带上组名与颜色，明确面板已联动该组 */}
                {activeCluster !== null && (
                  <span
                    style={{
                      color: clusterColor(activeCluster),
                      fontWeight: 600,
                      marginLeft: 8,
                    }}
                  >
                    · {clusterName.get(activeCluster)?.name || `${t.cluster} ${activeCluster}`}
                  </span>
                )}
              </span>
              {yearRange && (
                <>
                  <span className="kgg-timeline-range">
                    {i18n.t('galaxy.dimOutside', { range: unitRange(yearRange[0], yearRange[1]) })}
                  </span>
                  <button className="kgg-timeline-clear" onClick={() => setYearRange(null)}>
                    {i18n.t('galaxy.clearFilter')}
                  </button>
                </>
              )}
            </div>
            {/* 年代主力语义族（时间→语义联动）：brush 区间后展示该年代的
                主力语义族徽章，点击徽章即聚焦该族——打通"看年代→找主题" */}
            {eraClusters && eraClusters.length > 0 && (
              <div className="kgg-era-badges">
                {eraClusters.map((ec) => {
                  const total = eraClusters.reduce((s, x) => s + x.count, 0)
                  const pct = total ? Math.round((ec.count / total) * 100) : 0
                  // 徽章点击与侧栏同语义：聚焦族 + 飞视口（selectCluster 统一处理）
                  const cluster = clusters.find((c) => c.cluster_id === ec.cluster_id)
                  return (
                    <span
                      key={ec.cluster_id}
                      className={`kgg-era-badge ${activeCluster === ec.cluster_id ? 'kgg-era-badge-active' : ''}`}
                      style={{ borderColor: clusterColor(ec.cluster_id) }}
                      onClick={() => cluster && selectCluster(cluster)}
                    >
                      <span className="kgg-era-badge-dot" style={{ background: clusterColor(ec.cluster_id) }} />
                      {clusterNameMap.get(ec.cluster_id) || `${t.cluster} ${ec.cluster_id}`}
                      <span className="kgg-era-badge-pct">{pct}%</span>
                    </span>
                  )
                })}
              </div>
            )}
            <TimelinePanel
              matrix={timeline}
              topClusters={topClusters}
              selectedRange={yearRange}
              onSelectRange={setYearRange}
              activeCluster={activeCluster}
              clusterNames={clusterNameMap}
            />
          </div>
        )}

        {mobile && (
          <button
            type="button"
            className={`kgg-sheet-toggle ${sheetOpen ? 'on' : ''}`}
            onClick={() => setSheetOpen((v) => !v)}
          >
            {sheetOpen ? i18n.t('galaxy.sheetCollapse') : i18n.t('galaxy.sheetToggle', { cluster: t.cluster, count: clusterList.length })}
            {activeCluster !== null && !sheetOpen ? i18n.t('galaxy.focused') : ''}
          </button>
        )}
        <div className={`kgg-cluster-sidebar ${sheetOpen ? 'is-open' : ''}`}>
            <div className="kgg-cluster-sidebar-head">
              <div className="kgc-sidebar-title" style={{ marginBottom: 0 }}>
              {t.cluster}（{clusterList.length}）
            </div>
            {compareSet.size > 0 && (
              <button
                className="kgg-cluster-clear"
                onClick={() => setCompareSet(new Set())}
                title={i18n.t('galaxy.clearCompare')}
              >
                {i18n.t('galaxy.selectedGroups', { count: compareSet.size })}
              </button>
            )}
          </div>
          {/* 语义族关键词筛选：族名 / 摘要 / 高频词任一命中即保留 */}
          <Input
            size="small"
            allowClear
            className="kgg-cluster-search"
            placeholder={i18n.t('galaxy.filterClusters', { cluster: t.cluster })}
            value={clusterKw}
            onChange={(e) => setClusterKw(e.target.value)}
          />
          <div
            className={`kgg-cluster-item kgg-cluster-item-all ${activeCluster === null && !compareSet.size ? 'kgg-cluster-item-active' : ''}`}
            onClick={() => { setActiveCluster(null); setCompareSet(new Set()) }}
          >
            <span className="kgg-cluster-name">{i18n.t('common.all')}</span>
          </div>
          {loading && (
            <Skeleton active title={false} paragraph={{ rows: 8 }} />
          )}
          {!loading && clusterKw.trim() && !filteredClusterList.length && (
            <div className="kgc-sidebar-empty">{i18n.t('galaxy.noCluster', { q: clusterKw.trim(), cluster: t.cluster })}</div>
          )}
          {filteredClusterList.map((c) => (
            <div
              key={c.cluster_id}
              className={`kgg-cluster-item ${activeCluster === c.cluster_id ? 'kgg-cluster-item-active' : ''} ${compareSet.has(c.cluster_id) ? 'kgg-cluster-item-checked' : ''}`}
            >
              {/* 对比勾选：checkbox 与群名同一行；勾选切对比集并自动聚焦
                  所有已勾选组的联合范围。条目主体点击仍是单选聚焦。 */}
              <div className="kgg-cluster-head">
                <Checkbox
                  checked={compareSet.has(c.cluster_id)}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => toggleCompare(c, e.target.checked)}
                />
                <div
                  className="kgg-cluster-main"
                  onClick={() => selectCluster(c)}
                >
                  <span className="kgg-cluster-name" style={{ color: clusterColor(c.cluster_id) }}>
                    {c.name}
                  </span>
                  <span className="kgg-cluster-size">{c.size} {t.segment}</span>
                </div>
              </div>
              {c.summary && (
                <div className="kgg-cluster-summary" onClick={() => selectCluster(c)}>
                  {c.summary}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
