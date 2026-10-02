/**
 * 知识图谱可视化的公共样式配置。
 * 颜色按实体类型编码固定（跨图谱一致），类型名与谓词名取当前图谱的本体（后端 src/kg/domains）。
 */
import { activeGraphId, entityTypeName, predicateName } from '@/graph/profile'
import i18n from '@/i18n'

export interface NodeColor {
  main: string
  light: string
  text: string
}

const color = (main: string, rgb: string): NodeColor => ({ main, light: `rgba(${rgb}, 0.2)`, text: '#fff' })

/** 色相取自首页纸墨色系：朱、靛、松绿、赭金、石青… */
export const NODE_COLORS: Record<string, NodeColor> = {
  Person: color('#3c5a78', '60, 90, 120'),
  Organization: color('#7a4f8c', '122, 79, 140'),
  Place: color('#2f7d5d', '47, 125, 93'),
  Event: color('#b23a26', '178, 58, 38'),
  Item: color('#a87614', '168, 118, 20'),
  Spirit: color('#8a5a9e', '138, 90, 158'),
  Concept: color('#3c5a78', '60, 90, 120'),
  Theorem: color('#b23a26', '178, 58, 38'),
  Formula: color('#a87614', '168, 118, 20'),
  Method: color('#2f7d5d', '47, 125, 93'),
  Figure: color('#7a4f8c', '122, 79, 140'),
  Text: color('#8a6d3b', '138, 109, 59'),
  Office: color('#5b6472', '91, 100, 114'),
  Chapter: color('#8d95a2', '141, 149, 162'),
}

const FALLBACK_LABELS: Record<string, string> = {
  Person: '人物',
  Organization: '势力',
  Place: '地点',
  Event: '事件',
  Item: '器物',
  Chapter: '章回',
}

export const nodeColor = (label: string): NodeColor => NODE_COLORS[label] || NODE_COLORS.Chapter

export const nodeLabel = (label: string): string =>
  (activeGraphId()
    ? entityTypeName(label)
    : (i18n.exists(`fallbackType.${label}`) ? i18n.t(`fallbackType.${label}`) : FALLBACK_LABELS[label])) || label

export const relationLabel = (type: string): string => {
  if (!type) return type
  return activeGraphId() ? predicateName(type.toUpperCase()) : type
}

export const claimStatusLabel = (status: string): string =>
  (status && i18n.exists(`status.${status}`) ? i18n.t(`status.${status}`) : status)
