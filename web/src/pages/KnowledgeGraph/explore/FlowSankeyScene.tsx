/**
 * 流转视图（关系探索页的「流转」模式）
 *
 * 桑基图回答的是"量从哪里流到哪里"，所以这里只放三列：
 * **来源实体 → 关系 → 目标实体**，带子粗细 = 事实条数。
 *
 * 两个刻意的取舍：
 *   1. 不做"时间 × 类型"的桑基。时间已经由时序视图的横轴表达，
 *      压成分类列只会把"哪条关系连着哪两个实体"丢掉（见 flowAggregate.ts 文件头）。
 *   2. 三列的 depth 显式给定。同一个实体既可能出现在左列（作为来源）
 *      也可能出现在右列（作为去向），靠拓扑自动分层会让 echarts 在遇到环时直接抛错。
 *
 * 数据全部来自画布上已有的节点与边（图例过滤已生效），零额外请求。
 */
import { useCallback, useEffect, useMemo, useRef } from 'react'
import * as echarts from 'echarts'
import { CloseOutlined } from '@ant-design/icons'

import { nodeColor, relationLabel } from '@/utils/graphStyle'
import { palette } from '@/theme/palette'
import { useTheme } from '@/theme/ThemeProvider'
import { predicateColor } from './graph3dConfig'
import type { FlowAggregate, FlowSelection } from './flowAggregate'
import i18n from '@/i18n'

interface Props {
  flow: FlowAggregate
  selection: FlowSelection | null
  /** 右侧面板占用的宽度：桑基图要让开，避免主带子被面板压住 */
  rightInset?: number
  onPick?: (selection: FlowSelection | null) => void
}

const NODE_WIDTH = 14
/**
 * 顶部留出模式条与列标题，底部留出提示条与图例；
 * 左右留出实体名的位置——标签放在节点外侧，名称长了才不会压住带子。
 */
const GRID = { left: 172, right: 172, top: 150, bottom: 84 }
/** 实体名标签的最大宽度（超出截断，全名进提示框） */
const LABEL_WIDTH = 150
/** 未选中任何流向时的带子透明度：够看清主通道，又不至于糊成一片 */
const LINK_OPACITY = 0.42
const LINK_DIM_OPACITY = 0.08
const NODE_DIM_OPACITY = 0.28

const chartAlive = (chart: echarts.ECharts | null): chart is echarts.ECharts => (
  !!chart && !chart.isDisposed()
)

const escapeHtml = (value: unknown) => String(value ?? '').replace(
  /[&<>"']/g,
  (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] || char,
)

const kindHint = (kind: 'src' | 'rel' | 'dst') => i18n.t(`flow.${kind}`)

/** 桑基图原始数据项（echarts 的 params.data 就是它，带上下钻需要的信息） */
interface SankeyNodeItem {
  name: string
  kind: 'src' | 'rel' | 'dst'
  /** 实体类型或谓词原值（点选回传用） */
  key: string
  display: string
  fullName: string
  value: number
}

interface SankeyLinkItem {
  source: string
  target: string
  value: number
  groupKey: string
}

/** echarts 点击回调的载荷：节点项与边项共用一套读取方式 */
type SankeyEventData = SankeyNodeItem & Partial<SankeyLinkItem>

export default function FlowSankeyScene({
  flow, selection, rightInset = 0, onPick,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<echarts.ECharts | null>(null)
  const pickRef = useRef(onPick)
  const groupRef = useRef(flow)
  const { theme } = useTheme()

  useEffect(() => { pickRef.current = onPick }, [onPick])
  useEffect(() => { groupRef.current = flow }, [flow])

  /**
   * 选中态：把选中的流向/关系/类型之外的元素压暗。
   * 三种选中语义都归一到"哪些带子是亮的"，节点则用这些带子的两端。
   */
  const active = useMemo(() => {
    const linkOn = (link: SankeyLinkItem) => {
      if (!selection) return true
      if (selection.kind === 'group') return link.groupKey === selection.key
      if (selection.kind === 'predicate') {
        return link.target === `rel::${selection.key}` || link.source === `rel::${selection.key}`
      }
      const nodeKey = selection.kind === 'src' ? `src::${selection.key}` : `dst::${selection.key}`
      return link.source === nodeKey || link.target === nodeKey
    }
    const links = flow.links.map(linkOn)
    const nodes = new Set<string>()
    flow.links.forEach((link, index) => {
      if (!links[index]) return
      nodes.add(link.source)
      nodes.add(link.target)
    })
    return { links, nodes }
  }, [flow.links, selection])

  /* ---------- 图表引擎：只在挂载时初始化，数据变化走 setOption ---------- */

  useEffect(() => {
    if (!hostRef.current) return
    chartRef.current = echarts.init(hostRef.current)
    const onResize = () => {
      if (chartAlive(chartRef.current)) chartRef.current.resize()
    }
    window.addEventListener('resize', onResize)
    const observer = new ResizeObserver(onResize)
    observer.observe(hostRef.current)
    chartRef.current.on('click', (params) => {
      // echarts 的 ECElementEvent 与业务数据项没有公共字段，这里只能显式转一次
      const payload = params as unknown as { dataType?: string; data?: SankeyEventData }
      const data = payload?.data
      if (!data) return
      if (payload.dataType === 'edge') {
        if (data.groupKey) pickRef.current?.({ kind: 'group', key: data.groupKey })
        return
      }
      if (data.kind === 'rel') pickRef.current?.({ kind: 'predicate', key: data.key })
      else if (data.kind === 'src') pickRef.current?.({ kind: 'src', key: data.key })
      else if (data.kind === 'dst') pickRef.current?.({ kind: 'dst', key: data.key })
    })
    return () => {
      window.removeEventListener('resize', onResize)
      observer.disconnect()
      if (chartAlive(chartRef.current)) chartRef.current.dispose()
      chartRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!chartAlive(chartRef.current)) return
    const selected = Boolean(selection)

    const option = {
      animation: false,
      tooltip: {
        trigger: 'item',
        confine: true,
        formatter: (params: { dataType?: string; data?: SankeyEventData }) => {
          const data = params?.data
          if (!data) return ''
          if (params.dataType === 'edge') {
            const group = groupRef.current.groups.find((item) => item.key === data.groupKey)
            if (!group) return ''
            return `${escapeHtml(group.srcName)} —${escapeHtml(relationLabel(group.predicate))}→ `
              + `${escapeHtml(group.dstName)}<br/>${escapeHtml(i18n.t('flow.facts', { count: group.value }))}`
          }
          return `${escapeHtml(data.fullName)}<br/>${escapeHtml(kindHint(data.kind))} · ${escapeHtml(i18n.t('flow.facts', { count: data.value }))}`
        },
      },
      series: [{
        type: 'sankey',
        left: GRID.left,
        right: GRID.right + rightInset,
        top: GRID.top,
        bottom: GRID.bottom,
        nodeWidth: NODE_WIDTH,
        nodeGap: 8,
        // 分层已由 depth 固定，迭代只用于同一列内的排序，减少带子交叉
        layoutIterations: 24,
        draggable: false,
        emphasis: { focus: 'adjacency' },
        // 白描边让标签压在带子上也读得清（浅底画布上比阴影更干净）
        label: {
          color: palette(theme).ink,
          fontSize: 12,
          textBorderColor: palette(theme).halo,
          textBorderWidth: 2,
        },
        lineStyle: { curveness: 0.5 },
        data: flow.nodes.map((node) => ({
          name: node.name,
          depth: node.kind === 'src' ? 0 : node.kind === 'rel' ? 1 : 2,
          kind: node.kind,
          key: node.key,
          display: node.display,
          fullName: node.fullName,
          value: node.value,
          itemStyle: {
            color: node.kind === 'rel' ? predicateColor(node.tone) : nodeColor(node.tone).main,
            opacity: selected && !active.nodes.has(node.name) ? NODE_DIM_OPACITY : 1,
            borderColor: palette(theme).panel,
            borderWidth: 1,
          },
          // 展示名与唯一键分离：同一个实体在左右两列各有一个节点（见文件头取舍 2）
          label: {
            formatter: node.display,
            // 两侧实体名的标签放节点外侧；中间的关系名没有外侧可放，靠白描边压带子
            position: node.kind === 'src' ? 'left' : 'right',
            width: node.kind === 'rel' ? 96 : LABEL_WIDTH,
            overflow: 'truncate',
          },
        })),
        links: flow.links.map((link, index) => ({
          source: link.source,
          target: link.target,
          value: link.value,
          groupKey: link.groupKey,
          lineStyle: {
            color: 'gradient',
            opacity: selected
              ? (active.links[index] ? LINK_OPACITY + 0.2 : LINK_DIM_OPACITY)
              : LINK_OPACITY,
          },
        })),
      }],
    }
    chartRef.current.setOption(option as echarts.EChartsOption, { notMerge: true })
  }, [flow, selection, active, rightInset, theme])

  const reset = useCallback(() => pickRef.current?.(null), [])
  const empty = flow.empty

  return (
    <div className="flow-sankey-host">
      <div
        className="flow-sankey-captions"
        style={{ left: GRID.left, right: GRID.right + rightInset }}
      >
        <span>{i18n.t('flow.src')}</span>
        <span>{i18n.t('flow.rel')}</span>
        <span>{i18n.t('flow.dst')}</span>
      </div>
      <div className="flow-sankey-canvas" ref={hostRef} />

      {empty && (
        <div className="tl2d-empty">
          <h3>{i18n.t('analysis.noAgg')}</h3>
          <p>{i18n.t('flow.emptyHelp')}</p>
        </div>
      )}

      {!empty && selection && (
        <button type="button" className="flow-sankey-clear" onClick={reset}>
          <CloseOutlined /> {i18n.t('flow.clearHighlight')}
        </button>
      )}
    </div>
  )
}
