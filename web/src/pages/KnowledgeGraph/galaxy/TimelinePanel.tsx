/**
 * 星图时间面板（底部）
 *
 * 堆叠面积图 + 拖选年度区间筛选主画布。
 * brush 用 lineX（横向带选）——年度筛选只有横向语义。
 * 注意 ECharts 的 brush 默认不激活，必须 takeGlobalCursor 打开，
 * 否则拖拽没有任何反应（主画布是靠 toolbox 激活的，这里没有 toolbox）。
 * 年度未知（year=0）的点不进面板——它们没有年度，无从按时间筛选。
 */
import { useEffect, useRef } from 'react'
import * as echarts from 'echarts'
import type { GalaxyTimelineCell } from '../../../api/kg-explore'
import { buildTimelineOption } from './buildTimelineOption'
import { useTheme } from '@/theme/ThemeProvider'

interface Props {
  matrix: GalaxyTimelineCell[]
  topClusters: number[]
  selectedRange: [number, number] | null
  onSelectRange: (range: [number, number] | null) => void
  /** 聚焦的语义族：非空时面板只画该族的年度分布（与主画布过滤联动） */
  activeCluster?: number | null
  /** 簇 id -> LLM 起的簇名，tooltip 显示用 */
  clusterNames?: Map<number, string>
}

/** brush coordRange 形状随 brushType 变化：rect 是 [[x1,x2],[y1,y2]]，lineX 是 [[x1,x2]]。
 *  category 轴回传的是类目值（字符串年份），Number() 统一转数值。 */
function parseYearRange(range: unknown): [number, number] | null {
  if (!Array.isArray(range)) return null
  const first = range[0]
  const xs = typeof first === 'number' || typeof first === 'string'
    ? range
    : Array.isArray(first) ? first : null
  if (!xs || xs.length !== 2) return null
  const a = Number(xs[0])
  const b = Number(xs[1])
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null
  return [Math.min(a, b), Math.max(a, b)]
}

/** dispose 后对象非空但已作废，调用 resize/setOption 会刷控制台警告 */
const chartAlive = (c: echarts.ECharts | null): c is echarts.ECharts => (
  !!c && !c.isDisposed()
)

export default function TimelinePanel({
  matrix,
  topClusters,
  selectedRange,
  onSelectRange,
  activeCluster = null,
  clusterNames = new Map(),
}: Props) {
  const chartRef = useRef<HTMLDivElement>(null)
  const chart = useRef<echarts.ECharts | null>(null)
  const { theme } = useTheme()
  // onSelectRange 存进 ref：echarts 事件回调闭包要拿最新值，
  // 否则 setOption 后事件监听里读到的会是首次渲染时的旧函数
  const selectRef = useRef(onSelectRange)
  useEffect(() => {
    selectRef.current = onSelectRange
  }, [onSelectRange])

  useEffect(() => {
    if (!chartRef.current) return
    chart.current = echarts.init(chartRef.current)
    chart.current.on('brushEnd', (params: any) => {
      const range = parseYearRange(params.areas?.[0]?.coordRange)
      // 空选/点一下（宽度过小）都视为清除筛选
      if (range && range[1] - range[0] >= 0.5) {
        selectRef.current([Math.ceil(range[0]), Math.floor(range[1])])
      } else {
        selectRef.current(null)
      }
    })
    const onResize = () => {
      if (chartAlive(chart.current)) chart.current.resize()
    }
    window.addEventListener('resize', onResize)
    // 面板高度自适应（年代徽章行出现/消失）时 ECharts 不会自己 resize，
    // 用 ResizeObserver 盯容器尺寸变化，比 window resize 覆盖面更全
    const ro = new ResizeObserver(onResize)
    ro.observe(chartRef.current)
    return () => {
      window.removeEventListener('resize', onResize)
      ro.disconnect()
      if (chartAlive(chart.current)) chart.current.dispose()
      chart.current = null
    }
  }, [])

  useEffect(() => {
    if (!chartAlive(chart.current)) return
    chart.current.setOption(
      buildTimelineOption(matrix, topClusters, activeCluster, clusterNames),
      { notMerge: true },
    )
    // notMerge 会把 brush 的激活态一并重置，每次 setOption 后重新打开
    chart.current.dispatchAction({
      type: 'takeGlobalCursor',
      key: 'brush',
      brushOption: { brushType: 'lineX', brushMode: 'single' },
    })
    // 外部清空筛选后，把残留的选区视觉也清掉
    if (!selectedRange) {
      chart.current.dispatchAction({ type: 'brush', areas: [] })
    }
  }, [matrix, topClusters, selectedRange, activeCluster, clusterNames, theme])

  return <div ref={chartRef} className="kgg-timeline-chart" />
}
