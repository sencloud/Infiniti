/**
 * 带编号引用的正文：把 [n] 渲染成可点的小标，点开对应的原文依据。
 * 解说和问答共用；n 超出 citations 范围的标号原样显示为文字。
 */
import { Fragment } from 'react'
import { Tooltip } from 'antd'
import type { Citation } from '@/api/kg-learn'
import i18n from '@/i18n'
import { useIsMobile } from '@/hooks/useIsMobile'

interface Props {
  text: string
  citations: Citation[]
  onCite: (citation: Citation) => void
}

export default function CitedText({ text, citations, onCite }: Props) {
  const mobile = useIsMobile()
  const byN = new Map(citations.map((c) => [c.n, c]))
  const parts = text.split(/(\[\d+\])/g)
  return (
    <>
      {parts.map((part, i) => {
        const n = part.match(/^\[(\d+)\]$/)?.[1]
        const c = n ? byN.get(Number(n)) : undefined
        if (!c) return <Fragment key={i}>{part}</Fragment>
        const button = (
          <button
            type="button"
            className="inf-cite"
            onClick={() => onCite(c)}
            aria-label={`${i18n.t('learn.cite', { n: c.n })} · ${c.unit}`}
          >
            {c.n}
          </button>
        )
        if (mobile) return <Fragment key={i}>{button}</Fragment>
        return (
          <Tooltip
            key={i}
            mouseEnterDelay={0.25}
            title={(
              <span className="inf-cite-tip">
                <b>{c.unit}{c.relation ? ` · ${c.relation}` : ''}</b>
                <span>「{c.evidence_text}」</span>
              </span>
            )}
          >
            {button}
          </Tooltip>
        )
      })}
    </>
  )
}

/** 引用对应的阅读器目标：事实带上全部事实引用作为可前后翻的路线 */
export function citationTarget(citation: Citation, all: Citation[]) {
  const trail = all.filter((c) => c.claim_id).map((c) => ({ recordId: c.record_id, claimId: c.claim_id }))
  return citation.claim_id
    ? { recordId: citation.record_id, claimId: citation.claim_id, trail: trail.length > 1 ? trail : undefined }
    : { recordId: citation.record_id }
}
