/**
 * 关系探索「分析面板」（右侧）
 *
 * 与 3D/2D 画布共用同一份图数据，按模式切换内容：
 *   path      两实体路径探查 -> 关系链（逐段关系 + 出处章回）
 *   strength  枢纽人物榜
 *   community 社区（团伙）画像 + 跨团伙桥接
 *   timeline  事实台账（按章回排列）
 *   flow      关系流向（来源类型 -> 关系 -> 目标类型，桑基图的读数面板）
 *   clue      情节线索（关系反转 / 死后再现 / 出场断档 / 籍贯冲突 / 意外连接），可标已读
 *   ask       沿关系网取证据作答（LearnTabs）
 *   review    待核对的事实（LearnTabs）
 *
 * 面板只负责"读线索"，不改图数据；路径结果由父组件并入画布。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Empty, Segmented, Spin, Switch, Tag, Tooltip, message } from 'antd'
import { CloseOutlined, SearchOutlined } from '@ant-design/icons'

import {
  cancelAnalysisJob,
  explorePaths,
  getAnalysisCommunities,
  getAnalysisJob,
  getAnomalies,
  getCommunityBridges,
  getEntityTimeline,
  getHubs,
  getLatestAnalysisJob,
  rebuildAnalysis,
  type AnalysisJob,
  type Anomaly,
  type CommunityBridge,
  type CommunityProfile,
  type HubEntity,
  type PathResult,
  type TimelineEntry,
} from '@/api/kg-analysis'
import { searchKnowledgeGraphEntities, type EntitySearchItem } from '@/api/knowledge-graph'
import { nodeLabel, relationLabel } from '@/utils/graphStyle'
import { displayText } from '@/utils/mathText'
import { activeProfile, displayUnitText, ruleName, terms, unitRange } from '@/graph/profile'
import i18n from '@/i18n'
import { clueTitle } from '@/i18n/clueTitle'
import { useIsMobile } from '@/hooks/useIsMobile'
import type { Citation } from '@/api/kg-learn'
import type { FlowAggregate, FlowSelection } from './flowAggregate'
import { buildLedger, LEDGER_TIME_LABEL } from './ledgerModel'
import { AskTab, ReviewTab } from './LearnTabs'

export type ExploreMode =
  | 'browse' | 'ask' | 'path' | 'strength' | 'community' | 'timeline' | 'flow' | 'clue' | 'review'

interface Props {
  mode: ExploreMode
  /** 当前探索中心：台账锚点、异常与社区聚焦的上下文 */
  anchor: { id: string; name: string } | null
  /** 时序播放游标：台账只显示"截至此刻"的事件 */
  cursorYear?: number
  /** 实体 id -> 名称/类型：台账要显示关系的对端是谁，画布上正好有这份数据 */
  resolveEntity?: (entityId: string) => { name: string; label: string } | null
  /** 流转视图的聚合结果（页面算好，画布与面板共用一份） */
  flow?: FlowAggregate
  flowSelection?: FlowSelection | null
  onFlowSelect?: (selection: FlowSelection | null) => void
  onLocate: (entityId: string) => void
  onMergeGraph: (graph: NonNullable<PathResult['graph']>) => void
  onOpenArchive: (recordId: string, claimId?: string) => void
  onOpenCitation: (citation: Citation, all: Citation[]) => void
  onClose: () => void
}

const SEVERITY_COLOR: Record<string, string> = {
  high: 'red',
  medium: 'orange',
  low: 'default',
}

/* ==================== 实体选择（路径探查两端） ==================== */

function EntityPicker({
  placeholder, value, onChange,
}: {
  placeholder: string
  value: EntitySearchItem | null
  onChange: (item: EntitySearchItem | null) => void
}) {
  const [keyword, setKeyword] = useState('')
  const [items, setItems] = useState<EntitySearchItem[]>([])
  const [open, setOpen] = useState(false)
  const seqRef = useRef(0)

  useEffect(() => {
    const kw = keyword.trim()
    const seq = ++seqRef.current
    const timer = window.setTimeout(() => {
      // 清空也要放到定时器里：在 effect 体内同步 setState 会触发级联渲染
      if (!kw) { setItems([]); return }
      searchKnowledgeGraphEntities({ keyword: kw, page_size: 8 })
        .then((res) => {
          if (seq !== seqRef.current) return
          setItems(res.data?.items || [])
          setOpen(true)
        })
        .catch(() => { if (seq === seqRef.current) setItems([]) })
    }, 260)
    return () => window.clearTimeout(timer)
  }, [keyword])

  return (
    <div className="kgap-picker">
      <SearchOutlined />
      <input
        value={value ? value.canonical_name : keyword}
        placeholder={placeholder}
        onChange={(event) => { onChange(null); setKeyword(event.target.value) }}
        onFocus={() => setOpen(true)}
      />
      {value && (
        <button
          type="button"
          className="kgap-picker-clear"
          aria-label={i18n.t('analysis.clear')}
          onClick={() => { onChange(null); setKeyword('') }}
        >
          <CloseOutlined />
        </button>
      )}
      {open && !value && items.length > 0 && (
        <div className="kgap-picker-drop">
          {items.map((item) => (
            <div
              key={item.entity_id}
              className="kgap-picker-item"
              onClick={() => { onChange(item); setOpen(false); setKeyword('') }}
            >
              <div className="kgap-picker-name">{item.canonical_name}</div>
              <div className="kgap-picker-sub">
                {nodeLabel(item.entity_type)} · 事实 {item.claim_count}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ==================== 分析任务（预计算触发与进度） ==================== */

function useAnalysisJob() {
  const [job, setJob] = useState<AnalysisJob | null>(null)
  const [busy, setBusy] = useState(false)
  const timerRef = useRef<number | null>(null)

  const poll = useCallback((jobId: string) => {
    const tick = async () => {
      try {
        const next = await getAnalysisJob(jobId)
        setJob(next)
        if (next.status === 'pending' || next.status === 'running') {
          timerRef.current = window.setTimeout(tick, 2000)
        } else {
          setBusy(false)
        }
      } catch {
        setBusy(false)
      }
    }
    tick()
  }, [])

  useEffect(() => {
    getLatestAnalysisJob()
      .then((latest) => {
        setJob(latest)
        if (latest && (latest.status === 'pending' || latest.status === 'running')) {
          setBusy(true)
          poll(latest.job_id)
        }
      })
      .catch(() => {})
    return () => { if (timerRef.current) window.clearTimeout(timerRef.current) }
  }, [poll])

  const start = useCallback(async () => {
    try {
      setBusy(true)
      const { job_id } = await rebuildAnalysis()
      poll(job_id)
    } catch (error) {
      setBusy(false)
      message.error((error as Error)?.message || i18n.t('analysis.createFail'))
    }
  }, [poll])

  const cancel = useCallback(async () => {
    if (!job) return
    try {
      await cancelAnalysisJob(job.job_id)
      setBusy(false)
    } catch { /* 任务可能刚好结束 */ }
  }, [job])

  return { job, busy, start, cancel }
}

function AnalysisJobBar({ job, busy, onStart, onCancel }: {
  job: AnalysisJob | null
  busy: boolean
  onStart: () => void
  onCancel: () => void
}) {
  const stageKey: Record<string, string> = {
    '': 'analysis.stageQueue',
    export: 'analysis.stageExport',
    edges: 'analysis.stageEdges',
    communities: 'analysis.stageCommunities',
    hubs: 'analysis.stageHubs',
    persist: 'analysis.stagePersist',
    timeline: 'analysis.stageTimeline',
    anomalies: 'analysis.stageAnomalies',
    done: 'analysis.stageDone',
  }
  const stage = job ? (stageKey[job.stage] ? i18n.t(stageKey[job.stage]) : job.stage) : ''
  const mobile = useIsMobile()
  if (mobile && !busy && job?.status === 'completed') {
    return (
      <div className="kgap-jobbar is-quiet">
        <span className="kgap-jobbar-text">{i18n.t('analysis.jobFound', { edges: job.edges.toLocaleString(), clues: job.anomalies })}</span>
        <Button type="link" size="small" onClick={onStart}>{i18n.t('analysis.recompute')}</Button>
      </div>
    )
  }
  return (
    <div className="kgap-jobbar">
      <div className="kgap-jobbar-text">
        {busy && job
          ? `${stage} · ${job.progress}%`
          : job?.status === 'completed'
            ? i18n.t('analysis.computed', { edges: job.edges, hubs: job.hubs, communities: job.communities, anomalies: job.anomalies })
            : job?.status === 'failed'
              ? i18n.t('analysis.lastFailed', { error: (job.error || '').slice(0, 60) })
              : i18n.t('analysis.notYet')}
      </div>
      {busy
        ? <Button size="small" onClick={onCancel}>{i18n.t('analysis.cancel')}</Button>
        : <Button size="small" type="primary" onClick={onStart}>{i18n.t('analysis.recompute')}</Button>}
    </div>
  )
}

/* ==================== 各模式内容 ==================== */

function PathTab({ onMergeGraph, onOpenArchive, onLocate }: {
  onMergeGraph: Props['onMergeGraph']
  onOpenArchive: Props['onOpenArchive']
  onLocate: Props['onLocate']
}) {
  const [from, setFrom] = useState<EntitySearchItem | null>(null)
  const [to, setTo] = useState<EntitySearchItem | null>(null)
  const [result, setResult] = useState<PathResult | null>(null)
  const [loading, setLoading] = useState(false)

  const run = useCallback(async () => {
    if (!from || !to) { message.warning(i18n.t('analysis.pickEnds')); return }
    setLoading(true)
    try {
      const data = await explorePaths(from.entity_id, to.entity_id, 3, 3)
      setResult(data)
      if (data.found && data.graph) {
        onMergeGraph(data.graph)
        onLocate(from.entity_id)
      }
    } catch (error) {
      message.error((error as Error)?.message || i18n.t('analysis.pathFail'))
      setResult(null)
    } finally {
      setLoading(false)
    }
  }, [from, to, onMergeGraph, onLocate])

  const gp = activeProfile()
  const typeNames = gp.ontology.entity_types.slice(0, 3).map((t) => t.name).join('、')
  return (
    <div className="kgap-body">
      <div className="kgap-hint">
        {i18n.t('analysis.pathHint', { types: typeNames, unit: gp.unit.name })}
      </div>
      <EntityPicker placeholder={i18n.t('analysis.from', { example: gp.examples?.from ? i18n.t('analysis.example', { name: gp.examples.from }) : '' })} value={from} onChange={setFrom} />
      <EntityPicker placeholder={i18n.t('analysis.to', { example: gp.examples?.to ? i18n.t('analysis.example', { name: gp.examples.to }) : '' })} value={to} onChange={setTo} />
      <Button type="primary" block loading={loading} onClick={run}>{i18n.t('analysis.trace')}</Button>

      {result && !result.found && (
        <div className="kgap-empty-note">
          <b>{i18n.t('analysis.noPath')}</b>
          <p>{result.reason}</p>
        </div>
      )}

      {result?.found && result.paths.map((path, pathIndex) => (
        <div key={pathIndex} className="kgap-path">
          <div className="kgap-path-head">
            <span>{i18n.t('analysis.pathN', { n: pathIndex + 1 })}</span>
            <span className="kgap-path-meta">
              {i18n.t('analysis.hops', { hops: path.hops, score: path.score })}
            </span>
          </div>
          {path.steps.map((step, stepIndex) => (
            <div key={stepIndex} className="kgap-hop">
              <div className="kgap-hop-line">
                <span className="kgap-hop-node">{step.from_name}</span>
                <span className={`kgap-hop-rel ${step.arrow === 'in' ? 'rev' : ''}`}>
                  {step.arrow === 'in' ? '←' : '—'}
                  {relationLabel(step.predicate)}
                  {step.arrow === 'in' ? '—' : '→'}
                </span>
                <span className="kgap-hop-node">{step.to_name}</span>
              </div>
              {step.evidence_text && (
                <div className="kgap-hop-evidence">「{displayText(step.evidence_text).slice(0, 120)}」</div>
              )}
              <div className="kgap-hop-foot">
                {step.archive_number && (
                  <Tooltip title={step.archive_title || i18n.t('analysis.viewArchive')}>
                    <span
                      className="kgap-archive"
                      onClick={() => step.record_id && onOpenArchive(step.record_id, step.claim_id)}
                    >
                      {step.archive_number}
                    </span>
                  </Tooltip>
                )}
                {step.page_no != null && <span className="kgap-hop-tag">{i18n.t('analysis.page', { page: step.page_no })}</span>}
                <span className="kgap-hop-tag">{i18n.t('analysis.confShort', { value: step.confidence.toFixed(2) })}</span>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

function StrengthTab({ onLocate }: { onLocate: Props['onLocate'] }) {
  const { job, busy, start, cancel } = useAnalysisJob()
  const [hubs, setHubs] = useState<HubEntity[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    getHubs('', 30)
      .then((res) => setHubs(res.items))
      .catch(() => setHubs([]))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load, job?.status])

  return (
    <div className="kgap-body">
      <AnalysisJobBar job={job} busy={busy} onStart={start} onCancel={cancel} />
      <div className="kgap-hint">
        {terms().hub} = 关联强度（加权度）x 跨{terms().community}度。排名靠前的是串起多条线索的核心{terms().primary}。
      </div>
      {loading ? <Spin /> : hubs.length === 0 ? (
        <Empty description={i18n.t('analysis.noHubs')} image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <div className="kgap-hubs">
          {hubs.map((hub) => (
            <div key={hub.entity_id} className="kgap-hub" onClick={() => onLocate(hub.entity_id)}>
              <span className="kgap-hub-rank">{hub.rank_no}</span>
              <div className="kgap-hub-main">
                <div className="kgap-hub-name">{hub.canonical_name}</div>
                <div className="kgap-hub-sub">
                  {nodeLabel(hub.entity_type)} · 强度 {hub.weighted_degree.toFixed(2)}
                  {hub.community_span > 0 ? i18n.t('analysis.span', { count: hub.community_span, community: terms().community }) : ''}
                </div>
              </div>
              <div className="kgap-hub-bar">
                <span style={{ width: `${Math.min(hub.hub_score, 1) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function CommunityTab({ onLocate }: { onLocate: Props['onLocate'] }) {
  const { job, busy, start, cancel } = useAnalysisJob()
  const [communities, setCommunities] = useState<CommunityProfile[]>([])
  const [active, setActive] = useState<CommunityProfile | null>(null)
  const [bridges, setBridges] = useState<CommunityBridge[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getAnalysisCommunities(120)
      .then((res) => setCommunities(res.items))
      .catch(() => setCommunities([]))
      .finally(() => setLoading(false))
  }, [job?.status])

  const openCommunity = useCallback((profile: CommunityProfile) => {
    setActive(profile)
    setBridges([])
    getCommunityBridges(profile.community_key, 20)
      .then((res) => setBridges(res.items))
      .catch(() => setBridges([]))
  }, [])

  return (
    <div className="kgap-body">
      <AnalysisJobBar job={job} busy={busy} onStart={start} onCancel={cancel} />
      {loading ? <Spin /> : communities.length === 0 ? (
        <Empty description={i18n.t('analysis.noCommunities')} image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <div className="kgap-communities">
          {communities.map((profile) => (
            <div
              key={profile.community_key}
              className={`kgap-community ${active?.community_key === profile.community_key ? 'on' : ''}`}
              onClick={() => openCommunity(profile)}
            >
              <div className="kgap-community-name">{profile.name || profile.rep_name}</div>
              <div className="kgap-community-sub">
                {profile.size} 个实体
                {profile.year_from ? ` · ${unitRange(profile.year_from, profile.year_to || profile.year_from)}` : ''}
                {profile.rep_name ? ` · ${profile.rep_name}` : ''}
              </div>
            </div>
          ))}
        </div>
      )}

      {active && (
        <div className="kgap-bridges">
          <div className="kgap-sec-title">{i18n.t('analysis.crossTitle', { community: terms().community })}</div>
          {bridges.length === 0 && <div className="kgap-empty-note">{i18n.t('analysis.crossEmpty', { community: terms().community })}</div>}
          {bridges.map((bridge) => (
            <div key={bridge.id} className="kgap-bridge">
              <span
                className="kgap-bridge-node"
                onClick={() => onLocate(bridge.src_entity_id)}
              >
                {bridge.src_name || bridge.src_entity_id}
              </span>
              <span className="kgap-bridge-rel">{relationLabel(bridge.predicate)}</span>
              <span
                className="kgap-bridge-node"
                onClick={() => onLocate(bridge.dst_entity_id)}
              >
                {bridge.dst_name || bridge.dst_entity_id}
              </span>
              <span className="kgap-bridge-weight">{i18n.t('analysis.strength', { value: bridge.weight.toFixed(2) })}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** 看过的线索按图谱记在本机；anomaly_id 由规则与证据决定，重算后不变 */
function useReadClues() {
  const key = `kg-clue-read:${activeProfile().id}`
  const [read, setRead] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(key) || '[]') as string[])
    } catch {
      return new Set()
    }
  })
  const mark = useCallback((id: string, on: boolean) => {
    setRead((prev) => {
      if (prev.has(id) === on) return prev
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      try {
        localStorage.setItem(key, JSON.stringify([...next].slice(-3000)))
      } catch {
        /* 隐私模式下存不了就只在本次会话里记 */
      }
      return next
    })
  }, [key])
  return { read, mark }
}

function ClueTab({ anchor, onLocate, onOpenArchive }: {
  anchor: Props['anchor']
  onLocate: Props['onLocate']
  onOpenArchive: Props['onOpenArchive']
}) {
  const { job, busy, start, cancel } = useAnalysisJob()
  const [rule, setRule] = useState<string>('all')
  const [items, setItems] = useState<Anomaly[]>([])
  const [loading, setLoading] = useState(true)
  const { read, mark } = useReadClues()
  const [hideRead, setHideRead] = useState(false)
  const readCount = items.filter((item) => read.has(item.anomaly_id)).length
  const shown = hideRead ? items.filter((item) => !read.has(item.anomaly_id)) : items

  useEffect(() => {
    getAnomalies({
      rule_code: rule === 'all' ? '' : rule,
      anchor_id: anchor?.id || '',
      limit: 60,
    })
      .then((res) => setItems(res.items))
      .catch(() => setItems([]))
      .finally(() => setLoading(false))
  }, [rule, anchor?.id, job?.status])

  return (
    <div className="kgap-body">
      <AnalysisJobBar job={job} busy={busy} onStart={start} onCancel={cancel} />
      <Segmented
        size="small"
        className="kgap-scroll-seg"
        value={rule}
        onChange={(value) => setRule(String(value))}
        options={[
          { label: i18n.t('common.all'), value: 'all' },
          ...Object.entries(activeProfile().rules).map(([code, r]) => ({
            label: <Tooltip title={r.hint}>{r.name}</Tooltip>,
            value: code,
          })),
        ]}
      />
      {anchor && <div className="kgap-hint">{i18n.t('analysis.clueScope', { name: anchor.name })}</div>}
      {!loading && readCount > 0 && (
        <div className="kgap-clue-bar">
          <span>{i18n.t('clue.readCount', { count: readCount })}</span>
          <label>
            <Switch size="small" checked={hideRead} onChange={setHideRead} /> {i18n.t('clue.hideRead')}
          </label>
        </div>
      )}
      {loading ? <Spin /> : shown.length === 0 ? (
        <Empty description={i18n.t('analysis.noClues')} image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <div className="kgap-clues">
          {shown.map((item) => (
            <div
              key={item.anomaly_id}
              className={`kgap-clue ${read.has(item.anomaly_id) ? 'is-read' : ''}`}
              onClick={() => { mark(item.anomaly_id, true); onLocate(item.anchor_entity_id) }}
            >
              <div className="kgap-clue-head">
                <Tag color={SEVERITY_COLOR[item.severity]}>{ruleName(item.rule_code)}</Tag>
                <span className="kgap-clue-title">{clueTitle(item)}</span>
              </div>
              <div className="kgap-clue-sub">
                {item.anchor_name || item.anchor_entity_id}
                {item.archive_number ? ` · ${displayUnitText(item.archive_number)}` : ''}
              </div>
              {item.evidence_text && (
                <div className="kgap-hop-evidence">「{displayText(item.evidence_text).slice(0, 100)}」</div>
              )}
              <div className="kgap-clue-foot">
                {item.record_id && (
                  <Button
                    size="small"
                    type="link"
                    onClick={(event) => {
                      event.stopPropagation()
                      mark(item.anomaly_id, true)
                      onOpenArchive(item.record_id, item.claim_id)
                    }}
                  >
                    {i18n.t('analysis.viewArchive')}
                  </Button>
                )}
                <Button
                  size="small"
                  type="text"
                  onClick={(event) => { event.stopPropagation(); mark(item.anomaly_id, !read.has(item.anomaly_id)) }}
                >
                  {read.has(item.anomaly_id) ? i18n.t('clue.markUnread') : i18n.t('clue.markRead')}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ==================== 事件台账 ==================== */

type LedgerFilter = 'all' | 'event' | 'doc'

/** 空展开集：换锚点后不复用上一份展开记录（避免用一个 effect 去清 state） */
const NO_EXPANDED: Set<string> = new Set()
/** 空台账：没有数据时给一个稳定引用，免得下游 memo 每帧重算 */
const NO_TIMELINE: TimelineEntry[] = []

function TimelineTab({
  anchor, cursorYear, resolveEntity, onOpenArchive,
}: {
  anchor: Props['anchor']
  cursorYear?: number
  resolveEntity?: Props['resolveEntity']
  onOpenArchive: Props['onOpenArchive']
}) {
  /**
   * 台账数据带上"这是哪个锚点的结果"：锚点换了而请求还没回来时，
   * 派生出的 loading 自动为真，不需要在 effect 里 setLoading(true) 触发级联渲染。
   */
  const [fetched, setFetched] = useState<{ anchorId: string; items: TimelineEntry[] } | null>(null)
  const [filter, setFilter] = useState<LedgerFilter>('all')
  const [expanded, setExpanded] = useState<{ anchorId: string; keys: Set<string> }>({
    anchorId: '',
    keys: NO_EXPANDED,
  })
  const anchorId = anchor?.id

  useEffect(() => {
    if (!anchorId) return undefined
    let alive = true
    getEntityTimeline(anchorId, 0, 0, 500)
      .then((res) => { if (alive) setFetched({ anchorId, items: res.items }) })
      .catch(() => { if (alive) setFetched({ anchorId, items: [] }) })
    return () => { alive = false }
  }, [anchorId])

  const loaded = fetched?.anchorId === anchorId
  const loading = Boolean(anchorId) && !loaded
  const items = loaded && fetched ? fetched.items : NO_TIMELINE
  const expandedKeys = expanded.anchorId === anchorId ? expanded.keys : NO_EXPANDED

  /** 台账的数据成形（分栏、归并、游标过滤）都在 ledgerModel 里，组件只负责画 */
  const ledger = useMemo(() => buildLedger({
    items,
    anchorId: anchorId || '',
    resolveEntity,
    cursorYear,
  }), [items, anchorId, resolveEntity, cursorYear])
  const { groups } = ledger

  const toggleDoc = (key: string) => {
    const next = new Set(expandedKeys)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setExpanded({ anchorId: anchorId || '', keys: next })
  }

  if (!anchor) {
    return (
      <div className="kgap-body">
        <Empty
          description={i18n.t('analysis.ledgerPrompt')}
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        />
      </div>
    )
  }

  const showEvents = filter !== 'doc'
  const showDocs = filter !== 'event'
  const hasAny = groups.some((group) => (
    (showEvents && group.events.length > 0) || (showDocs && group.docs.length > 0)
  ))

  return (
    <div className="kgap-body">
      <div className="kgap-hint">
        <b>{anchor.name}</b>{i18n.t('analysis.ledgerHead', { count: ledger.total, axis: activeProfile().unit.axis })}
        {i18n.t('analysis.ledgerPlay', { unit: activeProfile().unit.name })}
      </div>

      {loading ? <Spin /> : !hasAny ? (
        <Empty
          description={ledger.total === 0 ? i18n.t('analysis.noTimed') : i18n.t('analysis.noneHere')}
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        />
      ) : (
        <div className="kgap-timeline">
          {groups.map((group) => {
            const events = showEvents ? group.events : []
            const docs = showDocs ? group.docs : []
            if (!events.length && !docs.length) return null
            return (
              <div key={group.key} className="kgap-tlg">
                <div className="kgap-tlg-head">
                  <span>{group.title}</span>
                  <span className="kgap-tlg-count">
                    {/* 计数跟着当前筛选走，避免筛了"只看证据"却还报事项条数 */}
                    {events.length ? i18n.t('analysis.factRows', { count: events.length }) : ''}
                    {events.length && docs.length ? ' · ' : ''}
                    {docs.length ? i18n.t('analysis.docRows', { count: docs.length }) : ''}
                  </span>
                </div>

                {events.length > 0 && (
                  <>
                    {events.map((row) => (
                      <div key={row.id} className="kgap-tl-row">
                        <div className="kgap-tl-main">
                          <div className="kgap-tl-title">
                            {!row.counterpartIsTime && (
                              <span className="kgap-tl-arrow" title={i18n.t('analysis.pointsTo')}>→</span>
                            )}
                            <span className={row.counterpartMissing ? 'kgap-tl-name missing' : 'kgap-tl-name'}>
                              {row.counterpartName}
                            </span>
                          </div>
                          <div className="kgap-tl-meta">
                            {!row.counterpartIsTime && (
                              <span className="kgap-tl-rel">{relationLabel(row.predicate)}</span>
                            )}
                            {row.recordId && (
                              <span
                                className="kgap-archive"
                                title={i18n.t('analysis.openEvidence', { archive: displayUnitText(row.archiveNumber), confidence: row.confidence.toFixed(2) })}
                                onClick={() => onOpenArchive(row.recordId, row.claimId)}
                              >
                                原文
                              </span>
                            )}
                          </div>
                          {row.evidence && (
                            <div className="kgap-tl-ev" title={row.evidence}>
                              「{row.evidence.slice(0, 120)}」
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </>
                )}

                {docs.length > 0 && (
                  <>
                    <div className="kgap-tlg-sec doc">{i18n.t('analysis.sources')}</div>
                    {docs.map((doc) => {
                      const opened = expandedKeys.has(`${group.key}:${doc.key}`)
                      const itemsOfDoc = doc.rows
                      const single = itemsOfDoc.length === 1
                      return (
                        <div key={doc.key} className="kgap-tld">
                          <div
                            className={`kgap-tld-head ${single ? 'single' : ''}`}
                            onClick={() => !single && toggleDoc(`${group.key}:${doc.key}`)}
                          >
                            <span
                              className="kgap-archive"
                              title={doc.recordId ? i18n.t('analysis.openDoc') : undefined}
                              onClick={(event) => {
                                event.stopPropagation()
                                if (doc.recordId) onOpenArchive(doc.recordId)
                              }}
                            >
                              {doc.archiveNumber ? displayUnitText(doc.archiveNumber) : i18n.t('analysis.noArchive')}
                            </span>
                            <span className="kgap-hop-tag">{i18n.t('analysis.docDate', { date: doc.docDate || '—' })}</span>
                            {!single && <span className="kgap-tld-count">{i18n.t('analysis.itemCount', { count: itemsOfDoc.length })}</span>}
                            {!single && <span className="kgap-tld-toggle">{opened ? '▾' : '▸'}</span>}
                          </div>
                          {(single || opened) && itemsOfDoc.map((row) => (
                            <div key={row.id} className="kgap-tld-item">
                              <div className="kgap-tl-meta">
                                <span className="kgap-tl-rel">{relationLabel(row.predicate)}</span>
                                <span className={row.counterpartMissing ? 'kgap-tl-name missing' : 'kgap-tl-name'}>
                                  {row.counterpartName}
                                </span>
                              </div>
                              {row.evidence && (
                                <div className="kgap-tl-ev" title={row.evidence}>
                                  「{row.evidence.slice(0, 120)}」
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )
                    })}
                  </>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ==================== 关系流向（桑基图的读数面板） ==================== */

function FlowTab({
  flow, selection, onSelect, onLocate,
}: {
  flow: FlowAggregate
  selection: FlowSelection | null
  onSelect: (selection: FlowSelection | null) => void
  onLocate: Props['onLocate']
}) {
  /** 选中某个关系/实体时，列表收敛到相关流向；选中单条流向时只看它 */
  const groups = useMemo(() => {
    if (!selection) return flow.groups
    if (selection.kind === 'group') return flow.groups.filter((item) => item.key === selection.key)
    if (selection.kind === 'predicate') {
      return flow.groups.filter((item) => item.predicate === selection.key)
    }
    return flow.groups.filter((item) => (
      selection.kind === 'src' ? item.srcId === selection.key : item.dstId === selection.key
    ))
  }, [flow.groups, selection])

  const max = groups.reduce((value, group) => Math.max(value, group.value), 0) || 1
  /** 选中项的读法：直接把流向写成"来源 —关系→ 去向"，比"已选：单条流向"有用 */
  const selectionText = useMemo(() => {
    if (!selection) return ''
    if (selection.kind === 'predicate') return i18n.t('analysis.relNamed', { name: relationLabel(selection.key) })
    if (selection.kind === 'group') {
      const group = flow.groups.find((item) => item.key === selection.key)
      return group
        ? `${group.srcName} —${relationLabel(group.predicate)}→ ${group.dstName}`
        : i18n.t('analysis.singleFlow')
    }
    const groupsOfEntity = selection.kind === 'src'
      ? flow.groups.filter((item) => item.srcId === selection.key)
      : flow.groups.filter((item) => item.dstId === selection.key)
    const name = groupsOfEntity[0]
      ? (selection.kind === 'src' ? groupsOfEntity[0].srcName : groupsOfEntity[0].dstName)
      : selection.key
    return i18n.t('analysis.entityEnd', {
      side: selection.kind === 'src' ? i18n.t('analysis.srcSide') : i18n.t('analysis.dstSide'),
      name,
    })
  }, [selection, flow.groups])

  if (flow.empty) {
    return (
      <div className="kgap-body">
        <Empty
          description={i18n.t('analysis.noAgg')}
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        />
      </div>
    )
  }

  return (
    <div className="kgap-body">
      <div className="kgap-hint">
        {i18n.t('analysis.flowHint')}
      </div>
      <div className="kgap-flow-sum">
        {i18n.t('analysis.flowSum', { links: flow.totalLinks, entities: flow.totalEntities, facts: flow.totalValue })}
        {flow.droppedLinks > 0
          ? i18n.t('analysis.flowTrim', { groups: flow.groups.length, links: flow.droppedLinks, entities: flow.droppedEntities })
          : ''}
      </div>

      {selection && (
        <div className="kgap-flow-active">
          <span>{i18n.t('analysis.selected', { text: selectionText })}</span>
          <Button size="small" type="link" onClick={() => onSelect(null)}>{i18n.t('analysis.clear')}</Button>
        </div>
      )}

      {groups.length === 0 ? (
        <Empty description={i18n.t('analysis.noFlowMatch')} image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <div className="kgap-flows">
          {groups.map((group) => (
            <div
              key={group.key}
              className={`kgap-flow ${selection?.kind === 'group' && selection.key === group.key ? 'on' : ''}`}
              onClick={() => onSelect({ kind: 'group', key: group.key })}
            >
              <div className="kgap-flow-line">
                <span
                  className="kgap-flow-name"
                  title={`${group.srcName}（${nodeLabel(group.srcLabel)}）`}
                  onClick={(event) => { event.stopPropagation(); onLocate(group.srcId) }}
                >
                  {group.srcName}
                </span>
                <span className="kgap-flow-rel">{relationLabel(group.predicate)}</span>
                <span
                  className="kgap-flow-name"
                  title={`${group.dstName}（${nodeLabel(group.dstLabel)}）`}
                  onClick={(event) => { event.stopPropagation(); onLocate(group.dstId) }}
                >
                  {group.dstName}
                </span>
                <span className="kgap-flow-value">{group.value}</span>
              </div>
              <div className="kgap-flow-bar">
                <span style={{ width: `${(group.value / max) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ==================== 外壳 ==================== */

const TITLES: Record<ExploreMode, string> = {
  browse: '',
  ask: i18n.t('analysis.tabAsk'),
  review: i18n.t('analysis.tabReview'),
  path: i18n.t('analysis.tabPath'),
  strength: i18n.t('analysis.tabStrength'),
  community: i18n.t('analysis.tabCommunity'),
  timeline: i18n.t('analysis.tabTimeline'),
  flow: i18n.t('analysis.tabFlow'),
  clue: i18n.t('analysis.tabClue'),
}

export default function AnalysisPanel({
  mode, anchor, cursorYear, resolveEntity, flow, flowSelection, onFlowSelect,
  onLocate, onMergeGraph, onOpenArchive, onOpenCitation, onClose,
}: Props) {
  if (mode === 'browse') return null
  return (
    <div className="kgap-panel">
      <div className="kgap-head">
        <h3>{TITLES[mode]}</h3>
        <button type="button" className="kgap-close" onClick={onClose} aria-label={i18n.t('analysis.close')}><CloseOutlined /></button>
      </div>
      {mode === 'path' && (
        <PathTab onMergeGraph={onMergeGraph} onOpenArchive={onOpenArchive} onLocate={onLocate} />
      )}
      {mode === 'strength' && <StrengthTab onLocate={onLocate} />}
      {mode === 'community' && <CommunityTab onLocate={onLocate} />}
      {mode === 'timeline' && (
        <TimelineTab
          anchor={anchor}
          cursorYear={cursorYear}
          resolveEntity={resolveEntity}
          onOpenArchive={onOpenArchive}
        />
      )}
      {mode === 'flow' && flow && (
        <FlowTab
          flow={flow}
          selection={flowSelection || null}
          onSelect={(selection) => onFlowSelect?.(selection)}
          onLocate={onLocate}
        />
      )}
      {mode === 'clue' && (
        <ClueTab anchor={anchor} onLocate={onLocate} onOpenArchive={onOpenArchive} />
      )}
      {mode === 'ask' && <AskTab onLocate={onLocate} onCite={onOpenCitation} />}
      {mode === 'review' && <ReviewTab onOpenArchive={onOpenArchive} />}
    </div>
  )
}
