/**
 * 教材转写里的 LaTeX（$a^2+b^2=c^2$、$\frac{1}{2}$、$\angle A$）转成可读的 Unicode 文本。
 * 只做展示：原文、证据偏移、抽取结果都保留 LaTeX，高亮按原文切好段后再逐段转换。
 */
import { activeProfile } from '@/graph/profile'

const SYMBOLS: Record<string, string> = {
  times: '×', div: '÷', cdot: '·', pm: '±', mp: '∓',
  leq: '≤', le: '≤', leqslant: '≤', geq: '≥', ge: '≥', geqslant: '≥', neq: '≠', ne: '≠', approx: '≈', equiv: '≡',
  pi: 'π', alpha: 'α', beta: 'β', gamma: 'γ', theta: 'θ', Delta: 'Δ', delta: 'δ', omega: 'ω',
  angle: '∠', triangle: '△', odot: '⊙', circ: '°', degree: '°', perp: '⊥', parallel: '∥', cong: '≌', sim: '∽',
  because: '∵', therefore: '∴', infty: '∞', in: '∈', notin: '∉', cup: '∪', cap: '∩', subset: '⊂',
  cdots: '…', ldots: '…', dots: '…', rightarrow: '→', Rightarrow: '⇒', to: '→', leftrightarrow: '↔',
  square: '□', Box: '□', prime: '′', percent: '%', quad: ' ', qquad: '  ', mid: '|', vert: '|',
}
const DROP = new Set(['left', 'right', 'displaystyle', 'mathrm', 'text', 'textbf', 'boldsymbol', 'mathbf', 'overline', 'underline', 'operatorname', 'big', 'Big'])

const SUP: Record<string, string> = {
  0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹',
  '+': '⁺', '-': '⁻', '−': '⁻', '(': '⁽', ')': '⁾', n: 'ⁿ', m: 'ᵐ', x: 'ˣ', k: 'ᵏ', a: 'ᵃ', b: 'ᵇ', '′': '′', '°': '°',
}
const SUB: Record<string, string> = {
  0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉',
  '+': '₊', '-': '₋', '(': '₍', ')': '₎', n: 'ₙ', m: 'ₘ', k: 'ₖ', x: 'ₓ', a: 'ₐ',
}

const mapAll = (s: string, table: Record<string, string>) =>
  [...s].every((c) => table[c]) ? [...s].map((c) => table[c]).join('') : null

const group = (s: string) => (s.length > 1 && /[+\-−×÷·/ ]/.test(s) ? `(${s})` : s)

function fraction(a: string, b: string): string {
  const top = mapAll(a, SUP)
  const bottom = mapAll(b, SUB)
  return top && bottom && /^\d+$/.test(a + b) ? `${top}⁄${bottom}` : `${group(a)}/${group(b)}`
}

function convert(tex: string): string {
  let s = tex
    .replace(/\\[,;:!]/g, '')
    .replace(/\\\{/g, '\u0001')
    .replace(/\\\}/g, '\u0002')
    .replace(/\\([A-Za-z]+)\s?/g, (m, name) => (name in SYMBOLS ? SYMBOLS[name] : DROP.has(name) ? '' : m))
  // 由内向外：没有嵌套花括号的 \frac / \sqrt 先换掉
  for (let i = 0; i < 6; i += 1) {
    const before = s
    s = s
      .replace(/\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, (_, a, b) => fraction(a, b))
      .replace(/\\sqrt\s*\[([^\]]*)\]\s*\{([^{}]*)\}/g, (_, n, x) => `${mapAll(n, SUP) ?? n}√${group(x)}`)
      .replace(/\\sqrt\s*\{([^{}]*)\}/g, (_, x) => `√${group(x)}`)
      .replace(/\^\s*\{([^{}]*)\}/g, (_, x) => mapAll(x, SUP) ?? `^(${x})`)
      .replace(/_\s*\{([^{}]*)\}/g, (_, x) => mapAll(x, SUB) ?? `_${x}`)
    if (s === before) break
  }
  s = s
    .replace(/\^\s*([0-9a-z+\-′])/gi, (m, c) => SUP[c] ?? m)
    .replace(/_\s*([0-9a-z])/gi, (m, c) => SUB[c] ?? m)
    .replace(/\\sqrt\s*(\w)/g, '√$1')
    .replace(/\\([A-Za-z]+)\s?/g, (m, name) => (name in SYMBOLS ? SYMBOLS[name] : DROP.has(name) ? '' : name))
    .replace(/[{}]/g, '')
    .replace(/\u0001/g, '{')
    .replace(/\u0002/g, '}')
  return s
}

/** 把一段文本里 $…$ / $$…$$ 包着的公式换成 Unicode；没有成对的 $ 时原样返回 */
export function prettyMath(text: string): string {
  if (!text || !text.includes('$')) return text
  return text.replace(/\$\$([^$]+)\$\$|\$([^$\n]+)\$/g, (_, a, b) => convert(a ?? b))
}

/**
 * 当前图谱是教材时才转换（小说原文里的 $ 不当公式）。
 * 高亮切段可能把一对 $ 拆到两段里，剩下落单的 $ 时整段按公式处理。
 */
export function displayText(text: string): string {
  if (activeProfile().kind !== 'textbook' || !text) return text
  const out = prettyMath(text)
  return out.includes('$') ? convert(out.replace(/\$/g, '')) : out
}
