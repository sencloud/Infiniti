/**
 * 星图时间面板 option 构造
 *
 * 单元（回 / 篇 / 节）× 语义簇 的堆叠面积图，同时是单元区间筛选器：
 * dataZoom inside + brush 拖选区间，区间外的画布点会被压暗。
 * 对应 Aella 的 TemporalStackedChart——它把时间当独立分析维度，
 * 我们更进一步让时间直接驱动主画布的过滤。
 */
import type { GalaxyTimelineCell } from '../../../api/kg-explore'
import { activeProfile, terms, unitLabel } from '@/graph/profile'
import { palette } from '@/theme/palette'
import { clusterColor } from './buildGalaxyOption'

function frame(units: number[]) {
  const p = palette()
  const named = activeProfile().units?.some((u) => u.label)
  return {
    grid: { left: 30, right: 8, top: 6, bottom: 16 },
    xAxis: {
      type: 'category' as const,
      // 类目值保持数字：TimelinePanel 的 brush 区间按 Number() 解析，名称只在标签里换
      data: units.map(String),
      axisLine: { lineStyle: { color: p.rule } },
      axisLabel: {
        color: p.ink2,
        fontSize: 10,
        hideOverlap: true,
        ...(named ? { formatter: (v: string) => unitLabel(Number(v)) } : {}),
      },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value' as const,
      axisLabel: { color: p.ink3, fontSize: 10 },
      splitLine: { lineStyle: { color: p.rule2 } },
    },
    // 拖选即筛选：lineX 横向带选（激活由 TimelinePanel 的 takeGlobalCursor 控制）
    toolbox: { show: false },
    brush: {
      toolbox: [],
      xAxisIndex: 0,
      brushLink: 'all',
      brushStyle: { color: p.accentSoft, borderColor: p.accentLine },
      transformable: false,
      throttleType: 'fixRate',
      throttleDelay: 100,
    },
    tooltip: {
      trigger: 'axis' as const,
      backgroundColor: p.panel,
      borderColor: p.rule,
      textStyle: { color: p.ink, fontSize: 11 },
      formatter: (items: Array<{ axisValue: string; marker: string; seriesName: string; value: number }>) => {
        if (!items?.length) return ''
        const head = `<div style="font-weight:600">${unitLabel(Number(items[0].axisValue))}</div>`
        return head + items
          .filter((it) => it.value)
          .map((it) => `<div>${it.marker}${it.seriesName}：${it.value}</div>`)
          .join('')
      },
    },
  }
}

export function buildTimelineOption(
  matrix: GalaxyTimelineCell[],
  topClusters: number[],
  activeCluster: number | null = null,
  clusterNames: Map<number, string> = new Map(),
) {
  const years = [...new Set(matrix.map((m) => m.year))].sort((a, b) => a - b)
  // 堆叠顺序按簇 id 升序，保证两次渲染颜色位置一致
  const byCluster = new Map<number, Map<number, number>>()
  for (const cell of matrix) {
    if (!byCluster.has(cell.cluster_id)) byCluster.set(cell.cluster_id, new Map())
    byCluster.get(cell.cluster_id)!.set(cell.year, cell.count)
  }
  const clusterTerm = terms().cluster

  // 语义族聚焦：只画该族的分布（单系列不堆叠）。
  // 主画布已按族过滤，时间面板若仍画全库堆叠会与所见不一致。
  if (activeCluster !== null) {
    return {
      ...frame(years),
      series: [{
        name: clusterNames.get(activeCluster) || `${clusterTerm} ${activeCluster}`,
        type: 'line' as const,
        areaStyle: { opacity: 0.55 },
        lineStyle: { width: 0 },
        emphasis: { focus: 'series' as const },
        symbol: 'none',
        smooth: false,
        itemStyle: { color: clusterColor(activeCluster) },
        data: years.map((y) => byCluster.get(activeCluster)?.get(y) ?? 0),
      }],
    }
  }

  const clusterIds = [...byCluster.keys()].sort((a, b) => a - b)
  // 小簇合并成"其他"，30 个系列堆叠会糊成一条色带
  const major = clusterIds.filter((id) => topClusters.includes(id))
  const rest = clusterIds.filter((id) => !topClusters.includes(id))

  const series = major.map((cid) => ({
    // tooltip 显示 LLM 起的簇名（比"簇 13"可读）；未命中退回编号
    name: clusterNames.get(cid) || `${clusterTerm} ${cid}`,
    type: 'line' as const,
    stack: 'total',
    areaStyle: { opacity: 0.55 },
    lineStyle: { width: 0 },
    emphasis: { focus: 'series' as const },
    symbol: 'none',
    smooth: false,
    itemStyle: { color: clusterColor(cid) },
    data: years.map((y) => byCluster.get(cid)?.get(y) ?? 0),
  }))
  if (rest.length) {
    series.push({
      name: `其他${clusterTerm}`,
      type: 'line',
      stack: 'total',
      areaStyle: { opacity: 0.3 },
      lineStyle: { width: 0 },
      emphasis: { focus: 'series' },
      symbol: 'none',
      smooth: false,
      itemStyle: { color: palette().ink3 },
      data: years.map((y) => rest.reduce((s, cid) => s + (byCluster.get(cid)?.get(y) ?? 0), 0)),
    })
  }

  return { ...frame(years), series }
}
