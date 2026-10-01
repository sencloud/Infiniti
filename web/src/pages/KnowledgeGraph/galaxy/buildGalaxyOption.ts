/**
 * 语义星图 option 构造（颜色取纸墨主题，见 theme/palette.ts）
 *
 * 数据层用普通 scatter 而不是 scatterGL：
 * echarts@6 + echarts-gl@2.1.0 是官方未适配组合，GL 系列的事件层
 * （点击/brush/tooltip）不可靠，表现为"页面无法拖动、点击无反应"。
 * 普通 scatter 完整支持事件与 brush，10 万点再考虑 progressive 优化。
 *
 * 视觉编码：颜色=聚类簇，大小=固定（星图点的语义是"分布"不是"权重"）。
 * 坐标域约定：UMAP 输出按数据整体 min/max 归一化到 [-100, 100]。
 */
import type {
  GalaxyCluster,
  GalaxyClusterLink,
  GalaxyGridCell,
  GalaxyPoint,
  GalaxySubcluster,
} from '../../../api/kg-explore'
import { activeProfile, terms, unitRange } from '@/graph/profile'
import { clusterPalette, palette } from '@/theme/palette'

/** tooltip 里的次要文字色 */
const dim = () => palette().ink3

/**
 * 相似探索期间的"保留集合"（锚点 + 相似件 record_id）。
 *
 * buildGalaxySeries 是纯函数不能带状态，但相似集合由页面在渲染前
 * 算好注入这里——用模块级变量只是避免把函数签名改得更长。
 * 页面每次 setOption 前都会重新赋值，不存在过期问题。
 */
let dimKeepSetRef: Set<string> | null = null

export function setDimKeepSet(ids: string[] | null) {
  dimKeepSetRef = ids ? new Set(ids) : null
}

/**
 * 搜索命中集合（多命中检索联动）。
 *
 * 与 dimKeepSetRef 同构：buildGalaxySeries 是纯函数，命中集合由页面
 * 在渲染前注入。highlightRecordId 保留单值语义（首个命中，飞视口用），
 * 命中集合内的其余点也一并白心高亮，集合外压暗到 0.15。
 */
let searchHitSetRef: Set<string> | null = null

export function setSearchHitSet(ids: string[] | null) {
  searchHitSetRef = ids ? new Set(ids) : null
}

/** 簇色板（循环取色）：纸墨色相，暗色主题自动提亮（theme/palette.ts） */
export function clusterColor(clusterId: number): string {
  const colors = clusterPalette()
  return colors[Math.abs(clusterId) % colors.length]
}

/** 同簇内子簇配色：保持本簇色相，只改明度——既区分了子群，又看得出同属一族 */
export function subClusterColor(clusterId: number, subClusterId: number): string {
  const base = clusterColor(clusterId)
  const steps = [0.08, -0.12, 0.22, -0.24, 0.34]
  return shadeHex(base, steps[subClusterId % steps.length])
}

/** hex 颜色按比例提亮/压暗（正数为提亮，负数为压暗） */
function shadeHex(hex: string, amount: number): string {
  const value = hex.replace('#', '')
  const num = parseInt(value, 16)
  const channels = [(num >> 16) & 255, (num >> 8) & 255, num & 255]
  const shifted = channels.map((channel) => {
    const target = amount >= 0 ? 255 : 0
    const next = channel + (target - channel) * Math.abs(amount)
    return Math.max(0, Math.min(255, Math.round(next)))
  })
  return `#${shifted.map((c) => c.toString(16).padStart(2, '0')).join('')}`
}

export function buildGalaxySeries(
  points: GalaxyPoint[],
  highlightCluster: number | null,
  /** 搜索命中集合（多命中检索联动）：非空时命中点高亮、其余点压暗 */
  highlightRecordId: string | null,
  yearRange: [number, number] | null = null,
  /** 语义找相似激活时：非相似点整体压暗，让"锚点→相似件"的连线成为视觉主角 */
  dimOthers = false,
  /** 多簇对比选中集：非空时未选中簇压暗保留（不硬过滤），保留全局语境才能看出簇间距 */
  activeClusters: Set<number> | null = null,
  /** 节点大小映射维度：persons=出场人物数 / chars=篇幅 / none=固定大小 */
  sizeField: 'none' | 'persons' | 'chars' = 'none',
  /** 簇内子簇（仅当前聚焦簇有值时生效）：按子簇改色，同一色系不同明度 */
  subClusters: GalaxySubcluster[] | null = null,
  /** 离群点标记：命中的点改成空心红圈（不改变原簇色，避免误读成"换了簇"） */
  showOutliers = false,
) {
  // 簇隔离（点击侧栏语义簇）是硬过滤：其他簇的点直接不进数据数组。
  // 此前只是压暗到 0.15 透明度，星点密集处仍清晰可点可看，
  // 用户感知就是"点了没反应"。ECharts 数据项也不支持 visible 开关，
  // 正确做法就是从源头过滤。
  // 例外：搜索命中的点始终保留——搜索定位与簇过滤是两个独立操作，
  // 飞过去的点被簇过滤吃掉会让用户以为搜不到。
  const filtered = highlightCluster === null
    ? points
    : points.filter((p) => p.cluster_id === highlightCluster
      || (highlightRecordId !== null && p.record_id === highlightRecordId))

  // 子簇配色表：仅当"当前聚焦簇"确实分过子群时启用
  const subColorOf = new Map<number, string>()
  if (highlightCluster !== null && subClusters && subClusters.length > 0) {
    subClusters.forEach((sub) => {
      subColorOf.set(sub.sub_cluster_id, subClusterColor(highlightCluster, sub.sub_cluster_id))
    })
  }

  // 相似探索期间，相似集合外的点也在"保留上下文"之列（锚点的簇、
  // 相似件可能散落多个簇），因此只做视觉压暗，不做硬过滤。
  const keepSet = dimKeepSetRef
  const pal = palette()
  const sizeValueOf = (p: GalaxyPoint): number => {
    if (sizeField === 'persons') return (p as any).person_count || 0
    if (sizeField === 'chars') return (p as any).char_count || 0
    return 0
  }
  // 大小映射的归一化基准（开方映射，面积正比数值，避免大值点糊住画布）
  const sizeMax = Math.max(...points.map(sizeValueOf), 1)
  const symbolSizeOf = (p: GalaxyPoint): number => {
    if (sizeField === 'none') return 7
    const v = sizeValueOf(p)
    // 无值点给最小尺寸 4，有值点按 5 + 13*sqrt(v/max) 映射到 [5, 18]
    return v > 0 ? 5 + 13 * Math.sqrt(v / sizeMax) : 4
  }
  const data = filtered.map((p) => {
    // 搜索命中不压暗其余点——搜索的目的是在全局分布里定位一个点，
    // 把上下文全隐掉反而看不出它在哪。命中簇过滤时该点本就属于保留簇。
    // 多命中模式：命中集合内的点都算 hit，全亮白心；集合外压暗。
    const isHit = highlightRecordId !== null
      ? searchHitSetRef ? searchHitSetRef.has(p.record_id)
        || p.record_id === highlightRecordId
        : p.record_id === highlightRecordId
      : false
    // 多簇对比：未选中簇压暗保留（用户确认的方案）。压暗不是隐藏——
    // 看簇间散点是否交叠正是对比视图的核心语义，隐藏就看不出来了。
    const outOfCompare = activeClusters !== null && activeClusters.size > 0
      && !activeClusters.has(p.cluster_id)
    // 搜索联动压暗：多命中模式下非命中点退到背景（用户需求 3：
    // 检索后星图高亮匹配节点，其余档案灰度淡化）
    const outOfSearch = highlightRecordId !== null && !isHit
    // 时间面板筛选：区间外压暗（软性视觉压暗，保留上下文）。年度未知（0）
    // 的点视为区间外。isHit 不受年度筛选影响——搜索飞过去的点必须始终可见。
    const outOfYear = yearRange !== null && !isHit
      && (p.year === 0 || p.year < yearRange[0] || p.year > yearRange[1])
    // 相似探索压暗：不在保留集合（锚点+相似件）里的点全部退到背景
    const dimBySimilar = dimOthers && keepSet && !keepSet.has(p.record_id)
    // 压暗叠加取最暗：多种软筛选（对比/年度/相似/搜索）同时激活时，
    // 一条命中所有压暗条件的点应该是背景层，而不是层层叠加变怪。
    const baseOpacity = dimBySimilar || outOfCompare || outOfYear || outOfSearch
      ? (dimBySimilar ? 0.1 : 0.15)
      : 0.85
    const subColor = subColorOf.get(Number(p.sub_cluster_id ?? -1))
    const isOutlier = showOutliers && Number(p.outlier_flag ?? 0) === 1
    return {
      name: p.title,
      value: [p.x, p.y],
      // 冗余存一份 title：点击回调 setDetail(params.data) 直接把数据项
      // 存为详情对象，详情卡读 detail.title。此前只放 ECharts 的 name，
      // 详情卡永远拿到 undefined → 全部显示"未命名档案"。
      title: p.title,
      record_id: p.record_id,
      cluster_id: p.cluster_id,
      year: p.year,
      category_code: p.category_code,
      archive_number: p.archive_number,
      // 片段扩展字段：tooltip、详情卡与大小映射都要用
      persons: (p as any).persons,
      places: (p as any).places,
      person_count: (p as any).person_count,
      char_count: (p as any).char_count,
      // 大小映射激活时按维度计算；命中点强制 18 保持"放大镜"语义
      sub_cluster_id: p.sub_cluster_id ?? -1,
      outlier_score: p.outlier_score ?? 0,
      symbolSize: isHit ? 18 : (isOutlier ? Math.max(symbolSizeOf(p), 12) : symbolSizeOf(p)),
      itemStyle: {
        color: isHit ? pal.hit : (isOutlier ? pal.halo : (subColor || clusterColor(p.cluster_id))),
        opacity: baseOpacity,
        borderColor: isHit
          ? clusterColor(p.cluster_id)
          : (isOutlier ? pal.danger : (subColor ? pal.panel : undefined)),
        borderWidth: isHit ? 3 : (isOutlier ? 2 : (subColor ? 1 : 0)),
      },
    }
  })
  return {
    type: 'scatter' as const,
    name: '原文片段',
    data,
    symbolSize: 7,
    // progressive 渲染：点数大时分帧绘制避免卡顿
    progressive: 2000,
    progressiveThreshold: 5000,
    itemStyle: { opacity: 0.85 },
    emphasis: { itemStyle: { opacity: 1 } },
  }
}

/**
 * 语义找相似的连线层（锚点 → 每个相似件一条线）。
 *
 * lines 系列自带坐标数据（coords），不依赖主点系列是否已加载该点——
 * 大库 LOD 下相似件可能在当前视口外，连线仍能画出（先飞过去再看）。
 * 锚点在头、相似件在尾，尾部放大头放小，形成"辐射"的方向感。
 * 相似件/锚点数据项带完整著录字段：点击直接开详情卡（与主点系列同交互）。
 */
export function buildSimilarSeries(
  anchor: { x: number; y: number; cluster_id: number; record_id: string; title: string; year?: number; category_code?: string; archive_number?: string | null },
  items: Array<GalaxySimilarPoint>,
) {
  return [
    {
      type: 'lines' as const,
      name: '相似段落连线',
      coordinateSystem: 'cartesian2d',
      z: 5,
      silent: true,
      lineStyle: {
        color: palette().accentLine,
        width: 1.2,
        curveness: 0.15,
      },
      data: items.map((it) => ({
        coords: [
          [anchor.x, anchor.y],
          [it.x, it.y],
        ],
      })),
    },
    {
      // 相似件层：簇色实心点 + 白描边，与背景压暗点形成对比。
      // 独立于主点系列画（坐标自带），视口外的相似件也有自己的点。
      type: 'scatter' as const,
      name: '相似段落',
      z: 6,
      symbolSize: 9,
      data: items.map((it) => ({
        name: it.title,
        value: [it.x, it.y],
        // 带齐详情卡所需字段（点击回调直接把数据项存为 detail）
        title: it.title,
        record_id: it.record_id,
        cluster_id: it.cluster_id,
        year: it.year,
        category_code: it.category_code,
        archive_number: it.archive_number,
        itemStyle: {
          color: clusterColor(it.cluster_id),
          borderColor: palette().panel,
          borderWidth: 1.5,
          opacity: 0.95,
        },
      })),
    },
    {
      // 锚点层：放大的白心簇边点，与搜索命中的样式同语言
      type: 'scatter' as const,
      name: '参照段落',
      z: 7,
      symbolSize: 18,
      data: [{
        name: anchor.title,
        value: [anchor.x, anchor.y],
        title: anchor.title,
        record_id: anchor.record_id,
        cluster_id: anchor.cluster_id,
        year: anchor.year ?? 0,
        category_code: anchor.category_code ?? '',
        archive_number: anchor.archive_number,
        itemStyle: {
          color: palette().hit,
          borderColor: clusterColor(anchor.cluster_id),
          borderWidth: 3,
        },
      }],
    },
  ]
}

/** 相似件点的最小字段（连线层只需要坐标，点层要详情字段） */
export interface GalaxySimilarPoint {
  record_id: string
  title: string
  x: number
  y: number
  cluster_id: number
  year: number
  category_code: string
  archive_number?: string | null
}

/** 画布坐标域半幅，必须与后端 galaxy_service.CANVAS_HALF_SPAN 一致 */
export const CANVAS_HALF_SPAN = 100

/**
 * 坐标轴半幅：比数据域（±100）外扩 20%。
 *
 * 平移死区的根因修复：dataZoom 的百分比区间被钳制在 [0,100]。
 * 轴域=数据域时，全图视口没有任何平移余量——用户一拖，
 * 区间被立即钳回原位，画面纹丝不动，表现为"无法拖动、页面僵死"。
 * 轴域外扩后全图视口两侧天然留出空带，落地即可拖动。
 */
export const AXIS_HALF_SPAN = CANVAS_HALF_SPAN * 1.2

/**
 * 网格聚合气泡（低缩放层级）
 *
 * 10 万档案不可能一次全画，低缩放时改画每格的聚合气泡：
 * 大小=该格档案数，颜色=该格主导语义簇。
 *
 * activeCluster 非空时只画主导簇匹配的格子：气泡模式此前完全无视
 * 簇过滤，点侧栏语义族毫无反应。格子按"主导簇"归属是网格聚合下的
 * 最接近语义——一格内可能混簇，但主导簇代表该格的大多数档案。
 */
export function buildGridSeries(
  cells: GalaxyGridCell[],
  activeCluster: number | null = null,
  /** 多簇对比选中集：非空时未选中簇的格子压暗保留（与点模式行为一致） */
  activeClusters: Set<number> | null = null,
) {
  const shown = activeCluster === null
    ? cells
    : cells.filter((c) => c.dominant_cluster === activeCluster)
  const maxCount = Math.max(...shown.map((c) => c.count), 1)
  return {
    type: 'scatter' as const,
    name: '片段密度',
    data: shown.map((c) => ({
      name: c.grid_key,
      value: [Number(c.x), Number(c.y)],
      count: c.count,
      dominant_cluster: c.dominant_cluster,
      avg_year: c.avg_year,
      min_year: c.min_year,
      max_year: c.max_year,
      // 面积随档案数走（开方后线性），直径线性会让大格夸张到糊住画布
      symbolSize: 14 + 46 * Math.sqrt(c.count / maxCount),
      itemStyle: {
        color: clusterColor(c.dominant_cluster ?? 0),
        // 多簇对比：未选中簇的气泡压暗到 0.15，保留全局语境
        opacity: activeClusters !== null && activeClusters.size > 0
          && c.dominant_cluster !== null
          && !activeClusters.has(c.dominant_cluster) ? 0.15 : 0.5,
        borderColor: palette().halo,
        borderWidth: 1,
      },
    })),
    labelLayout: { hideOverlap: true },
    label: {
      show: true,
      formatter: (p: any) => String(p.data.count),
      color: palette().ink,
      fontSize: 10,
    },
  }
}

/** 基础 option（坐标轴隐藏，纯画布感） */
export function galaxyBaseOption() {
  return {
    grid: { left: 0, right: 0, top: 0, bottom: 0 },
    xAxis: {
      type: 'value' as const,
      min: -AXIS_HALF_SPAN,
      max: AXIS_HALF_SPAN,
      show: false,
    },
    yAxis: {
      type: 'value' as const,
      min: -AXIS_HALF_SPAN,
      max: AXIS_HALF_SPAN,
      show: false,
    },
    // 缩放是 LOD 的前提：没有 dataZoom 用户无法放大，
    // "低缩放看气泡 / 高缩放看点"的分层导航也就无从触发。
    // filterMode: 'none' —— 取数由页面按视口自己控制，不交给 ECharts 过滤。
    // 交互：滚轮=双轴等比缩放，按住拖拽=平移（moveOnMouseMove 默认行为）。
    // 此前用 scatterGL 时 GL 图层不响应这套 cartesian 交互，表现为整页僵死，
    // 换回普通 scatter 后滚轮/拖拽/点击/框选全部恢复。
    dataZoom: [
      { type: 'inside' as const, xAxisIndex: 0, filterMode: 'none' as const, zoomOnMouseWheel: true, moveOnMouseWheel: false, moveOnMouseMove: true },
      { type: 'inside' as const, yAxisIndex: 0, filterMode: 'none' as const, zoomOnMouseWheel: true, moveOnMouseWheel: false, moveOnMouseMove: true },
    ],
    tooltip: {
      trigger: 'item' as const,
      backgroundColor: palette().panel,
      borderColor: palette().rule,
      textStyle: { color: palette().ink, fontSize: 12 },
      formatter: (params: any) => {
        const d = params.data
        if (!d) return ''
        const t = terms()
        // 网格气泡：显示聚合信息
        if (d.count != null) {
          const span = d.min_year && d.max_year
            ? unitRange(Math.round(d.min_year), Math.round(d.max_year))
            : d.avg_year || '-'
          return [
            `<div style="font-weight:600">${d.count} ${t.segments}</div>`,
            `<div style="color:${dim()}">${activeProfile().unit.axis}：${span}</div>`,
            `<div style="color:${dim()}">放大查看单${t.segment}</div>`,
          ].join('')
        }
        if (!d.record_id) return ''
        const rows: string[] = [
          `<div style="color:${dim()}">${d.archive_number || '—'}</div>`,
        ]
        if (d.persons?.length) {
          rows.push(`<div style="color:${dim()}">${t.primary}：${d.persons.slice(0, 6).join('、')}</div>`)
        }
        if (d.places?.length) {
          rows.push(`<div style="color:${dim()}">${t.secondary}：${d.places.slice(0, 4).join('、')}</div>`)
        }
        return [
          `<div style="max-width:280px;white-space:normal;font-weight:600">${d.name || ''}…</div>`,
          ...rows,
        ].join('')
      },
    },
    // 不再提供画布框选：加入专题库 / 导出改为侧栏勾选语义族，
    // 整族成员由后端按 cluster_id 取，不依赖视口内加载了哪些点。
    toolbox: { show: false },
  }
}

/**
 * 画布内簇标签系列（本次精修的核心视觉增量）
 *
 * Aella 有 ClusterLegend、Marble 直接在图上标学科，我们的画布此前是
 * 一片无名色点。用 symbolSize:0 + label.show 的散点系列画文字。
 *
 * 按缩放分级显示：视口跨度大时只显示 size 最大的 N 个簇名，
 * 放大后逐步显示更多——不然 30 个标签在小视图里互相叠成一团。
 */
export function buildClusterLabelSeries(
  clusters: GalaxyCluster[],
  viewportSpanRatio: number,
  activeCluster: number | null,
  /** 多簇对比选中集：非空时只显示选中簇的标签（与锚点过滤一致） */
  activeClusters: Set<number> | null = null,
) {
  // 缩得越细显示越多：全图 8 个 → 半图 16 → 局部全部
  const maxLabels = viewportSpanRatio > 0.8 ? 8
    : viewportSpanRatio > 0.4 ? 16
    : clusters.length
  // 簇过滤激活时只显示该簇标签：标签是簇的"名字牌"，
  // 全部显示会削弱"已聚焦某一族"的感知。
  // 多选模式同理：只显示选中集的标签。
  const candidates = activeCluster !== null
    ? clusters.filter((c) => c.cluster_id === activeCluster)
    : activeClusters !== null && activeClusters.size > 0
      ? clusters.filter((c) => activeClusters.has(c.cluster_id))
      : clusters
  const ranked = [...candidates]
    .filter((c) => c.centroid_x != null && c.centroid_y != null && c.size > 0)
    .sort((a, b) => b.size - a.size)
  const shown = new Set(ranked.slice(0, maxLabels).map((c) => c.cluster_id))

  return {
    type: 'scatter' as const,
    name: '聚类标签',
    silent: true, // 不挡点击：透过标签仍然能点到下面的档案点
    symbolSize: 0.1,
    data: ranked.map((c) => ({
      value: [Number(c.centroid_x), Number(c.centroid_y)],
      cluster_id: c.cluster_id,
      label: {
        show: shown.has(c.cluster_id),
        formatter: c.name,
        color: activeCluster === c.cluster_id ? palette().ink : clusterColor(c.cluster_id),
        fontSize: 12,
        fontWeight: 600,
        fontFamily: 'Georgia, "Songti SC", "STSong", "SimSun", serif',
        // 描边让标签在任何底色上都可读
        textBorderColor: palette().halo,
        textBorderWidth: 3,
      },
    })),
    labelLayout: { hideOverlap: true },
    z: 10, // 盖在档案点之上
  }
}

/** 簇列表侧栏的展示模型 */
export function clusterListModel(clusters: GalaxyCluster[]) {
  return clusters
    .filter((c) => c.size > 0)
    .sort((a, b) => b.size - a.size)
}

/**
 * 簇中心锚点系列（五角星标记语义向量均值）
 *
 * 坐标就是 clusters 接口实时聚合的质心（centroid_x/y），
 * 代表该簇的核心语义位置。symbolSize 按簇规模微分（16-26），
 * 大簇的星更大。数据项自带 cluster_id，点击回调据此弹簇详情卡
 * （主题摘要 + 高频词，数据都在 GalaxyCluster 上）。
 */
export function buildClusterAnchorSeries(
  clusters: GalaxyCluster[],
  /** 多选聚焦集合：非空时只画选中簇的锚点，与主画布过滤保持一致 */
  activeClusters: Set<number> | null = null,
) {
  const shown = activeClusters === null || activeClusters.size === 0
    ? clusters
    : clusters.filter((c) => activeClusters.has(c.cluster_id))
  const maxSize = Math.max(...shown.map((c) => c.size), 1)
  return {
    type: 'scatter' as const,
    name: '聚类标记',
    // 五角星 path：ECharts 内置 symbol 没有星形，用 SVG path 画。
    // 视口 24x24，中心 (12,12)：外接半径 10 的五角星顶点按
    // 角度 90+72k 生成，内点半径约为外点的 0.4 倍（视觉匀称）。
    symbol: 'path://M12 2 L14.4 8.2 L21 8.7 L16 13 L17.5 19.5 L12 16 L6.5 19.5 L8 13 L3 8.7 L9.6 8.2 Z',
    symbolSize: (val: number, params: any) =>
      14 + 12 * Math.sqrt((params.data?.cluster_size ?? 1) / maxSize),
    z: 8, // 盖在档案点之上、簇标签之下
    data: shown
      .filter((c) => c.centroid_x != null && c.centroid_y != null && c.size > 0)
      .map((c) => ({
        value: [Number(c.centroid_x), Number(c.centroid_y)],
        cluster_id: c.cluster_id,
        cluster_size: c.size,
        // 携带簇信息：点击锚点直接开簇详情卡
        cluster: c,
        symbolKeepAspect: true,
        itemStyle: {
          color: clusterColor(c.cluster_id),
          // 底色描边让五角星在任何密度底色上清晰
          borderColor: palette().panel,
          borderWidth: 1.5,
          opacity: 0.95,
        },
      })),
    tooltip: {
      // 锚点有自己的 tooltip（簇名 + 件数），不与档案点共用 formatter
      formatter: (p: any) => {
        const c = p.data?.cluster as GalaxyCluster | undefined
        if (!c) return ''
        return [
          `<div style="font-weight:600;color:${clusterColor(c.cluster_id)}">${c.name}</div>`,
          `<div style="color:${dim()}">${c.size} ${terms().segment} · 点击查看${terms().cluster}摘要</div>`,
        ].join('')
      },
    },
  }
}

/**
 * 簇间关联连线（语义关联图谱）
 *
 * 相似度来自 **PCA-64 高维空间**（质心余弦 / 成员平均链接），不是画布距离——
 * UMAP 是非线性投影、不保距，用画布距离连线会连出"看着近其实无关"的假关联。
 * 阈值过滤放在前端：拖动滑条只重算这一层 series，不打请求。
 */
export function buildClusterLinkSeries(
  links: GalaxyClusterLink[],
  threshold: number,
  /** centroid=质心余弦 / avg=成员平均链接；两种口径回答的问题不同 */
  caliber: 'centroid' | 'avg' = 'centroid',
  /** 仅显示与这些簇相关的连线（聚焦/对比时用），null 表示全部 */
  scopeClusters: Set<number> | null = null,
) {
  const valueOf = (link: GalaxyClusterLink): number => (
    caliber === 'avg' ? link.avg_link_similarity : link.centroid_cosine
  )
  const shown = links.filter((link) => {
    if (valueOf(link) < threshold) return false
    if (scopeClusters && scopeClusters.size > 0) {
      return scopeClusters.has(link.src_cluster) || scopeClusters.has(link.dst_cluster)
    }
    return true
  })
  // 线宽按阈值区间的相对强弱映射，拖高阈值时留下的强线不会全挤成同一档
  const maxScore = Math.max(...shown.map(valueOf), threshold + 0.01)
  return {
    type: 'lines' as const,
    name: '聚类关联',
    coordinateSystem: 'cartesian2d' as const,
    silent: false,
    z: 3, // 盖在底图之上、档案点之下
    data: shown.map((link) => {
      const score = valueOf(link)
      const ratio = Math.max(0, Math.min(1, (score - threshold) / (maxScore - threshold + 1e-6)))
      return {
        coords: [
          [Number(link.src_x ?? 0), Number(link.src_y ?? 0)],
          [Number(link.dst_x ?? 0), Number(link.dst_y ?? 0)],
        ],
        link,
        lineStyle: {
          color: clusterColor(link.src_cluster),
          width: 0.8 + ratio * 4.2,
          opacity: 0.28 + ratio * 0.45,
          curveness: 0.12,
        },
      }
    }),
    // 关联线不画端点符号（端点由簇锚点承担），但要能悬停看解释
    tooltip: {
      formatter: (params: unknown) => {
        const link = (params as { data?: { link?: GalaxyClusterLink } })?.data?.link
        if (!link) return ''
        const score = valueOf(link)
        const shared = (link.shared_keywords || []).slice(0, 5).join('、')
        // 两个算法名不上屏：说清"这个数越大越像"就够，算法口径在高级选项里
        const scoreLabel = caliber === 'avg' ? '成员两两相近度' : `${terms().cluster}整体相近度`
        return [
          `<div style="font-weight:600">${link.src_name} × ${link.dst_name}</div>`,
          `<div style="color:${dim()}">${scoreLabel} ${score.toFixed(2)}（越高越像）</div>`,
          shared ? `<div style="color:${dim()}">共同关键词：${shared}</div>` : '',
        ].join('')
      },
    },
  }
}

/**
 * 子簇标签层：在当前聚焦簇的子簇质心处标名
 *
 * 子簇的存在感靠"画布上有名字"建立——只改颜色不标名，用户看不出
 * "这里被分成了三块"，只会以为颜色是随机的。
 */
export function buildSubclusterLabelSeries(
  subClusters: GalaxySubcluster[] | null,
  clusterId: number | null,
) {
  const shown = clusterId === null || !subClusters ? [] : subClusters
  return {
    type: 'scatter' as const,
    name: '细分方向',
    symbolSize: 0.1,
    z: 9,
    data: shown.map((sub) => ({
      value: [Number(sub.centroid_x), Number(sub.centroid_y)],
      sub_cluster_id: sub.sub_cluster_id,
      label: {
        show: true,
        formatter: `${sub.name || '细分'} · ${sub.size}`,
        color: subClusterColor(clusterId as number, sub.sub_cluster_id),
        fontSize: 11,
        fontWeight: 600,
        textBorderColor: palette().halo,
        textBorderWidth: 3,
      },
    })),
    labelLayout: { hideOverlap: true },
    tooltip: {
      formatter: (params: unknown) => {
        const subId = (params as { data?: { sub_cluster_id?: number } })?.data?.sub_cluster_id
        const sub = shown.find((s) => s.sub_cluster_id === subId)
        if (!sub) return ''
        const years = (sub.years || [])
          .map((y) => `${y.year}(${y.count})`)
          .join(' ')
        return [
          `<div style="font-weight:600">${sub.name}</div>`,
          `<div style="color:${dim()}">${sub.size} ${terms().segment} · ${unitRange(sub.year_from, sub.year_to)}</div>`,
          years ? `<div style="color:${dim()}">${years}</div>` : '',
        ].join('')
      },
    },
  }
}
