/**
 * 分析面板里的两个学习模式：
 *   ask     提问：沿关系网取事实和原文作答，[n] 点开原文；好的回答可以存下来
 *   review  待核对：最可能抽错的事实，确认 / 驳回 / 跳过
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Empty, Input, Segmented, Spin, Tag } from 'antd'
import { CheckOutlined, CloseOutlined, ReloadOutlined, RightOutlined, StarOutlined } from '@ant-design/icons'
import {
  askGraph,
  decideReview,
  getAnswer,
  getReviewQueue,
  listSavedAnswers,
  saveAnswer,
  type Answer,
  type Citation,
  type ReviewAction,
  type ReviewItem,
  type ReviewQueue,
  type ReviewReason,
  type SavedAnswerItem,
} from '@/api/kg-learn'
import { activeProfile } from '@/graph/profile'
import i18n from '@/i18n'
import { displayText } from '@/utils/mathText'
import CitedText from './CitedText'

type OpenCitation = (citation: Citation, all: Citation[]) => void

/* ==================== 提问 ==================== */

export function AskTab({ onLocate, onCite }: { onLocate: (entityId: string) => void; onCite: OpenCitation }) {
  const profile = activeProfile()
  const [draft, setDraft] = useState('')
  const [answer, setAnswer] = useState<Answer | null>(null)
  const [asking, setAsking] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState<SavedAnswerItem[]>([])
  const [saving, setSaving] = useState(false)

  const loadSaved = useCallback(() => {
    listSavedAnswers().then(setSaved).catch(() => setSaved([]))
  }, [])
  useEffect(loadSaved, [loadSaved])

  const ask = (question: string, fresh = false) => {
    const q = question.trim()
    if (!q || asking) return
    setDraft(q)
    setAsking(true)
    setError('')
    askGraph(q, fresh)
      .then(setAnswer)
      .catch((e: Error) => setError(e.message))
      .finally(() => setAsking(false))
  }

  const openSaved = (id: string) => {
    setAsking(true)
    setError('')
    getAnswer(id)
      .then((a) => { setAnswer(a); setDraft(a.question) })
      .catch((e: Error) => setError(e.message))
      .finally(() => setAsking(false))
  }

  const keep = () => {
    if (!answer) return
    setSaving(true)
    saveAnswer(answer.id)
      .then((a) => { setAnswer(a); loadSaved() })
      .catch(() => {})
      .finally(() => setSaving(false))
  }

  const questions = profile.purpose?.questions || []
  const cite = (c: Citation) => answer && onCite(c, answer.citations)

  return (
    <div className="kgap-body">
      <form
        className="kgap-ask-form"
        onSubmit={(event) => { event.preventDefault(); ask(draft) }}
      >
        <Input.TextArea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onPressEnter={(event) => { if (!event.shiftKey) { event.preventDefault(); ask(draft) } }}
          placeholder={i18n.t('learn.ask.placeholder', { book: profile.book })}
          autoSize={{ minRows: 1, maxRows: 4 }}
          maxLength={200}
        />
        <Button type="primary" htmlType="submit" loading={asking} disabled={!draft.trim()}>
          {i18n.t('learn.ask.submit')}
        </Button>
      </form>
      <div className="kgap-hint">{i18n.t('learn.ask.hint')}</div>

      {asking && <div className="kgap-hint"><Spin size="small" /> {i18n.t('learn.ask.thinking')}</div>}
      {error && !asking && <div className="inf-note-error">{i18n.t('learn.ask.failed', { error })}</div>}

      {answer && !asking && (
        <div className="kgap-answer">
          <p className="kgap-answer-q">{answer.question}</p>
          <p className="kgap-answer-text"><CitedText text={answer.answer} citations={answer.citations} onCite={cite} /></p>
          <div className="kgap-answer-actions">
            {answer.saved
              ? <Tag icon={<StarOutlined />} color="gold">{i18n.t('learn.ask.savedTag')}</Tag>
              : <Button size="small" icon={<StarOutlined />} loading={saving} onClick={keep}>{i18n.t('learn.ask.save')}</Button>}
            <Button size="small" icon={<ReloadOutlined />} onClick={() => ask(answer.question, true)}>{i18n.t('learn.ask.again')}</Button>
            <Button size="small" type="text" onClick={() => { setAnswer(null); setDraft('') }}>{i18n.t('learn.ask.back')}</Button>
          </div>

          {answer.entities.length > 0 && (
            <>
              <div className="kgap-sec-title">{i18n.t('learn.ask.mentioned')}</div>
              <div className="kgap-chips">
                {answer.entities.map((e) => (
                  <button type="button" key={e.id} className="kgap-chip" onClick={() => onLocate(e.id)}>{e.name}</button>
                ))}
              </div>
            </>
          )}

          {answer.followups.length > 0 && (
            <>
              <div className="kgap-sec-title">{i18n.t('learn.ask.followups')}</div>
              <div className="kgap-chips">
                {answer.followups.map((q) => (
                  <button type="button" key={q} className="kgap-chip" onClick={() => ask(q)}>{q}</button>
                ))}
              </div>
            </>
          )}

          {answer.citations.length > 0 && (
            <>
              <div className="kgap-sec-title">{i18n.t('learn.sources', { count: answer.citations.length })}</div>
              <ol className="kgap-cites">
                {answer.citations.map((c) => (
                  <li key={c.n}>
                    <button type="button" onClick={() => cite(c)}>
                      <span className="inf-cite" aria-hidden>{c.n}</span>
                      <span className="kgap-cite-body">
                        <small>{c.unit}{c.relation ? ` · ${c.relation}` : ''}</small>
                        「{displayText(c.evidence_text).slice(0, 90)}」
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>
      )}

      {!answer && !asking && (
        <>
          {questions.length > 0 && (
            <>
              <div className="kgap-sec-title">{i18n.t('learn.ask.suggest')}</div>
              <div className="kgap-chips">
                {questions.map((q) => (
                  <button type="button" key={q} className="kgap-chip" onClick={() => ask(q)}>{q}</button>
                ))}
              </div>
            </>
          )}
          {saved.length > 0 && (
            <>
              <div className="kgap-sec-title">{i18n.t('learn.ask.saved')}</div>
              <ul className="kgap-saved">
                {saved.map((s) => (
                  <li key={s.id}>
                    <button type="button" onClick={() => openSaved(s.id)}>
                      <b>{s.question}</b>
                      <span>{s.preview}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  )
}

/* ==================== 待核对 ==================== */

const PAGE = 20
const REASONS: ReviewReason[] = ['unmatched', 'conflict', 'low']
const DONE_KEY: Record<Exclude<ReviewAction, 'reset'>, string> = {
  confirm: 'learn.review.doneConfirm',
  reject: 'learn.review.doneReject',
  skip: 'learn.review.doneSkip',
}

export function ReviewTab({ onOpenArchive }: { onOpenArchive: (recordId: string, claimId?: string) => void }) {
  const [reason, setReason] = useState<ReviewReason | ''>('')
  const [queue, setQueue] = useState<ReviewQueue | null>(null)
  const [items, setItems] = useState<ReviewItem[]>([])
  const [loading, setLoading] = useState(true)
  const [done, setDone] = useState<Record<string, ReviewAction>>({})
  const [pending, setPending] = useState('')
  /** 进入本筛选时服务端已有的处理数；之后本页的处理在 done 里另算 */
  const [base, setBase] = useState<ReviewQueue['decided'] | null>(null)

  useEffect(() => {
    let alive = true
    getReviewQueue({ reason, limit: PAGE, offset: 0 })
      .then((q) => { if (alive) { setQueue(q); setItems(q.items); setDone({}); setBase(q.decided) } })
      .catch(() => { if (alive) { setQueue(null); setItems([]) } })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [reason])

  const pickReason = (next: ReviewReason | '') => {
    setLoading(true)
    setReason(next)
  }

  const more = () => {
    // 已处理的条目离开了队列，偏移量要扣掉
    getReviewQueue({ reason, limit: PAGE, offset: items.length - Object.keys(done).length })
      .then((q) => {
        setQueue(q)
        setItems((prev) => {
          const seen = new Set(prev.map((i) => i.claim_id))
          return prev.concat(q.items.filter((i) => !seen.has(i.claim_id)))
        })
      })
      .catch(() => {})
  }

  const act = (item: ReviewItem, action: ReviewAction) => {
    setPending(item.claim_id)
    decideReview(item.claim_id, action)
      .then(() => setDone((prev) => {
        const next = { ...prev }
        if (action === 'reset') delete next[item.claim_id]
        else next[item.claim_id] = action
        return next
      }))
      .catch(() => {})
      .finally(() => setPending(''))
  }

  const canDecide = Boolean(queue?.can_decide)
  const counts = queue?.counts
  const total = counts ? REASONS.reduce((s, r) => s + counts[r], 0) : 0
  const handledNow = Object.keys(done).length
  // 服务端的 total 只数还没处理的；已加载里还没处理的是 items - handledNow
  const unseen = Math.max(0, (queue?.total || 0) - (items.length - handledNow))
  const tally = { confirm: 0, reject: 0, skip: 0, ...base }
  for (const a of Object.values(done)) if (a !== 'reset') tally[a] += 1

  return (
    <div className="kgap-body">
      <div className="kgap-hint">{i18n.t('learn.review.intro')}</div>
      {queue && !canDecide && <div className="kgap-hint">{i18n.t('learn.review.readonly')}</div>}
      <Segmented
        size="small"
        className="kgap-scroll-seg"
        value={reason}
        onChange={(value) => pickReason(value as ReviewReason | '')}
        options={[
          { label: `${i18n.t('learn.review.all')}${counts ? ` ${total}` : ''}`, value: '' },
          ...REASONS.map((r) => ({ label: `${i18n.t(`learn.review.${r}`)}${counts ? ` ${counts[r]}` : ''}`, value: r })),
        ]}
      />
      {tally.confirm + tally.reject + tally.skip > 0 && (
        <div className="kgap-hint">{i18n.t('learn.review.decided', tally)}</div>
      )}
      {loading ? <Spin /> : items.length === 0 ? (
        <Empty description={i18n.t('learn.review.empty')} image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <div className="kgap-clues">
          {items.map((item) => {
            const state = done[item.claim_id]
            return (
              <div key={item.claim_id} className={`kgap-review ${state ? 'is-done' : ''}`}>
                <div className="kgap-review-head">
                  <b>{item.subject.name}</b>
                  <em>{item.predicate_name}</em>
                  <b>{item.object.name}</b>
                  {item.reasons.map((r) => (
                    <Tag key={r} color={r === 'unmatched' ? 'red' : r === 'conflict' ? 'orange' : 'default'}>
                      {i18n.t(`learn.review.${r}`)}
                    </Tag>
                  ))}
                </div>
                <div className="kgap-review-sub">
                  {item.unit}{item.archive_title ? ` · ${item.archive_title}` : ''} · {i18n.t('learn.review.confidence', { value: item.confidence.toFixed(2) })}
                </div>
                {item.evidence_text && <div className="kgap-hop-evidence">「{displayText(item.evidence_text).slice(0, 120)}」</div>}
                <div className="kgap-review-actions">
                  <Button size="small" type="link" onClick={() => onOpenArchive(item.record_id, item.claim_id)}>
                    {i18n.t('learn.review.readSource')} <RightOutlined />
                  </Button>
                  {state ? (
                    <>
                      <span className="kgap-review-state">{i18n.t(DONE_KEY[state as Exclude<ReviewAction, 'reset'>])}</span>
                      {canDecide && (
                        <Button size="small" type="text" loading={pending === item.claim_id} onClick={() => act(item, 'reset')}>
                          {i18n.t('learn.review.undo')}
                        </Button>
                      )}
                    </>
                  ) : canDecide && (
                    <>
                      <Button size="small" icon={<CheckOutlined />} loading={pending === item.claim_id} onClick={() => act(item, 'confirm')}>
                        {i18n.t('learn.review.confirm')}
                      </Button>
                      <Button size="small" danger icon={<CloseOutlined />} disabled={pending === item.claim_id} onClick={() => act(item, 'reject')}>
                        {i18n.t('learn.review.reject')}
                      </Button>
                      <Button size="small" type="text" disabled={pending === item.claim_id} onClick={() => act(item, 'skip')}>
                        {i18n.t('learn.review.skip')}
                      </Button>
                    </>
                  )}
                </div>
              </div>
            )
          })}
          {unseen > 0 && (
            <Button onClick={more}>{i18n.t('learn.review.more', { count: Math.min(PAGE, unseen) })}</Button>
          )}
        </div>
      )}
    </div>
  )
}
