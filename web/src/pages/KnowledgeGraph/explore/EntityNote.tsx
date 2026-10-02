/**
 * 条目解说：读存好的解说，没有就由学习者点一下现写。正文里的 [n] 点开原文。
 * compact 用在桌面详情卡里：默认只露一句话总结，展开再看分段。
 */
import { useEffect, useState } from 'react'
import { Button } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import { getEntityNote, writeEntityNote, type Citation, type NoteState } from '@/api/kg-learn'
import i18n from '@/i18n'
import CitedText from './CitedText'

interface Props {
  entityId: string
  compact?: boolean
  onCite: (citation: Citation, all: Citation[]) => void
}

function dateOf(iso: string) {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(i18n.language)
}

export default function EntityNote({ entityId, compact = false, onCite }: Props) {
  const [state, setState] = useState<NoteState | null>(null)
  const [loadedFor, setLoadedFor] = useState('')
  const [writing, setWriting] = useState(false)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(!compact)

  useEffect(() => {
    let alive = true
    getEntityNote(entityId)
      .then((res) => { if (alive) setState(res) })
      .catch(() => { if (alive) setState({ note: null, stale: false }) })
      .finally(() => { if (alive) setLoadedFor(entityId) })
    return () => { alive = false }
  }, [entityId])

  // 换条目时清掉上一条的状态（不在 effect 里同步 setState，避免多一次渲染）
  const [shownFor, setShownFor] = useState(entityId)
  if (shownFor !== entityId) {
    setShownFor(entityId)
    setState(null)
    setError('')
    setWriting(false)
    setOpen(!compact)
  }

  const write = () => {
    setWriting(true)
    setError('')
    writeEntityNote(entityId)
      .then((res) => { setState(res); setOpen(true) })
      .catch((e: Error) => setError(e.message))
      .finally(() => setWriting(false))
  }

  if (loadedFor !== entityId || !state) return <p className="inf-note-empty">{i18n.t('explore.loading')}</p>

  const note = state.note
  if (!note) {
    return (
      <div className="inf-note is-empty">
        <p className="inf-note-empty">{writing ? i18n.t('learn.note.writing') : i18n.t('learn.note.empty')}</p>
        {error && <p className="inf-note-error">{i18n.t('learn.note.failed', { error })}</p>}
        <Button size="small" loading={writing} onClick={write}>{i18n.t('learn.note.write')}</Button>
      </div>
    )
  }

  const cite = (c: Citation) => onCite(c, note.citations)
  return (
    <div className="inf-note">
      <p className="inf-note-summary"><CitedText text={note.summary} citations={note.citations} onCite={cite} /></p>
      {open && note.sections.map((s) => (
        <section key={s.title} className="inf-note-sec">
          {s.title && <h4>{s.title}</h4>}
          <p><CitedText text={s.text} citations={note.citations} onCite={cite} /></p>
        </section>
      ))}
      {compact && note.sections.length > 0 && (
        <button type="button" className="inf-note-toggle" onClick={() => setOpen((v) => !v)}>
          {open ? i18n.t('learn.note.less') : i18n.t('learn.note.more')}
        </button>
      )}
      {state.stale && <p className="inf-note-stale">{i18n.t('learn.note.stale')}</p>}
      {error && <p className="inf-note-error">{i18n.t('learn.note.failed', { error })}</p>}
      <div className="inf-note-foot">
        <span>{i18n.t('learn.note.meta', { count: note.citations.length, date: dateOf(note.generated_at) })}</span>
        <button type="button" onClick={write} disabled={writing}>
          <ReloadOutlined spin={writing} /> {writing ? i18n.t('learn.note.writing') : i18n.t('learn.note.rewrite')}
        </button>
      </div>
    </div>
  )
}
