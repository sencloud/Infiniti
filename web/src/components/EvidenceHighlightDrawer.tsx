import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Card, Drawer, Empty, Image, Segmented, Space, Spin, Tag, Tooltip, Typography, message } from 'antd'
import { LeftOutlined, RightOutlined } from '@ant-design/icons'

import {
  getArchiveEvidence,
  type ArchiveEvidence,
  type ArchiveEvidenceClaim,
  type Ontology,
} from '@/api/knowledge-graph'
import { activeProfile } from '@/graph/profile'
import { useIsMobile } from '@/hooks/useIsMobile'
import { claimStatusLabel, nodeLabel, relationLabel } from '@/utils/graphStyle'
import { displayText } from '@/utils/mathText'
import VideoModal, { type VideoTarget } from './VideoModal'
import './evidenceDrawer.css'

export interface EvidenceStop {
  recordId: string
  claimId: string
}

interface Props {
  /** 单元 ch-003 或片段 s-003-07，后端都能定位到对应的单元 */
  recordId: string | null
  /** 打开时定位到这条事实的证据 */
  focusClaimId?: string | null
  /** 额外要标出的一段原文（语义星图里点中的片段） */
  highlightText?: string | null
  /** 一段关系的全部依据（可跨单元）；给了就只在这些依据间「上一处 / 下一处」 */
  trail?: EvidenceStop[] | null
  onStep?: (stop: EvidenceStop) => void
  ontology?: Ontology | null
  onClose: () => void
}

interface Segment {
  text: string
  claimIds: string[]
  focus: boolean
}

interface Span {
  start: number
  end: number
  claimId?: string
}

/** 把正文按证据区间切成普通段与高亮段；区间可能重叠，先按端点扫描再切 */
function buildSegments(content: string, claims: ArchiveEvidenceClaim[], extra: Span[]): Segment[] {
  const spans: Span[] = claims
    .filter((claim) => claim.offset_valid)
    .map((claim) => ({
      start: claim.evidence_start as number,
      end: claim.evidence_end as number,
      claimId: claim.claim_id,
    }))
  spans.push(...extra)
  if (!spans.length) return [{ text: content, claimIds: [], focus: false }]

  const boundaries = new Set<number>([0, content.length])
  spans.forEach((span) => {
    boundaries.add(span.start)
    boundaries.add(span.end)
  })
  const points = Array.from(boundaries).sort((a, b) => a - b)

  const segments: Segment[] = []
  for (let i = 0; i < points.length - 1; i += 1) {
    const [from, to] = [points[i], points[i + 1]]
    if (from >= to) continue
    const covering = spans.filter((span) => span.start <= from && span.end >= to)
    segments.push({
      text: content.slice(from, to),
      claimIds: covering.map((span) => span.claimId).filter(Boolean) as string[],
      focus: covering.some((span) => !span.claimId),
    })
  }
  return segments
}

/** 模型摘录常用「……」省略中间，按首尾两段在正文里找出大致范围 */
function approximateSpan(content: string, claim: ArchiveEvidenceClaim): Span | null {
  const parts = (claim.evidence_text || '')
    .split(/…+|\.{3,}/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 4)
  if (!parts.length) return null
  const start = content.indexOf(parts[0])
  if (start < 0) return null
  const last = parts[parts.length - 1]
  const lastAt = parts.length > 1 ? content.indexOf(last, start + parts[0].length) : -1
  const end = lastAt >= 0 && lastAt - start < 2000 ? lastAt + last.length : start + parts[0].length
  return { start, end, claimId: claim.claim_id }
}

type View = 'text' | 'claims' | 'pages'

function EvidenceHighlightDrawer({ recordId, focusClaimId, highlightText, trail, onStep, ontology, onClose }: Props) {
  const [data, setData] = useState<ArchiveEvidence | null>(null)
  const [loading, setLoading] = useState(false)
  const [activeClaimId, setActiveClaimId] = useState<string | null>(null)
  const [view, setView] = useState<View>('text')
  const [video, setVideo] = useState<VideoTarget | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const pagesRef = useRef<HTMLDivElement>(null)
  const mobile = useIsMobile()
  const unitName = activeProfile().unit.name

  const predicateName = useCallback((code: string) => (
    ontology?.predicates.find((item) => item.code === code)?.name
    || relationLabel(code)
  ), [ontology])

  useEffect(() => {
    if (!recordId) {
      setData(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setView('text')
    getArchiveEvidence(recordId)
      .then((response) => {
        if (cancelled) return
        setData(response?.data || null)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        message.error(error instanceof Error ? error.message : '加载原文失败')
        setData(null)
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [recordId])

  useEffect(() => {
    setActiveClaimId(focusClaimId || null)
  }, [focusClaimId, data])

  const claims = useMemo(() => data?.claims || [], [data])
  const activeClaim = claims.find((claim) => claim.claim_id === activeClaimId) || null

  const focusSpan = useMemo<Span | null>(() => {
    const text = highlightText || data?.focus_text
    if (!data || !text) return null
    const start = data.content.indexOf(text)
    return start >= 0 ? { start, end: start + text.length } : null
  }, [data, highlightText])

  const approxSpan = useMemo(
    () => (data && activeClaim && !activeClaim.offset_valid ? approximateSpan(data.content, activeClaim) : null),
    [data, activeClaim],
  )

  const segments = useMemo(
    () => (data
      ? buildSegments(data.content, data.claims, [focusSpan, approxSpan].filter(Boolean) as Span[])
      : []),
    [data, focusSpan, approxSpan],
  )

  // 抽屉滑入动画期间平滑滚动会被打断：新单元第一次定位用瞬时滚动，之后在同一单元里切换才平滑
  const positionedFor = useRef<ArchiveEvidence | null>(null)
  useEffect(() => {
    const box = contentRef.current
    if (!box) return
    const timer = setTimeout(() => {
      const el = box.querySelector(activeClaimId ? '[data-active="1"]' : '[data-focus="1"]')
      const fresh = positionedFor.current !== data
      positionedFor.current = data
      if (!el) {
        if (fresh) box.scrollTo({ top: 0 })
        return
      }
      const r = el.getBoundingClientRect()
      const br = box.getBoundingClientRect()
      box.scrollTo({
        top: box.scrollTop + r.top - br.top - (box.clientHeight - r.height) / 2,
        behavior: fresh ? 'auto' : 'smooth',
      })
    }, 350)
    return () => clearTimeout(timer)
  }, [activeClaimId, segments, view, data])

  const pages = data?.pages || []
  const focusPage = data?.focus_page ?? null

  useEffect(() => {
    if (view !== 'pages' || focusPage == null) return
    const timer = setTimeout(() => {
      pagesRef.current?.querySelector(`[data-page="${focusPage}"]`)?.scrollIntoView({ block: 'start' })
    }, 120)
    return () => clearTimeout(timer)
  }, [view, focusPage])

  const unlocated = claims.filter((claim) => !claim.offset_valid).length

  // 手机阅读器的「上一处 / 下一处」：有关系依据链就沿着它走（可跨单元），否则按原文顺序走本单元能高亮的证据
  const located = useMemo(() => {
    const seen = new Set<number>()
    return claims
      .filter((claim) => claim.offset_valid)
      .sort((a, b) => (a.evidence_start as number) - (b.evidence_start as number))
      .filter((claim) => {
        const start = claim.evidence_start as number
        if (seen.has(start)) return false
        seen.add(start)
        return true
      })
  }, [claims])
  const useTrail = !!trail && trail.length > 1 && !!onStep
  const stopCount = useTrail ? trail.length : located.length
  const activeIndex = useTrail
    ? trail.findIndex((stop) => stop.claimId === activeClaimId)
    : activeClaim
      ? located.findIndex((claim) => claim.evidence_start === activeClaim.evidence_start)
      : -1
  const step = (delta: number) => {
    if (!stopCount) return
    const next = activeIndex < 0
      ? (delta > 0 ? 0 : stopCount - 1)
      : (activeIndex + delta + stopCount) % stopCount
    setView('text')
    if (useTrail) onStep(trail[next])
    else setActiveClaimId(located[next].claim_id)
  }

  const pickClaim = (claimId: string) => {
    setActiveClaimId(claimId)
    if (mobile) setView('text')
  }

  const textPane = (
    <div className="evd-text-pane">
      {mobile && activeClaim && (
        <div className="evd-context" aria-live="polite">
          <div className="evd-context-rel">
            <b>{displayText(activeClaim.subject.name)}</b>
            <span>{predicateName(activeClaim.predicate)}</span>
            <b>{displayText(activeClaim.object.name)}</b>
          </div>
          <div className="evd-context-meta">
            {claimStatusLabel(activeClaim.status)} · 置信度 {Math.round((activeClaim.confidence || 0) * 100)}%
            {!activeClaim.offset_valid && (approxSpan ? ' · 按摘录首尾定位' : ' · 原文中没有逐字对应')}
          </div>
        </div>
      )}
      {unlocated > 0 && !mobile && (
        <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 8 }}>
          {unlocated} 条事实的证据是模型概括的，原文中没有逐字对应，无法高亮。
        </Typography.Paragraph>
      )}
      <div ref={contentRef} className="evd-text">
        {segments.map((segment, index) => {
          if (!segment.claimIds.length) {
            return (
              <span key={index} data-focus={segment.focus ? '1' : undefined} className={segment.focus ? 'evd-focus' : undefined}>
                {displayText(segment.text)}
              </span>
            )
          }
          const isActive = !!activeClaimId && segment.claimIds.includes(activeClaimId)
          const mark = (
            <mark
              key={index}
              data-claim={segment.claimIds[0]}
              data-active={isActive ? '1' : undefined}
              data-focus={segment.focus ? '1' : undefined}
              onClick={() => setActiveClaimId(segment.claimIds[0])}
              className={`evd-mark${isActive ? ' is-active' : ''}${segment.focus ? ' evd-focus' : ''}`}
            >
              {displayText(segment.text)}
            </mark>
          )
          return mobile ? mark : (
            <Tooltip key={index} title={`${segment.claimIds.length} 条事实引用了这段原文，点击查看`}>
              {mark}
            </Tooltip>
          )
        })}
      </div>
    </div>
  )

  const claimsPane = (
    <div className="evd-claims-pane">
      {claims.length ? claims.map((claim) => (
        <Card
          key={claim.claim_id}
          size="small"
          hoverable
          className={`evd-claim${activeClaimId === claim.claim_id ? ' is-active' : ''}`}
          onClick={() => pickClaim(claim.claim_id)}
        >
          <Space wrap size={4}>
            <Tag>{nodeLabel(claim.subject.type)}</Tag>
            <b>{displayText(claim.subject.name)}</b>
            <span>{predicateName(claim.predicate)}</span>
            <Tag>{nodeLabel(claim.object.type)}</Tag>
            <b>{displayText(claim.object.name)}</b>
          </Space>
          {claim.evidence_text && <div className="evd-claim-quote">「{displayText(claim.evidence_text)}」</div>}
          <div style={{ marginTop: 6 }}>
            <Space size={4} wrap>
              <Tag color="green">{claimStatusLabel(claim.status)}</Tag>
              <Tag>置信度 {Math.round((claim.confidence || 0) * 100)}%</Tag>
              {!claim.offset_valid && <Tag>原文未逐字命中</Tag>}
            </Space>
          </div>
        </Card>
      )) : <Empty description={`这一${unitName}没有抽取到事实`} />}
    </div>
  )

  const pagesPane = (
    <div ref={pagesRef} className="evd-pages-pane">
      <Image.PreviewGroup>
        {pages.map((p) => (
          <figure key={p.page} data-page={p.page} className={`evd-page${p.page === focusPage ? ' is-focus' : ''}`}>
            <Image src={p.image} alt={`第 ${p.page} 页`} loading="lazy" />
            <figcaption>第 {p.page} 页{p.page === focusPage ? ' · 当前片段' : ''}</figcaption>
          </figure>
        ))}
      </Image.PreviewGroup>
    </div>
  )

  const viewOptions = [
    { label: '原文', value: 'text' },
    ...(mobile ? [{ label: `本${unitName}关系 ${claims.length}`, value: 'claims' }] : []),
    ...(pages.length ? [{ label: `教材原页 ${pages.length}`, value: 'pages' }] : []),
  ]

  return (
    <Drawer
      open={!!recordId}
      onClose={onClose}
      width={mobile ? '100%' : 1080}
      placement={mobile ? 'bottom' : 'right'}
      height={mobile ? '100%' : undefined}
      rootClassName="evd-drawer"
      title={mobile && data ? (
        <div className="evd-m-title">
          {data.archive_number && !data.title?.startsWith(data.archive_number) && <small>{data.archive_number}</small>}
          <span>{displayText(data.title || '')}</span>
        </div>
      ) : data ? `${data.archive_number || ''} ${data.title || ''}`.trim() : '原文'}
      extra={data?.url ? (
        <Typography.Link href={data.url} target="_blank" rel="noreferrer">{mobile ? '出处' : '来源页面'}</Typography.Link>
      ) : null}
      footer={mobile && stopCount > 0 && view === 'text' ? (
        <div className="evd-stepper">
          <button type="button" onClick={() => step(-1)} aria-label="上一处高亮">
            <LeftOutlined /> 上一处
          </button>
          <span aria-live="polite">{activeIndex < 0 ? `共 ${stopCount} 处` : `${activeIndex + 1} / ${stopCount}`}</span>
          <button type="button" className="main" onClick={() => step(1)} aria-label="下一处高亮">
            下一处 <RightOutlined />
          </button>
        </div>
      ) : null}
    >
      <Spin spinning={loading}>
        {!data ? <Empty description="暂无数据" /> : (
          <>
            {!!data.media?.episodes?.length && (
              <div className="evd-episodes">
                <span>影视对照</span>
                <div className="ep-chips">
                  {data.media.episodes.map((ep) => (
                    <button
                      type="button"
                      key={ep.ep}
                      className="ep-chip"
                      onClick={() => setVideo({ bvid: ep.bvid, page: ep.page, title: `第${ep.ep}集 ${ep.title}` })}
                    >
                      央视版第{ep.ep}集 {ep.title}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {(viewOptions.length > 1) && (
              <div className="evd-switch">
                <Segmented size={mobile ? 'large' : 'small'} block={mobile} value={view} onChange={(v) => setView(v as View)} options={viewOptions} />
                {focusPage != null && <span className="evd-page-hint">片段位于教材第 {focusPage} 页</span>}
              </div>
            )}
            {view === 'pages' ? pagesPane : mobile ? (view === 'claims' ? claimsPane : textPane) : (
              <div className="evd-body">
                {textPane}
                {claimsPane}
              </div>
            )}
          </>
        )}
      </Spin>
      <VideoModal target={video} onClose={() => setVideo(null)} />
    </Drawer>
  )
}

export default EvidenceHighlightDrawer
