import i18n from '@/i18n'
import type { Anomaly } from '@/api/kg-analysis'
import { activeProfile, predicateName, unitLabel } from '@/graph/profile'

type Hit = { predicate?: string; chapter?: number }
type ValueHit = { value?: string }

function en(): boolean {
  return i18n.language.toLowerCase().startsWith('en')
}

function list<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : []
}

function byChapter(items: Hit[], dir: 'min' | 'max'): Hit | undefined {
  if (!items.length) return undefined
  return items.reduce((best, item) => {
    const a = best.chapter ?? 0
    const b = item.chapter ?? 0
    return dir === 'min' ? (a <= b ? best : item) : (a >= b ? best : item)
  })
}

function pairNames(title: string, anchor: string): { a: string; b: string } | null {
  const matched = title.match(/^(.+?) 与 (.+?)：/)
  if (!matched) return null
  return { a: matched[1] || anchor, b: matched[2] }
}

function titleR1(item: Anomaly): string {
  const detail = item.detail || {}
  const positive = list<Hit>(detail.positive)
  const hostile = list<Hit>(detail.hostile)
  const firstPos = byChapter(positive, 'min')
  const lastPos = byChapter(positive, 'max')
  const firstNeg = byChapter(hostile, 'min')
  const lastNeg = byChapter(hostile, 'max')
  const names = pairNames(item.title, item.anchor_name)
  if (!firstPos || !lastNeg || !firstNeg || !lastPos || !names?.b) return item.title
  const betrayal = (lastNeg.chapter ?? 0) > (firstPos.chapter ?? 0)
    && (lastNeg.chapter ?? 0) >= (lastPos.chapter ?? 0)
  if (betrayal) {
    return i18n.t('clue.r1after', {
      a: names.a,
      b: names.b,
      earlier: predicateName(firstPos.predicate || ''),
      later: predicateName(lastNeg.predicate || ''),
    })
  }
  return i18n.t('clue.r1before', {
    a: names.a,
    b: names.b,
    earlier: predicateName(firstNeg.predicate || ''),
    later: predicateName(lastPos.predicate || ''),
  })
}

function titleR2(item: Anomaly): string {
  const detail = item.detail || {}
  const killer = typeof detail.killer === 'string' ? detail.killer : ''
  const death = Number(detail.death_chapter)
  const laterChapters = list<number>(detail.later_chapters)
  const later = Number(laterChapters[0])
  if (!item.anchor_name || !killer || !death || !later) return item.title
  const quoted = item.title.match(/仍有「([^」]+)」/)
  const predicate = typeof detail.later_predicate === 'string'
    ? predicateName(detail.later_predicate)
    : (quoted?.[1] || '')
  if (!predicate) {
    return i18n.t('clue.r2plain', {
      name: item.anchor_name,
      killer,
      death: unitLabel(death),
      later: unitLabel(later),
    })
  }
  return i18n.t('clue.r2', {
    name: item.anchor_name,
    killer,
    death: unitLabel(death),
    later: unitLabel(later),
    predicate,
  })
}

function titleR3(item: Anomaly): string {
  const detail = item.detail || {}
  const from = Number(detail.from_chapter)
  const to = Number(detail.to_chapter)
  const gap = detail.gap
  if (!item.anchor_name || !from || !to || gap == null) return item.title
  return i18n.t('clue.r3', {
    name: item.anchor_name,
    from: unitLabel(from),
    to: unitLabel(to),
    gap,
    unit: activeProfile().unit.name,
  })
}

function titleR4(item: Anomaly): string {
  const detail = item.detail || {}
  const values = [...new Set(list<ValueHit>(detail.values).map((item) => item.value).filter(Boolean))]
  const predicate = typeof detail.predicate === 'string' ? predicateName(detail.predicate) : ''
  if (!item.anchor_name || !predicate || values.length < 2) return item.title
  return i18n.t('clue.r4', {
    name: item.anchor_name,
    predicate,
    count: values.length,
    values: values.join(' / '),
  })
}

function titleM1(item: Anomaly): string {
  const detail = item.detail || {}
  const prerequisite = typeof detail.prerequisite === 'string' ? detail.prerequisite : ''
  const preAt = Number(detail.prerequisite_first)
  const targetAt = Number(detail.target_first)
  if (!item.anchor_name || !prerequisite || !preAt || !targetAt) return item.title
  return i18n.t('clue.m1', {
    target: item.anchor_name,
    prerequisite,
    preAt: unitLabel(preAt),
    targetAt: unitLabel(targetAt),
  })
}

function titleM2(item: Anomaly): string {
  const members = list<string>(item.detail?.members).filter(Boolean)
  if (members.length < 2) return item.title
  return i18n.t('clue.m2', { cycle: members.join(' ⇄ ') })
}

function titleM3(item: Anomaly): string {
  const chapter = Number(item.detail?.chapter)
  if (!item.anchor_name || !chapter) return item.title
  return i18n.t('clue.m3', { name: item.anchor_name, unit: unitLabel(chapter) })
}

function titleM4(item: Anomaly): string {
  const detail = item.detail || {}
  const from = Number(detail.prerequisite_first)
  const to = Number(detail.target_first)
  const parsed = item.title.match(/的「([^」]+)」才再用到/)
  const other = typeof detail.counterpart_name === 'string' ? detail.counterpart_name : (parsed?.[1] || '')
  if (!item.anchor_name || !from || !to || !other) return item.title
  return i18n.t('clue.m4', {
    name: item.anchor_name,
    from: unitLabel(from),
    to: unitLabel(to),
    other,
  })
}

function titleG1(item: Anomaly): string {
  const detail = item.detail || {}
  const text = (key: string) => (typeof detail[key] === 'string' ? detail[key] as string : '')
  const [core, src, dst, predicate] = [text('core'), text('src'), text('dst'), text('predicate')]
  if (!item.anchor_name || !core || !src || !dst || !predicate) return item.title
  return i18n.t('clue.g1', { name: item.anchor_name, core, relation: `${src} ${predicateName(predicate)} ${dst}` })
}

function titleS1(item: Anomaly): string {
  const count = Number(item.detail?.count)
  if (!item.anchor_name || !count) return item.title
  return i18n.t('clue.s1', { name: item.anchor_name, count })
}

function titleS2(item: Anomaly): string {
  const detail = item.detail || {}
  const cited = typeof detail.cited === 'string' ? detail.cited : ''
  const newer = typeof detail.newer === 'string' ? detail.newer : ''
  if (!item.anchor_name || !cited || !newer) return item.title
  return i18n.t('clue.s2', { name: item.anchor_name, cited, newer })
}

function titleS3(item: Anomaly): string {
  const sources = list<{ name?: string }>(item.detail?.sources).map((s) => s.name).filter(Boolean) as string[]
  const names = [...new Set(sources)]
  if (!item.anchor_name || names.length < 2) return item.title
  return i18n.t('clue.s3', { name: item.anchor_name, count: names.length, sources: names.slice(0, 4).join(', ') })
}

const FORMAT: Record<string, (item: Anomaly) => string> = {
  S1: titleS1,
  S2: titleS2,
  S3: titleS3,
  R1: titleR1,
  R2: titleR2,
  R3: titleR3,
  R4: titleR4,
  M1: titleM1,
  M2: titleM2,
  M3: titleM3,
  M4: titleM4,
  G1: titleG1,
}

/** 中文沿用入库时写好的句子；英文用 detail 里的结构化字段现拼，缺字段时退回原句。 */
export function clueTitle(item: Anomaly): string {
  if (!en()) return item.title
  return FORMAT[item.rule_code]?.(item) || item.title
}
