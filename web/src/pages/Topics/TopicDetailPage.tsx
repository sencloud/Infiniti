/**
 * 专题详情：处理进度（转写 → 整理目录 → 抽取 → 入库 → 星图与线索）、添加资料、按分类看文件、处理日志。
 * 处理中每 3 秒刷新一次；命令行在另一个进程里处理时只显示进度。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { App, Button, Checkbox, Input, Popconfirm } from 'antd'
import {
  CheckOutlined, DeleteOutlined, EditOutlined, FileTextOutlined, LeftOutlined, RightOutlined,
} from '@ant-design/icons'
import {
  deleteTopic, getTopic, importLocalFolder, removeTopicFile, runTopic, stopTopic, updateTopic, uploadTopicFile,
  type TopicDetail, type TopicFile, type TopicStatus,
} from '@/api/topics'
import i18n from '@/i18n'
import {
  AccessPanel, formatBytes, formatTime, isBusy, progressOf, STEP_ORDER, stateText, TopicCover, TopicHeader,
} from './shared'

const ACCEPT = /\.(pdf|docx?|txt|md)$/i
const UPLOAD_PARALLEL = 3

type Picked = { file: File; path: string }

/** 拖进来的文件夹逐层展开；readEntries 一次最多给 100 项，要读到空为止 */
async function readEntry(entry: FileSystemEntry, prefix: string, out: Picked[]) {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject))
    out.push({ file, path: `${prefix}${entry.name}` })
    return
  }
  if (!entry.isDirectory) return
  const reader = (entry as FileSystemDirectoryEntry).createReader()
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject))
    if (!batch.length) break
    for (const child of batch) await readEntry(child, `${prefix}${entry.name}/`, out)
  }
}

/** 选的或拖进来的是同一个文件夹时，它本身就是专题根目录，里面的子文件夹才是分类 */
function stripRoot(list: Picked[]): Picked[] {
  const roots = new Set(list.map((p) => (p.path.includes('/') ? p.path.split('/')[0] : '')))
  if (roots.size !== 1 || roots.has('')) return list
  return list.map((p) => ({ ...p, path: p.path.slice(p.path.indexOf('/') + 1) }))
}

function mediaUrl(id: string, rel: string): string {
  return `/media/${id}/files/${rel.split('/').map(encodeURIComponent).join('/')}`
}

type UploadState = { total: number; done: number; bytes: number; sent: number; failed: number; tally: Record<string, number> }

function StepStrip({ status }: { status: TopicStatus }) {
  const busy = isBusy(status)
  const cur = status.step ? STEP_ORDER.indexOf(status.step) : -1
  return (
    <ol className="tp-steps">
      {STEP_ORDER.map((step, i) => {
        const done = status.state === 'done' || (busy && cur > i)
        const active = busy && cur === i
        let note = ''
        if (active && step === 'crawl' && status.ingest) note = `${status.ingest.files_done}/${status.ingest.files_total}`
        if (active && step === 'extract' && status.units) note = `${status.extracted ?? 0}/${status.units}`
        return (
          <li key={step} className={`tp-step ${done ? 'is-done' : ''} ${active ? 'is-active' : ''}`} aria-current={active ? 'step' : undefined}>
            <i>{done ? <CheckOutlined /> : note || '\u00a0'}</i>
            {i18n.t(`topic.step.${step}`)}
          </li>
        )
      })}
    </ol>
  )
}

function RunPanel({ topic, onChanged }: { topic: TopicDetail; onChanged: () => void }) {
  const { message } = App.useApp()
  const s = topic.status
  const busy = isBusy(s)
  const ready = topic.stats.claims > 0
  const fresh = topic.files.filter((f) => f.status === 'pending').length
  const failedFiles = topic.files.filter((f) => f.status === 'failed').length
  const unfinished = topic.files.filter((f) => f.status !== 'extracted').length
  const [acting, setActing] = useState(false)

  const act = async (fn: () => Promise<unknown>) => {
    setActing(true)
    try {
      await fn()
      onChanged()
    } catch {
      // 错误提示由请求拦截器统一弹出
    } finally {
      setActing(false)
    }
  }

  let primary: { label: string; steps?: string[] } | null = null
  if (!busy && topic.can_manage && topic.files.length) {
    if (!s.state) primary = { label: i18n.t('topic.action.run') }
    else if (s.state === 'failed' || s.state === 'stopped') primary = { label: i18n.t('topic.action.resume') }
    else if (unfinished) primary = { label: fresh ? i18n.t('topic.action.process') : i18n.t('topic.action.resume') }
  }

  let hint = ''
  let warn = false
  if (s.external && busy) hint = i18n.t('topic.hint.external')
  else if (s.state === 'failed' && s.error_code === 'interrupted') { hint = i18n.t('topic.hint.interrupted'); warn = true }
  else if (s.state === 'failed' && s.error) { hint = s.error; warn = true }
  else if (!s.state && topic.files.length) hint = i18n.t('topic.hint.fresh')
  else if (!busy && ready && !unfinished) hint = i18n.t('topic.hint.ready')

  const ingest = s.ingest
  return (
    <section className="tp-panel">
      <StepStrip status={s} />
      <div className="tp-run-state">
        <span className={`tp-dot is-${s.state || 'none'}`} aria-hidden="true" />
        {stateText(s)}
        {busy && (
          <span className="tp-bar" aria-hidden="true"><span style={{ transform: `scaleX(${progressOf(s)})` }} /></span>
        )}
      </div>
      <ul className="tp-run-lines">
        {busy && s.step === 'crawl' && ingest && (
          <>
            <li>{i18n.t('topic.progress.ingest', { done: ingest.files_done, total: ingest.files_total })}</li>
            {ingest.ocr_total > 0 && <li>{i18n.t('topic.progress.ocr', { done: ingest.ocr_done, total: ingest.ocr_total })}</li>}
            {ingest.current && <li className="tp-current">{i18n.t('topic.progress.current', { name: ingest.current })}</li>}
          </>
        )}
        {busy && s.step === 'extract' && s.units != null && (
          <li>{i18n.t('topic.progress.extract', { done: s.extracted ?? 0, total: s.units })}</li>
        )}
        {!busy && s.state === 'done' && s.finished_at && <li>{i18n.t('topic.progress.finished', { time: formatTime(s.finished_at) })}</li>}
        {busy && s.updated_at && <li>{i18n.t('topic.progress.updated', { time: formatTime(s.updated_at) })}</li>}
        {!busy && fresh > 0 && s.state && <li>{i18n.t('topic.hint.pending', { count: fresh })}</li>}
        {failedFiles > 0 && <li>{i18n.t('topic.hint.failedFiles', { count: failedFiles })}</li>}
      </ul>
      {hint && <p className={`tp-hint ${warn ? 'is-warn' : ''}`}>{hint}</p>}
      <div className="tp-run-actions">
        {primary && (
          <button type="button" className="hm-btn main" disabled={acting} onClick={() => act(() => runTopic(topic.id, primary?.steps))}>
            {primary.label}
          </button>
        )}
        {busy && !s.external && topic.can_manage && (
          <button
            type="button"
            className="hm-btn ghost"
            title={i18n.t('topic.action.stopHint')}
            disabled={acting}
            onClick={() => act(async () => {
              await stopTopic(topic.id)
              message.info(i18n.t('topic.action.stopHint'))
            })}
          >
            {i18n.t('topic.action.stop')}
          </button>
        )}
        {ready && (
          <Link to={`/g/${topic.id}/explore`} className={`hm-btn ${primary || busy ? 'ghost' : 'main'}`}>{i18n.t('topic.action.explore')}</Link>
        )}
        {ready && <Link to={`/g/${topic.id}/galaxy`} className="hm-btn ghost">{i18n.t('topic.action.galaxy')}</Link>}
        {!busy && !primary && s.state === 'done' && topic.can_manage && (
          <button type="button" className="hm-btn ghost" disabled={acting} onClick={() => act(() => runTopic(topic.id))}>
            {i18n.t('topic.action.rerun')}
          </button>
        )}
      </div>
    </section>
  )
}

function AddPanel({ topic, onChanged }: { topic: TopicDetail; onChanged: () => void }) {
  const { message } = App.useApp()
  const [over, setOver] = useState(false)
  const [upload, setUpload] = useState<UploadState | null>(null)
  const [dir, setDir] = useState('')
  const [importing, setImporting] = useState(false)
  const filesInput = useRef<HTMLInputElement>(null)
  const folderInput = useRef<HTMLInputElement>(null)
  const busy = isBusy(topic.status)

  useEffect(() => {
    folderInput.current?.setAttribute('webkitdirectory', '')
  }, [])

  const send = async (picked: Picked[]) => {
    const usable = stripRoot(picked).filter((p) => ACCEPT.test(p.path) && !p.file.name.startsWith('~$') && p.file.size > 0)
    const skipped = picked.length - usable.length
    if (skipped) message.info(i18n.t('topic.add.skipped', { count: skipped }))
    if (!usable.length) return
    const state: UploadState = {
      total: usable.length, done: 0, bytes: usable.reduce((n, p) => n + p.file.size, 0), sent: 0, failed: 0, tally: {},
    }
    setUpload({ ...state })
    const queue = [...usable]
    const sentOf = new Map<string, number>()
    const worker = async () => {
      for (let item = queue.shift(); item; item = queue.shift()) {
        const current = item
        try {
          const r = await uploadTopicFile(topic.id, current.path, current.file, (loaded) => {
            sentOf.set(current.path, loaded)
            state.sent = [...sentOf.values()].reduce((a, b) => a + b, 0)
            setUpload({ ...state })
          })
          state.tally[r.status] = (state.tally[r.status] || 0) + 1
        } catch {
          state.failed++
        }
        sentOf.set(current.path, current.file.size)
        state.done++
        setUpload({ ...state })
      }
    }
    await Promise.all(Array.from({ length: UPLOAD_PARALLEL }, worker))
    const t = state.tally
    message.success(i18n.t('topic.add.uploadDone', {
      added: t.added || 0, replaced: t.replaced || 0, duplicate: t.duplicate || 0, unchanged: t.unchanged || 0,
    }))
    if (state.failed) message.warning(i18n.t('topic.add.uploadFailed', { count: state.failed }))
    setUpload(null)
    onChanged()
  }

  const onDrop = async (e: DragEvent) => {
    e.preventDefault()
    setOver(false)
    if (busy || upload) return
    const entries = [...e.dataTransfer.items].map((it) => it.webkitGetAsEntry?.()).filter(Boolean) as FileSystemEntry[]
    const picked: Picked[] = []
    if (entries.length) {
      for (const entry of entries) await readEntry(entry, '', picked)
    } else {
      for (const file of e.dataTransfer.files) picked.push({ file, path: file.name })
    }
    send(picked)
  }

  const onPick = (list: FileList | null) => {
    if (!list) return
    send([...list].map((file) => ({ file, path: file.webkitRelativePath || file.name })))
  }

  const importDir = async () => {
    if (!dir.trim()) return
    setImporting(true)
    try {
      const r = await importLocalFolder(topic.id, dir.trim())
      message.success(i18n.t('topic.add.localDone', { ...r }))
      onChanged()
    } catch {
      // 拦截器已提示
    } finally {
      setImporting(false)
    }
  }

  const disabled = busy || Boolean(upload)
  return (
    <section className="tp-panel">
      <h2>{i18n.t('topic.add.title')}</h2>
      <div
        className={`tp-drop ${over ? 'is-over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); if (!disabled) setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        <strong>{busy ? i18n.t('topic.add.busy') : i18n.t('topic.add.drop')}</strong>
        <p>{i18n.t('topic.add.dropSub')}</p>
        <div className="tp-drop-actions">
          <button type="button" className="hm-btn ghost" disabled={disabled} onClick={() => filesInput.current?.click()}>
            {i18n.t('topic.add.pickFiles')}
          </button>
          <button type="button" className="hm-btn ghost" disabled={disabled} onClick={() => folderInput.current?.click()}>
            {i18n.t('topic.add.pickFolder')}
          </button>
        </div>
        <input
          ref={filesInput}
          type="file"
          multiple
          hidden
          accept=".pdf,.doc,.docx,.txt,.md"
          onChange={(e) => { onPick(e.target.files); e.target.value = '' }}
        />
        <input ref={folderInput} type="file" multiple hidden onChange={(e) => { onPick(e.target.files); e.target.value = '' }} />
      </div>
      {upload && (
        <div className="tp-upload" role="status">
          {i18n.t('topic.add.uploading', { done: upload.done, total: upload.total })} · {formatBytes(upload.sent)} / {formatBytes(upload.bytes)}
          <div className="tp-bar"><span style={{ transform: `scaleX(${upload.bytes ? upload.sent / upload.bytes : 0})` }} /></div>
        </div>
      )}
      {topic.local && (
        <div className="tp-local">
          <b>{i18n.t('topic.add.local')}</b>
          <p>{i18n.t('topic.add.localSub')}</p>
          <form className="tp-local-row" onSubmit={(e) => { e.preventDefault(); importDir() }}>
            <Input value={dir} onChange={(e) => setDir(e.target.value)} placeholder={i18n.t('topic.add.localPh')} disabled={disabled} />
            <Button htmlType="submit" loading={importing} disabled={disabled || !dir.trim()}>{i18n.t('topic.add.localGo')}</Button>
          </form>
        </div>
      )}
    </section>
  )
}

function FileRow({ topic, file, onChanged }: { topic: TopicDetail; file: TopicFile; onChanged: () => void }) {
  const c = file.converted
  const meta = [
    c?.pages ? i18n.t('topic.files.pages', { count: c.pages }) : '',
    c?.ocr_pages ? i18n.t('topic.files.ocr', { count: c.ocr_pages }) : '',
    c ? i18n.t('topic.files.chars', { n: c.chars.toLocaleString() }) : '',
    formatBytes(file.size),
  ].filter(Boolean).join(' · ')
  return (
    <div className="tp-file">
      <div className="tp-file-name">
        <div>
          {file.code && <span className="tp-file-code">{file.code}</span>}
          <span className="tp-file-title" title={file.name}>{file.title || file.name}</span>
        </div>
        <div className="tp-file-meta">{meta}</div>
        {file.error && <div className="tp-file-error">{file.error}</div>}
      </div>
      <span className={`tp-tag is-${file.status}`}>{i18n.t(`topic.files.status.${file.status}`)}</span>
      <div className="tp-file-tools">
        <a className="tp-icon" href={mediaUrl(topic.id, file.path)} target="_blank" rel="noreferrer" title={i18n.t('topic.files.open')} aria-label={i18n.t('topic.files.open')}>
          <FileTextOutlined />
        </a>
        {topic.can_manage && (
          <Popconfirm
            title={i18n.t('topic.files.removeConfirm', { name: file.title || file.name })}
            okText={i18n.t('topic.files.remove')}
            okButtonProps={{ danger: true }}
            disabled={isBusy(topic.status)}
            onConfirm={() => removeTopicFile(topic.id, file.no).then(onChanged).catch(() => {})}
          >
            <button type="button" className="tp-icon" disabled={isBusy(topic.status)} title={i18n.t('topic.files.remove')} aria-label={i18n.t('topic.files.remove')}>
              <DeleteOutlined />
            </button>
          </Popconfirm>
        )}
      </div>
    </div>
  )
}

function FileList({ topic, onChanged }: { topic: TopicDetail; onChanged: () => void }) {
  const [q, setQ] = useState('')
  const [onlyFailed, setOnlyFailed] = useState(false)
  const groups = useMemo(() => {
    const kw = q.trim().toLowerCase()
    const map = new Map<string, TopicFile[]>()
    for (const f of topic.files) {
      if (onlyFailed && f.status !== 'failed') continue
      if (kw && !`${f.code} ${f.title} ${f.name}`.toLowerCase().includes(kw)) continue
      const key = f.category || ''
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(f)
    }
    // 父分类排在它的子分类前面：「档案行业标准」→「档案行业标准 / AI行业标准」
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b, 'zh-Hans-CN'))
  }, [topic.files, q, onlyFailed])
  const anyFailed = topic.files.some((f) => f.status === 'failed')
  const filtering = Boolean(q.trim()) || onlyFailed

  return (
    <section className="tp-files">
      <div className="tp-files-head">
        <h2>{i18n.t('topic.files.title')}</h2>
        <span className="tp-meta"><span><b>{topic.files.length}</b>{i18n.t('topic.stat.files')}</span></span>
        {topic.files.length > 0 && (
          <div className="tp-files-tools">
            {anyFailed && (
              <Checkbox checked={onlyFailed} onChange={(e) => setOnlyFailed(e.target.checked)}>{i18n.t('topic.files.onlyFailed')}</Checkbox>
            )}
            <Input allowClear value={q} onChange={(e) => setQ(e.target.value)} placeholder={i18n.t('topic.files.filter')} style={{ width: 220 }} />
          </div>
        )}
      </div>
      {!topic.files.length && <div className="tp-empty">{i18n.t('topic.files.none')}</div>}
      {groups.map(([cat, files]) => {
        const done = files.filter((f) => f.status === 'extracted').length
        return (
          <details key={`${cat}:${filtering}`} className="tp-group" open={filtering || groups.length <= 3}>
            <summary>
              <RightOutlined />
              <h3>{cat || i18n.t('topic.files.uncategorized')}</h3>
              <span>{i18n.t('topic.files.count', { count: files.length })}{done && done < files.length ? ` · ${i18n.t('topic.files.status.extracted')} ${done}` : ''}</span>
            </summary>
            {files.map((f) => <FileRow key={f.no} topic={topic} file={f} onChanged={onChanged} />)}
          </details>
        )
      })}
    </section>
  )
}

function TitleBlock({ topic, onChanged }: { topic: TopicDetail; onChanged: () => void }) {
  const { message } = App.useApp()
  const navigate = useNavigate()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(topic.name)
  const [desc, setDesc] = useState(topic.description)
  const ready = topic.stats.claims > 0

  const save = async () => {
    try {
      await updateTopic(topic.id, { name: name.trim(), description: desc.trim() })
      setEditing(false)
      onChanged()
    } catch {
      // 拦截器已提示
    }
  }

  return (
    <section className="tp-title">
      <TopicCover name={topic.name} />
      {editing ? (
        <form className="tp-form" style={{ margin: 0 }} onSubmit={(e) => { e.preventDefault(); save() }}>
          <label className="tp-field">
            <span>{i18n.t('topic.form.name')}</span>
            <Input autoFocus value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="tp-field">
            <span>{i18n.t('topic.form.desc')}</span>
            <Input.TextArea value={desc} maxLength={300} autoSize={{ minRows: 2, maxRows: 4 }} onChange={(e) => setDesc(e.target.value)} />
          </label>
          <div className="tp-form-actions">
            <Button type="primary" htmlType="submit" disabled={!name.trim()}>{i18n.t('topic.form.save')}</Button>
            <Button onClick={() => { setEditing(false); setName(topic.name); setDesc(topic.description) }}>{i18n.t('topic.form.cancel')}</Button>
          </div>
        </form>
      ) : (
        <div>
          <h1>{topic.name}</h1>
          {topic.description && <p>{topic.description}</p>}
          <div className="tp-meta">
            <span><b>{topic.file_count}</b>{i18n.t('topic.stat.files')}</span>
            {topic.categories > 0 && <span><b>{topic.categories}</b>{i18n.t('topic.stat.categories')}</span>}
            {ready && <span><b>{topic.stats.entities.toLocaleString()}</b>{i18n.t('topic.stat.entities')}</span>}
            {ready && <span><b>{topic.stats.claims.toLocaleString()}</b>{i18n.t('topic.stat.claims')}</span>}
            {topic.bytes > 0 && <span>{i18n.t('topic.stat.size', { size: formatBytes(topic.bytes) })}</span>}
          </div>
        </div>
      )}
      {topic.can_manage && !editing && (
        <div className="tp-title-tools">
          <button type="button" className="tp-icon" onClick={() => setEditing(true)} title={i18n.t('topic.action.edit')} aria-label={i18n.t('topic.action.edit')}>
            <EditOutlined />
          </button>
          <Popconfirm
            title={i18n.t('topic.action.deleteConfirm', { name: topic.name })}
            okText={i18n.t('topic.action.deleteOk')}
            okButtonProps={{ danger: true }}
            disabled={isBusy(topic.status)}
            onConfirm={() => deleteTopic(topic.id).then(() => {
              message.success(i18n.t('topic.action.deleted'))
              navigate('/topics')
            }).catch(() => {})}
          >
            <button type="button" className="tp-icon" disabled={isBusy(topic.status)} title={i18n.t('topic.action.delete')} aria-label={i18n.t('topic.action.delete')}>
              <DeleteOutlined />
            </button>
          </Popconfirm>
        </div>
      )}
    </section>
  )
}

function LogPanel({ lines }: { lines: string[] }) {
  const pre = useRef<HTMLPreElement>(null)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (open && pre.current) pre.current.scrollTop = pre.current.scrollHeight
  }, [lines, open])
  return (
    <details className="tp-log" onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary><RightOutlined />{i18n.t('topic.log.title')}</summary>
      <pre ref={pre}>{lines.length ? lines.join('\n') : i18n.t('topic.log.empty')}</pre>
    </details>
  )
}

export default function TopicDetailPage() {
  const { topicId = '' } = useParams()
  const [topic, setTopic] = useState<TopicDetail | null>(null)
  const [missing, setMissing] = useState(false)

  const load = useCallback(() => getTopic(topicId)
    .then((t) => { setTopic(t); setMissing(false) })
    .catch((e) => { if (e?.response?.status === 404) setMissing(true) }), [topicId])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    document.title = topic ? i18n.t('topic.detailTitle', { name: topic.name }) : i18n.t('topic.docTitle')
  }, [topic])

  const busy = isBusy(topic?.status)
  useEffect(() => {
    const timer = window.setInterval(load, busy ? 3000 : 20000)
    return () => window.clearInterval(timer)
  }, [busy, load])

  return (
    <div className="hm-page tp-page">
      <div className="paper-nebula" />
      <TopicHeader />
      <main className="tp-main">
        <Link to="/topics" className="tp-crumb"><LeftOutlined />{i18n.t('topic.list')}</Link>
        {!topic && !missing && <div className="tp-empty">{i18n.t('topic.loading')}</div>}
        {missing && <div className="tp-empty">{i18n.t('topic.notFound')}</div>}
        {topic && (
          <>
            <TitleBlock key={`${topic.name}|${topic.description}`} topic={topic} onChanged={load} />
            {!topic.can_manage && <AccessPanel onSaved={load} />}
            <div className="tp-grid">
              <RunPanel topic={topic} onChanged={load} />
              {topic.can_manage && <AddPanel topic={topic} onChanged={load} />}
            </div>
            <FileList topic={topic} onChanged={load} />
            <LogPanel lines={topic.log} />
          </>
        )}
      </main>
    </div>
  )
}
