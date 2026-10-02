/**
 * 手机上的条目详情：底部抽屉，替代桌面右上角的详情卡。
 * 学习路径是「看关系 → 读原文」，所以关系清单放第一屏，每行直达原文依据；
 * 解说、出场与资料放在后面的标签里。点把手在半屏 / 近全屏之间切换。
 */
import { useEffect, useState, type ReactNode } from 'react'
import { AimOutlined, CloseOutlined, RightOutlined } from '@ant-design/icons'
import type { EntityMedia, EntitySource, GraphEdge } from '@/api/knowledge-graph'
import type { Citation } from '@/api/kg-learn'
import { nodeColor, nodeLabel } from '@/utils/graphStyle'
import i18n from '@/i18n'
import { formatPropValue, propLabel, SKIPPED_PROPS } from './entityProps'
import EntityNote from './EntityNote'
import NodeGallery from './NodeGallery'
import RelatedEntities from './RelatedEntities'

export interface SheetRelation {
  edge: GraphEdge
  otherName: string
  otherLabel: string
}

interface Props {
  entity: { id: string; name: string; label: string; properties?: Record<string, unknown> }
  relations: SheetRelation[]
  relationOf: (edge: GraphEdge) => string
  sources: EntitySource[]
  sourcesLoading: boolean
  axisName: string
  media?: EntityMedia
  videos?: ReactNode
  focused: boolean
  onFocus: () => void
  onClose: () => void
  onOpenRelation: (edge: GraphEdge) => void
  onOpenSource: (recordId: string) => void
  onCite: (citation: Citation, all: Citation[]) => void
  onLocate: (entityId: string) => void
}

type Tab = 'rels' | 'note' | 'sources' | 'about'

const SHORT_PROPS = ['nickname', 'role', 'title', 'star']

function chip(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const text = value.trim()
  return text.length > 10 ? `${text.slice(0, 10)}…` : text
}

export default function MobileEntitySheet({
  entity,
  relations,
  relationOf,
  sources,
  sourcesLoading,
  axisName,
  media,
  videos,
  focused,
  onFocus,
  onClose,
  onOpenRelation,
  onOpenSource,
  onCite,
  onLocate,
}: Props) {
  const [tab, setTab] = useState<Tab>('rels')
  const [expanded, setExpanded] = useState(false)
  useEffect(() => { setTab('rels'); setExpanded(false) }, [entity.id])

  const props = entity.properties || {}
  const chips = [nodeLabel(entity.label), ...SHORT_PROPS.map((k) => chip(props[k]))]
    .filter((v, i, arr): v is string => Boolean(v) && arr.indexOf(v) === i)
    .slice(0, 3)
  const claimCount = typeof props.claim_count === 'number' ? props.claim_count : null
  const degree = typeof props.degree === 'number' ? props.degree : null
  const description = typeof props.description === 'string' ? props.description : ''
  const facts = Object.entries(props)
    .filter(([key, v]) => v != null && v !== '' && !SKIPPED_PROPS.has(key) && key !== 'description')
    .slice(0, 8)

  return (
    <section className={`inf-msheet ${expanded ? 'is-expanded' : ''}`} aria-label={i18n.t('explore.sheet', { name: entity.name })}>
      <button
        type="button"
        className="inf-msheet-grip"
        onClick={() => setExpanded((v) => !v)}
        aria-label={expanded ? i18n.t('explore.collapse') : i18n.t('explore.expand')}
        aria-expanded={expanded}
      >
        <span />
      </button>

      <header className="inf-msheet-head">
        <h3 className="inf-msheet-title">{entity.name}</h3>
        <div className="inf-msheet-tools">
          <button
            type="button"
            className={`inf-msheet-icon ${focused ? 'on' : ''}`}
            onClick={onFocus}
            aria-pressed={focused}
            aria-label={focused ? i18n.t('explore.exitFocus') : i18n.t('explore.focusNet')}
            title={focused ? i18n.t('explore.exitFocus') : i18n.t('explore.focusNet')}
          >
            <AimOutlined />
          </button>
          <button type="button" className="inf-msheet-icon" onClick={onClose} aria-label={i18n.t('explore.closeDetail')}>
            <CloseOutlined />
          </button>
        </div>
        <div className="inf-msheet-meta">
          <div className="inf-msheet-chips">
            {chips.map((c) => <span key={c}>{c}</span>)}
          </div>
          {claimCount != null && <span className="inf-msheet-count">{i18n.t('explore.evidenceCount', { count: claimCount })}</span>}
        </div>
      </header>

      <div className="inf-msheet-tabs" role="tablist">
        {([
          ['rels', i18n.t('explore.tabRels', { count: relations.length })],
          ['note', i18n.t('explore.tabNote')],
          ['sources', i18n.t('explore.tabSources', { count: sources.length ? ` ${sources.length}` : '' })],
          ['about', i18n.t('explore.tabAbout')],
        ] as [Tab, string][]).map(([key, label]) => (
          <button
            type="button"
            role="tab"
            key={key}
            aria-selected={tab === key}
            className={tab === key ? 'on' : ''}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="inf-msheet-body">
        {tab === 'rels' && (
          relations.length ? (
            <ul className="inf-msheet-list">
              {relations.map(({ edge, otherName, otherLabel }, i) => {
                const n = edge.claim_ids?.length || 0
                const inner = (
                  <>
                    <span className="inf-msheet-dot" style={{ background: nodeColor(otherLabel).main }} />
                    <span className="inf-msheet-main">
                      <span className="inf-msheet-name">
                        {otherName}
                        <em>{relationOf(edge)}</em>
                      </span>
                      <span className="inf-msheet-sub">{n ? i18n.t('explore.evidenceCount', { count: n }) : i18n.t('explore.noEvidence')}</span>
                    </span>
                    {n > 0 && <span className="inf-msheet-go">{i18n.t('explore.readSource')}<RightOutlined /></span>}
                  </>
                )
                return (
                  <li key={edge.id || i}>
                    {n > 0
                      ? <button type="button" className="inf-msheet-row" onClick={() => onOpenRelation(edge)}>{inner}</button>
                      : <div className="inf-msheet-row">{inner}</div>}
                  </li>
                )
              })}
              {degree != null && degree > relations.length && (
                <li className="inf-msheet-note">
                  {i18n.t('explore.loadedNote', { shown: relations.length, total: degree })}
                </li>
              )}
            </ul>
          ) : <p className="inf-msheet-empty">{i18n.t('explore.noCanvasRel')}</p>
        )}
        {tab === 'rels' && <RelatedEntities entityId={entity.id} limit={5} onLocate={onLocate} />}

        {tab === 'note' && <EntityNote entityId={entity.id} onCite={onCite} />}

        {tab === 'sources' && (
          sourcesLoading ? <p className="inf-msheet-empty">{i18n.t('explore.findingSources')}</p>
            : sources.length ? (
              <ul className="inf-msheet-list">
                {sources.map((src) => (
                  <li key={src.record_id}>
                    <button type="button" className="inf-msheet-row" onClick={() => onOpenSource(src.record_id)}>
                      <span className="inf-msheet-main">
                        <span className="inf-msheet-name">{src.title || src.record_id}</span>
                        <span className="inf-msheet-sub">
                          {i18n.t('explore.mentionLine', { count: src.mention_count, extra: src.claim_count ? i18n.t('explore.relExtra', { count: src.claim_count }) : '' })}
                        </span>
                      </span>
                      <span className="inf-msheet-go">{i18n.t('rel.read')}<RightOutlined /></span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : <p className="inf-msheet-empty">{i18n.t('explore.noAxisHit', { axis: axisName })}</p>
        )}

        {tab === 'about' && (
          <div className="inf-msheet-about">
            {description && <p className="inf-msheet-desc">{description}</p>}
            {media?.thumb_url && <NodeGallery name={entity.name} media={media} />}
            {videos}
            {facts.length > 0 && (
              <dl className="inf-msheet-facts">
                {facts.map(([key, value]) => (
                  <div key={key}>
                    <dt>{propLabel(key)}</dt>
                    <dd>{formatPropValue(value, 80, key)}</dd>
                  </div>
                ))}
              </dl>
            )}
            {!description && !facts.length && !media?.thumb_url && <p className="inf-msheet-empty">{i18n.t('explore.noMoreAbout')}</p>}
          </div>
        )}
      </div>
    </section>
  )
}
