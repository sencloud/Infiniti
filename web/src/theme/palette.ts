/**
 * 纸墨色板的 JS 版本：ECharts / three.js 画布拿不到 CSS 变量，按当前主题取值。
 * 数值必须与 theme.css 保持一致。
 */
export type ThemeName = 'light' | 'dark'

export interface Palette {
  bg: string
  panel: string
  ink: string
  ink2: string
  ink3: string
  rule: string
  rule2: string
  accent: string
  accentSoft: string
  accentLine: string
  indigo: string
  indigoSoft: string
  danger: string
  /** 标签描边（文字压在点上时的“留白”色） */
  halo: string
  /** 点被选中/命中时的填充 */
  hit: string
  dim: string
}

const LIGHT: Palette = {
  bg: '#f4f2ec',
  panel: '#fdfcf9',
  ink: '#272c34',
  ink2: '#5b6472',
  ink3: '#8d95a2',
  rule: 'rgba(39, 44, 52, 0.16)',
  rule2: 'rgba(39, 44, 52, 0.07)',
  accent: '#b23a26',
  accentSoft: 'rgba(178, 58, 38, 0.15)',
  accentLine: 'rgba(178, 58, 38, 0.7)',
  indigo: '#3c5a78',
  indigoSoft: 'rgba(60, 90, 120, 0.35)',
  danger: '#b23a26',
  halo: 'rgba(244, 242, 236, 0.92)',
  hit: '#fdfcf9',
  dim: 'rgba(141, 149, 162, 0.4)',
}

const DARK: Palette = {
  bg: '#14181f',
  panel: '#1a1f28',
  ink: '#e8eaef',
  ink2: '#a4adbb',
  ink3: '#667080',
  rule: 'rgba(232, 234, 239, 0.16)',
  rule2: 'rgba(232, 234, 239, 0.07)',
  accent: '#d96a4f',
  accentSoft: 'rgba(217, 106, 79, 0.2)',
  accentLine: 'rgba(217, 106, 79, 0.75)',
  indigo: '#8fb0d4',
  indigoSoft: 'rgba(143, 176, 212, 0.35)',
  danger: '#e08570',
  halo: 'rgba(20, 24, 31, 0.9)',
  hit: '#14181f',
  dim: 'rgba(102, 112, 128, 0.45)',
}

export const currentTheme = (): ThemeName =>
  (typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'dark') ? 'dark' : 'light'

export const palette = (theme: ThemeName = currentTheme()): Palette => (theme === 'dark' ? DARK : LIGHT)

/** 簇色：纸墨色相（朱、靛、松绿、赭金、紫檀、石青……），暗色主题提亮 */
const CLUSTER_LIGHT = [
  '#3c5a78', '#b23a26', '#2f7d5d', '#a87614', '#7a4f8c',
  '#2b7a8c', '#8c5a2b', '#5b7a2f', '#a8455e', '#4f5fa8',
  '#2f6d7d', '#9a6b1f', '#6d4f8c', '#3d8a6a', '#b0603a',
]
const CLUSTER_DARK = [
  '#8fb0d4', '#e0846b', '#6cbf8f', '#d4a53f', '#b48ccc',
  '#6cc0cf', '#d0a070', '#9cc06c', '#e08aa0', '#9aa8e8',
  '#70b4c4', '#e0b060', '#a890d0', '#7cd0a8', '#e8a07c',
]

export const clusterPalette = (theme: ThemeName = currentTheme()) => (theme === 'dark' ? CLUSTER_DARK : CLUSTER_LIGHT)
