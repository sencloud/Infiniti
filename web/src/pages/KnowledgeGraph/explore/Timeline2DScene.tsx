/**
 * 时序 2D 场景（关系探索页的「时序」模式）
 *
 * 为什么时序模式必须是 2D：3D 力导向的坐标是拓扑位置，没有"时间方向"，
 * 播放时节点只会在球体里飘动，看不出演进。2D 场景把横轴让给时间，
 * 实体类型作为泳道，事件按年代从左到右排开——拖动或播放时间轴时，
 * "截至此刻已发生了什么"才是可以直接读出来的。
 *
 * 所以进入时序模式时由父组件自动卸载 3D 画布、挂载本组件（见 ExploreGraphPage）：
 * 不是给 3D 加个滤镜，而是换一套真正表达时间语义的呈现方式。
 *
 * 数据全部来自画布上已有的图数据 + 前端推导的时间维度，零额外请求：
 * 时间锚点来自 Temporal 实体 / OCCURRED_ON（timeDimension.ts）。
 *
 * 三条读数规则（都是为了让"演进"读得出来，而不是好看）：
 *   1. 横轴按**实际事件范围**取景，不再用推导范围硬撑 60 年——
 *      全部事件都在 2025 年时，60 年的轴会把它们挤成一小撮。
 *   2. 横轴精确到月（timeDim.moments）：同名同年的事件要能分开摆。
 *   3. OCCURRED_ON 连线不画。它表示"这个实体发生在某时"，而某时已经在横轴上；
 *      画出来每个事件都拖一条斜线到"时间"泳道，纯噪声。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as echarts from 'echarts'

import type { GraphData, GraphNode } from '@/api/knowledge-graph'
import { nodeColor, nodeLabel } from '@/utils/graphStyle'
import { activeProfile, unitLabel } from '@/graph/profile'
import { palette } from '@/theme/palette'
import { useTheme } from '@/theme/ThemeProvider'
import type { TimeDimension, YearMoment } from './timeDimension'

interface Props {
  data: GraphData
  timeDim: TimeDimension | null
  /** 时间范围（整数年，来自左侧年代轴）；超出范围的事件不参与时序场景 */
  yearLo?: number
  yearHi?: number
  onNodeClick?: (node: GraphNode) => void
  /** 播放推进时把当前时刻回报给父组件（右侧台账联动）。可能带月小数 */
  onCursorChange?: (cursor: number) => void
}

/** 泳道顺序按出现次数降序，主类型排在上方 */
const LANE_LIMIT = 12
/** 连线数上限：2D 场景要的是"读得懂"，不是画满 */
const LINK_LIMIT = 500
/** 章回没有更细的粒度，不启用细分刻度 */
const MONTH_SCALE_YEARS = 0
/** 推理出的范围两端留白比例 */
const RANGE_PADDING = 0.04
/** 锚点全部落在同一回时，横轴至少铺开几回，免得所有点重叠在一条竖线上 */
const MIN_SPAN_YEARS = 4

const chartAlive = (chart: echarts.ECharts | null): chart is echarts.ECharts => (
  !!chart && !chart.isDisposed()
)

/** 稳定散列：同名同年的事件不能重叠成一点 */
function jitter(text: string): number {
  let hash = 0
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) % 100000
  }
  return (hash % 1000) / 1000 - 0.5
}

interface EventPoint {
  node: GraphNode
  year: number
  /** 精确到月的时间锚点（横轴定位用它，避免同年事件重叠） */
  moment: YearMoment
  lane: number
  y: number
}

/** 单元刻度：有名称的单元（教材「七上·1.2」）显示名称，否则显示序号 */
function makeTickFormatter(_spanYears: number) {
  const named = activeProfile().units?.some((u) => u.label)
  return (value: number): string => (named ? unitLabel(Math.round(value)) : `${Math.round(value)}`)
}

function momentText(moment: YearMoment, _withMonth: boolean): string {
  return unitLabel(moment.year)
}

/** 连续年份值 -> 所在月的月初（用于把细粒度横轴对齐到整月） */
function monthStart(value: number): number {
  const year = Math.floor(value + 1e-9)
  const index = Math.min(Math.max(Math.floor((value - year) * 12 + 1e-9), 0), 11)
  return year + index / 12
}

/** 连续年份值 -> 所在月的月末（等于下月初，保证刻度落在整月边界上） */
function monthEnd(value: number): number {
  const year = Math.floor(value + 1e-9)
  const index = Math.min(Math.max(Math.ceil((value - year) * 12 - 1e-9), 1), 12)
  return year + index / 12
}

export default function Timeline2DScene({
  data,
  timeDim,
  yearLo,
  yearHi,
  onNodeClick,
  onCursorChange,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<echarts.ECharts | null>(null)
  const { theme } = useTheme()
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [cursor, setCursor] = useState<number>(yearLo ?? 0)
  const cursorRef = useRef(cursor)
  /** 图表引擎只在挂载时初始化，事件回调必须通过 ref 读到最新数据 */
  const eventsRef = useRef<EventPoint[]>([])
  const clickRef = useRef(onNodeClick)
  const cursorCbRef = useRef(onCursorChange)

  useEffect(() => { clickRef.current = onNodeClick }, [onNodeClick])
  useEffect(() => { cursorCbRef.current = onCursorChange }, [onCursorChange])
  useEffect(() => { cursorRef.current = cursor }, [cursor])

  /* ---------- 事件与泳道 ---------- */

  /**
   * 事件点 + 泳道清单一起产出。
   *
   * 必须同源：点的 y 是"泳道序号"，yAxis 的类目是"泳道名"，
   * 两者若各自排序（一个按条数、一个按首次出现时间），
   * 顺序一旦不同，点就会画到隔壁类型的行上——这一行是修这个错位。
   */
  const timeline = useMemo<{ points: EventPoint[]; lanes: string[] }>(() => {
    if (!timeDim) return { points: [], lanes: [] }
    const anchored = data.nodes
      .map((node) => ({ node, moment: timeDim.moments.get(node.id) }))
      .filter((item): item is { node: GraphNode; moment: YearMoment } => item.moment != null)
      // 左侧年代轴收窄时，范围外的事件不进时序场景
      .filter(({ moment }) => (
        (yearLo == null || moment.year >= yearLo) && (yearHi == null || moment.year <= yearHi)
      ))

    /**
     * Temporal 实体是"时间锚点"，不是"事项"。它已经在横轴上了，
     * 再铺一行点只是噪声；只有当画布上没有任何继承到时间的实体时，
     * 才退化为直接展示锚点本身（否则整个场景会空掉）。
     */
    const withTime = anchored.filter(({ node }) => node.label !== 'Temporal')
    const placed = withTime.length ? withTime : anchored

    const counter = new Map<string, number>()
    placed.forEach(({ node }) => {
      counter.set(node.label, (counter.get(node.label) || 0) + 1)
    })
    const lanes = Array.from(counter.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, LANE_LIMIT)
      .map(([label]) => label)

    const points = placed
      .filter(({ node }) => lanes.includes(node.label))
      .map(({ node, moment }) => {
        const lane = lanes.indexOf(node.label)
        return {
          node,
          year: moment.year,
          moment,
          lane,
          y: lane + jitter(node.id) * 0.6,
        }
      })
      .sort((a, b) => a.moment.value - b.moment.value)

    return { points, lanes }
  }, [data.nodes, timeDim, yearLo, yearHi])

  const events = timeline.points
  const lanes = timeline.lanes

  const links = useMemo(() => {
    const byId = new Map(events.map((event) => [event.node.id, event]))
    const out: Array<{ from: EventPoint; to: EventPoint; type: string }> = []
    data.edges.forEach((edge) => {
      // OCCURRED_ON 已经由横轴表达（见文件头规则 3），画出来只会多出一片斜线
      if (String(edge.type).toLowerCase() === 'occurred_on') return
      const from = byId.get(edge.source)
      const to = byId.get(edge.target)
      if (!from || !to || from === to) return
      out.push({ from, to, type: edge.type })
    })
    // 年代靠后的连线先入列：超限截断时保留的是演进后段的链路
    return out
      .sort((a, b) => (
        Math.max(b.from.moment.value, b.to.moment.value)
        - Math.max(a.from.moment.value, a.to.moment.value)
      ))
      .slice(0, LINK_LIMIT)
  }, [data.edges, events])

  useEffect(() => { eventsRef.current = events }, [events])

  /**
   * 横轴取景：按实际事件范围自适应。
   * 旧实现直接用推导范围（最小 60 年），数据只覆盖一两年时大半张画布是空的。
   */
  const span = useMemo(() => {
    const values = events.map((event) => event.moment.value)
    if (!values.length) {
      const lo = yearLo ?? timeDim?.lo ?? 0
      const hi = yearHi ?? timeDim?.hi ?? 0
      return { lo, hi, width: Math.max(hi - lo, MIN_SPAN_YEARS) }
    }
    let lo = Math.min(...values)
    let hi = Math.max(...values)
    if (hi - lo < MIN_SPAN_YEARS) {
      const mid = (lo + hi) / 2
      lo = mid - MIN_SPAN_YEARS / 2
      hi = mid + MIN_SPAN_YEARS / 2
    }
    if (hi - lo < MONTH_SCALE_YEARS) {
      // 细粒度横轴直接对齐到整月：刻度才会落成 '2025-01' 这样的整月，而不是半路的小数
      lo = monthStart(lo)
      hi = monthEnd(hi)
    } else {
      const pad = (hi - lo) * RANGE_PADDING
      lo -= pad
      hi += pad
    }
    return { lo, hi, width: hi - lo }
  }, [events, yearLo, yearHi, timeDim])

  /** 横轴是否细到月：决定刻度与读数的写法 */
  const monthScale = span.width < MONTH_SCALE_YEARS
  const tickFormatter = useMemo(() => makeTickFormatter(span.width), [span.width])

  /* ---------- 播放推进 ---------- */

  /**
   * 生效游标：区间收窄后旧的游标值可能落在范围外。
   * 这里用派生值而不是 effect 回写 state——在 effect 里同步 setState 会触发
   * 级联渲染，等价的效果用一次 min/max 就够了。
   */
  const cursorValue = useMemo(
    () => Math.min(Math.max(cursor, span.lo), span.hi),
    [cursor, span.lo, span.hi],
  )

  useEffect(() => {
    if (!playing) return
    let raf = 0
    let last = performance.now()
    // 1x 速度 = 20 秒播完全程；跨度越大推进越快，但总量恒定，观感一致
    const yearsPerMs = span.width / 20000
    const tick = (now: number) => {
      const delta = now - last
      last = now
      const base = Math.min(Math.max(cursorRef.current, span.lo), span.hi)
      const next = base + delta * yearsPerMs * speed
      if (next >= span.hi) {
        setCursor(span.hi)
        setPlaying(false)
        return
      }
      setCursor(next)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, speed, span.hi, span.lo, span.width])

  useEffect(() => {
    // 游标带月小数：台账按同一精度判断"截至此刻"，否则同年事件会被一次性放出来
    cursorCbRef.current?.(cursorValue)
  }, [cursorValue])

  /* ---------- 图表 ---------- */

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
      const nodeId = (params as { data?: { nodeId?: string } })?.data?.nodeId
      if (!nodeId) return
      const hit = eventsRef.current.find((event) => event.node.id === nodeId)
      if (hit) clickRef.current?.(hit.node)
    })
    return () => {
      window.removeEventListener('resize', onResize)
      observer.disconnect()
      if (chartAlive(chartRef.current)) chartRef.current.dispose()
      chartRef.current = null
    }
    // 只在挂载时初始化引擎；数据变化走下面的 setOption
  }, [])

  useEffect(() => {
    if (!chartAlive(chartRef.current)) return
    const revealed = (moment: YearMoment) => moment.value <= cursorValue + 1e-9
    const p = palette(theme)

    const option = {
      animation: false,
      grid: { left: 96, right: 28, top: 30, bottom: 34 },
      tooltip: {
        trigger: 'item',
        confine: true,
        formatter: (params: { name?: string; data?: { point?: EventPoint } }) => {
          const point = params?.data?.point
          if (!point) return params?.name || ''
          const state = revealed(point.moment) ? '已出场' : '尚未出场'
          const time = momentText(point.moment, monthScale)
          return `${point.node.name}<br/>${nodeLabel(point.node.label)} · ${time} · ${state}`
        },
      },
      xAxis: {
        type: 'value',
        min: span.lo,
        max: span.hi,
        // 默认数值刻度会把年份写成 '2,025'，这里换成纯年份或年-月
        axisLabel: { formatter: tickFormatter, color: p.ink2, hideOverlap: true },
        axisLine: { lineStyle: { color: p.rule } },
        name: activeProfile().unit.name,
        nameLocation: 'end',
        nameGap: 8,
        nameTextStyle: { color: p.ink3, fontSize: 11 },
        splitLine: { lineStyle: { color: p.rule2 } },
      },
      yAxis: {
        type: 'category',
        data: lanes.map((label) => nodeLabel(label)),
        axisLabel: { color: p.ink2 },
        axisLine: { lineStyle: { color: p.rule } },
        splitLine: { show: false },
      },
      series: [
        {
          // 关联线：两端都"已发生"才实色，否则压到几乎看不见
          type: 'lines',
          coordinateSystem: 'cartesian2d',
          silent: true,
          z: 1,
          data: links.map((link) => ({
            coords: [
              [link.from.moment.value, link.from.y],
              [link.to.moment.value, link.to.y],
            ],
            lineStyle: {
              color: revealed(link.to.moment) ? p.indigoSoft : p.rule2,
              width: 1,
            },
          })),
        },
        {
          type: 'scatter',
          z: 3,
          symbolSize: 11,
          data: events.map((point) => ({
            value: [point.moment.value, point.y],
            nodeId: point.node.id,
            point,
            itemStyle: {
              color: nodeColor(point.node.label).main,
              opacity: revealed(point.moment) ? 0.95 : 0.12,
              borderColor: p.panel,
              borderWidth: 1,
            },
          })),
        },
        {
          // 播放游标：一条竖线，读"现在播到哪一年"
          type: 'line',
          silent: true,
          z: 5,
          symbol: 'none',
          data: [[cursorValue, -0.5], [cursorValue, Math.max(lanes.length - 0.5, 0.5)]],
          lineStyle: { color: p.accent, width: 2, type: 'dashed' },
        },
      ],
    }
    chartRef.current.setOption(option as echarts.EChartsOption, { notMerge: true })
  }, [events, links, lanes, cursorValue, span.lo, span.hi, tickFormatter, monthScale, theme])

  /* ---------- 渲染 ---------- */

  const happened = events.filter((event) => event.moment.value <= cursorValue + 1e-9).length
  const empty = !timeDim || events.length === 0
  const cursorMoment = useMemo(() => {
    const year = Math.floor(cursorValue + 1e-9)
    const month = Math.round((cursorValue - year) * 12) + 1
    return { year, month: month >= 1 && month <= 12 ? month : 0, value: cursorValue }
  }, [cursorValue])

  const setCursorSafe = useCallback((value: number) => {
    setCursor(Math.min(Math.max(value, span.lo), span.hi))
  }, [span.lo, span.hi])

  return (
    <div className="tl2d-host">
      <div className="tl2d-canvas" ref={hostRef} />

      {empty && (
        <div className="tl2d-empty">
          <h3>暂无可用于时序分析的实体</h3>
          <p>
            时序场景按实体<b>首次出现的{activeProfile().unit.axis}</b>从左到右排开。
            先用搜索或快速定位展开一些实体，再回到这里播放。
          </p>
        </div>
      )}

      {!empty && (
        <>
          <div className="tl2d-controls">
            <div className="tl2d-readout">
              <b>{unitLabel(Math.round(cursorMoment.value))}</b>
              {' · '}已出场 <b>{happened}</b> / {events.length}
            </div>
            <button
              type="button"
              className="tl2d-play"
              onClick={() => {
                if (!playing && cursorValue >= span.hi) setCursor(span.lo)
                setPlaying((prev) => !prev)
              }}
            >
              {playing ? '⏸ 暂停' : '▶ 播放'}
            </button>
            <input
              className="tl2d-scrub"
              type="range"
              min={span.lo}
              max={span.hi}
              step={Math.max(span.width / 1000, 0.02)}
              value={cursorValue}
              onChange={(event) => {
                setPlaying(false)
                setCursorSafe(Number(event.target.value))
              }}
            />
            <div className="tl2d-speeds">
              {[0.5, 1, 2, 4].map((rate) => (
                <button
                  key={rate}
                  type="button"
                  className={`tl2d-speed ${speed === rate ? 'on' : ''}`}
                  onClick={() => setSpeed(rate)}
                >
                  {rate}x
                </button>
              ))}
            </div>
            <button
              type="button"
              className="tl2d-reset"
              onClick={() => { setPlaying(false); setCursor(span.lo) }}
            >
              回到起点
            </button>
          </div>
        </>
      )}
    </div>
  )
}
