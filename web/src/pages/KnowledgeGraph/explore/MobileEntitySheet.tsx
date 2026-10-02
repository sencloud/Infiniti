/**
 * 手机上的条目详情：底部抽屉，替代桌面右上角的详情卡。
 * 学习路径是「看关系 → 读原文」，所以关系清单放第一屏，每行直达原文依据；
 * 出场与资料放在后两个标签里。点把手在半屏 / 近全屏之间切换。
 */
import { useEffect, useState, type ReactNode } from 'react'
import { AimOutlined, CloseOutlined, RightOutlined } from '@ant-design/icons'
import type { EntityMedia, EntitySource, GraphEdge } from '@/api/knowledge-graph'
import { nodeColor, nodeLabel } from '@/utils/graphStyle'
import { formatPropValue, propLabel, SKIPPED_PROPS } from './entityProps'
import NodeGallery from './NodeGallery'

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
}

type Tab = 'rels' | 'sources' | 'about'

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
    <section className={`inf-msheet ${expanded ? 'is-expanded' : ''}`} aria-label={`${entity.name} 详情`}>
      <button
        type="button"
        className="inf-msheet-grip"
        onClick={() => setExpanded((v) => !v)}
        aria-label={expanded ? '收起详情' : '展开详情'}
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
            aria-label={focused ? '退出聚焦' : '只看它的关系网'}
            title={focused ? '退出聚焦' : '只看它的关系网'}
          >
            <AimOutlined />
          </button>
          <button type="button" className="inf-msheet-icon" onClick={onClose} aria-label="关闭详情">
            <CloseOutlined />
          </button>
        </div>
        <div className="inf-msheet-meta">
          <div className="inf-msheet-chips">
            {chips.map((c) => <span key={c}>{c}</span>)}
          </div>
          {claimCount != null && <span className="inf-msheet-count"><b>{claimCount.toLocaleString()}</b> 条原文依据</span>}
        </div>
      </header>

      <div className="inf-msheet-tabs" role="tablist">
        {([
          ['rels', `关系 ${relations.length}`],
          ['sources', `出场${sources.length ? ` ${sources.length}` : ''}`],
          ['about', '资料'],
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
                      <span className="inf-msheet-sub">{n ? `${n} 条原文依据` : '暂无原文依据'}</span>
                    </span>
                    {n > 0 && <span className="inf-msheet-go">看原文<RightOutlined /></span>}
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
                  列出的是画布上已载入的 {relations.length} 条，共 {degree} 条直接关系。点右上角准星可载入更多。
                </li>
              )}
            </ul>
          ) : <p className="inf-msheet-empty">画布上还没有它的直接关系</p>
        )}

        {tab === 'sources' && (
          sourcesLoading ? <p className="inf-msheet-empty">正在查找出场记录…</p>
            : sources.length ? (
              <ul className="inf-msheet-list">
                {sources.map((src) => (
                  <li key={src.record_id}>
                    <button type="button" className="inf-msheet-row" onClick={() => onOpenSource(src.record_id)}>
                      <span className="inf-msheet-main">
                        <span className="inf-msheet-name">{src.title || src.record_id}</span>
                        <span className="inf-msheet-sub">
                          提及 {src.mention_count} 次{src.claim_count ? ` · ${src.claim_count} 条关系` : ''}
                        </span>
                      </span>
                      <span className="inf-msheet-go">读原文<RightOutlined /></span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : <p className="inf-msheet-empty">没有找到它出现的{axisName}</p>
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
            {!description && !facts.length && !media?.thumb_url && <p className="inf-msheet-empty">暂无更多资料</p>}
          </div>
        )}
      </div>
    </section>
  )
}
