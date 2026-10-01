import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Card, Drawer, Empty, Image, Segmented, Space, Spin, Tag, Tooltip, Typography, message } from 'antd'

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

interface Props {
  /** 单元 ch-003 或片段 s-003-07，后端都能定位到对应的单元 */
  recordId: string | null
  /** 打开时定位到这条事实的证据 */
  focusClaimId?: string | null
  /** 额外要标出的一段原文（语义星图里点中的片段） */
  highlightText?: string | null
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
function buildSegments(content: string, claims: ArchiveEvidenceClaim[], focusSpan: Span | null): Segment[] {
  const spans: Span[] = claims
    .filter((claim) => claim.offset_valid)
    .map((claim) => ({
      start: claim.evidence_start as number,
      end: claim.evidence_end as number,
      claimId: claim.claim_id,
    }))
  if (focusSpan) spans.push(focusSpan)
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

type View = 'text' | 'claims' | 'pages'

function EvidenceHighlightDrawer({ recordId, focusClaimId, highlightText, ontology, onClose }: Props) {
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
        setActiveClaimId(focusClaimId || null)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        message.error(error instanceof Error ? error.message : '加载原文失败')
        setData(null)
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [recordId, focusClaimId])

  const focusSpan = useMemo<Span | null>(() => {
    const text = highlightText || data?.focus_text
    if (!data || !text) return null
    const start = data.content.indexOf(text)
    return start >= 0 ? { start, end: start + text.length } : null
  }, [data, highlightText])

  const segments = useMemo(
    () => (data ? buildSegments(data.content, data.claims, focusSpan) : []),
    [data, focusSpan],
  )

  // 抽屉滑入动画期间 scrollIntoView 会被打断，延后并直接滚动正文容器
  useEffect(() => {
    const box = contentRef.current
    if (!box) return
    const timer = setTimeout(() => {
      const el = box.querySelector(activeClaimId ? '[data-active="1"]' : '[data-focus="1"]')
      if (!el) return
      const r = el.getBoundingClientRect()
      const br = box.getBoundingClientRect()
      box.scrollTo({ top: box.scrollTop + r.top - br.top - (box.clientHeight - r.height) / 2, behavior: 'smooth' })
    }, 350)
    return () => clearTimeout(timer)
  }, [activeClaimId, segments, view])

  const pages = data?.pages || []
  const focusPage = data?.focus_page ?? null

  useEffect(() => {
    if (view !== 'pages' || focusPage == null) return
    const timer = setTimeout(() => {
      pagesRef.current?.querySelector(`[data-page="${focusPage}"]`)?.scrollIntoView({ block: 'start' })
    }, 120)
    return () => clearTimeout(timer)
  }, [view, focusPage])

  const claims = data?.claims || []
  const unlocated = claims.filter((claim) => !claim.offset_valid).length

  const pickClaim = (claimId: string) => {
    setActiveClaimId(claimId)
    if (mobile) setView('text')
  }

  const textPane = (
    <div className="evd-text-pane">
      {unlocated > 0 && (
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
          return (
            <Tooltip key={index} title={`${segment.claimIds.length} 条事实引用了这段原文，点击查看`}>
              <mark
                data-claim={segment.claimIds[0]}
                data-active={isActive ? '1' : undefined}
                data-focus={segment.focus ? '1' : undefined}
                onClick={() => setActiveClaimId(segment.claimIds[0])}
                className={`evd-mark${isActive ? ' is-active' : ''}${segment.focus ? ' evd-focus' : ''}`}
              >
                {displayText(segment.text)}
              </mark>
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
    ...(mobile ? [{ label: `事实 ${claims.length}`, value: 'claims' }] : []),
    ...(pages.length ? [{ label: `教材原页 ${pages.length}`, value: 'pages' }] : []),
  ]

  return (
    <Drawer
      open={!!recordId}
      onClose={onClose}
      width={mobile ? '100%' : 1080}
      placement={mobile ? 'bottom' : 'right'}
      height={mobile ? '92%' : undefined}
      rootClassName="evd-drawer"
      title={data ? `${data.archive_number || ''} ${data.title || ''}`.trim() : '原文'}
      extra={data?.url ? (
        <Typography.Link href={data.url} target="_blank" rel="noreferrer">来源页面</Typography.Link>
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
                <Segmented size="small" value={view} onChange={(v) => setView(v as View)} options={viewOptions} />
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
