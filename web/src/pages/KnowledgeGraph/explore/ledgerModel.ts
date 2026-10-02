/**
 * 事件台账的数据成形（渲染前的那一步）
 *
 * 台账乱，根子不在样式，而在这份数据被平铺着读：
 *   1. 两种时间口径混在一条时间线上。event = 事情何时发生（Temporal 锚点），
 *      doc = 证据何时形成（档案成文日期）。按同一个字段排序，读起来就像
 *      同一件事发生了两次。这里永远分成两栏，不再混排。
 *   2. 行里没有"和谁"。接口给的是 src/dst 两个 id 加一个谓词，
 *      直接把谓词当标题就成了"发生/形成于时间"这句半截话。
 *      这里用锚点把对端解出来当标题，谓词降级为标签。
 *   3. 同一件档案被多条事实反复引用，档号在台账里出现好几次。
 *      证据行按档号归并成一条，展开才看逐条事实。
 *
 * 纯函数：不碰请求、不碰 React，便于单独核对口径。
 */
import type { TimelineEntry } from '@/api/kg-analysis'
import { activeProfile, unitFull } from '@/graph/profile'
import i18n from '@/i18n'

/** 台账行：一条事实在台账里读作什么 */
export interface LedgerRow {
  id: string
  claimId: string
  predicate: string
  eventSource: 'event' | 'doc'
  year: number
  month: number
  /** 连续值：year + (month-1)/12，与时间轴游标同一精度 */
  moment: number
  counterpartId: string
  counterpartName: string
  /** 对端是 Temporal：这一行读作"事情发生在某时"，对端名本身就是时间 */
  counterpartIsTime: boolean
  /** 对端不在当前画布上（解析不到名称） */
  counterpartMissing: boolean
  docDate: string
  archiveNumber: string
  recordId: string
  evidence: string
  confidence: number
}

/** 同一件档案下的多条证据合成一组，避免档号在台账里重复出现 */
export interface LedgerDocGroup {
  key: string
  archiveNumber: string
  docDate: string
  recordId: string
  rows: LedgerRow[]
}

export interface LedgerGroup {
  key: string
  title: string
  events: LedgerRow[]
  docs: LedgerDocGroup[]
}

export interface LedgerModel {
  groups: LedgerGroup[]
  /** 游标过滤后的事实条数 */
  total: number
  eventCount: number
  /** 证据事实条数 */
  docCount: number
  /** 去重后的档案件数 */
  archiveCount: number
}

export const LEDGER_TIME_LABEL: Record<LedgerRow['eventSource'], string> = {
  event: '单元',
  doc: '出处',
}

/** 解析不到的实体给一个占位：宁可显示"未知"，也不要让标题空着 */
const UNKNOWN_ENTITY = '未知实体'

export interface LedgerInput {
  items: TimelineEntry[]
  /** 台账锚点：用它判断每条事实里谁是对端 */
  anchorId: string
  /** 实体 id -> 名称/类型（画布上有这份数据） */
  resolveEntity?: (entityId: string) => { name: string; label: string } | null
  /** 时间轴游标（可带月小数）；为空表示不按时间过滤 */
  cursorYear?: number
}

export function buildLedger({
  items, anchorId, resolveEntity, cursorYear,
}: LedgerInput): LedgerModel {
  const rows: LedgerRow[] = []

  items.forEach((item) => {
    const year = item.event_year || 0
    const month = item.event_month || 0
    const moment = year + (month ? (month - 1) / 12 : 0)
    // 游标带月小数：同一月里的先后也要能播出来（与 Timeline2DScene 同口径）。
    // 没有年份的行不受游标影响——它没有可比较的时间。
    if (cursorYear != null && year && moment > cursorYear + 1e-9) return

    const isSource = item.src_entity_id === anchorId
    const counterpartId = isSource ? item.dst_entity_id : item.src_entity_id
    const hit = counterpartId ? resolveEntity?.(counterpartId) : null
    rows.push({
      id: String(item.id),
      claimId: item.claim_id || '',
      predicate: item.predicate,
      eventSource: item.event_source === 'event' ? 'event' : 'doc',
      year,
      month,
      moment,
      counterpartId,
      counterpartName: hit?.name || counterpartId || UNKNOWN_ENTITY,
      counterpartIsTime: hit?.label === 'Temporal',
      counterpartMissing: !hit,
      docDate: item.doc_date || '',
      archiveNumber: item.archive_number || '',
      recordId: item.record_id || '',
      evidence: item.evidence_text || '',
      confidence: item.confidence,
    })
  })

  const groups = new Map<string, LedgerGroup>()
  rows.forEach((row) => {
    const key = `${row.year}-${row.month}`
    let group = groups.get(key)
    if (!group) {
      group = {
        key,
        title: row.year ? unitFull(row.year) : i18n.t('analysis.unknownAxis', { axis: activeProfile().unit.axis }),
        events: [],
        docs: [],
      }
      groups.set(key, group)
    }
    if (row.eventSource === 'event') {
      group.events.push(row)
      return
    }
    // 证据行按档号归并：同一件档案在台账里只出现一次
    const docKey = row.archiveNumber || row.recordId || row.id
    let doc = group.docs.find((candidate) => candidate.key === docKey)
    if (!doc) {
      doc = {
        key: docKey,
        archiveNumber: row.archiveNumber,
        docDate: row.docDate,
        recordId: row.recordId,
        rows: [],
      }
      group.docs.push(doc)
    }
    doc.rows.push(row)
    // 同组里的档号/成文日期可能有的行缺、有的行全，补齐而不是留空
    if (!doc.docDate && row.docDate) doc.docDate = row.docDate
    if (!doc.recordId && row.recordId) doc.recordId = row.recordId
  })

  const ordered = [...groups.values()].sort((a, b) => {
    const [ay, am] = a.key.split('-').map(Number)
    const [by, bm] = b.key.split('-').map(Number)
    return ay - by || am - bm
  })

  const docRows = rows.filter((row) => row.eventSource === 'doc')
  return {
    groups: ordered,
    total: rows.length,
    eventCount: rows.length - docRows.length,
    docCount: docRows.length,
    archiveCount: new Set(docRows.map((row) => row.archiveNumber || row.recordId || row.id)).size,
  }
}
