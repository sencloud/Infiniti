/**
 * 专题列表：自己导入的资料（标准规范、制度文件、讲义），每个专题一张知识网。
 * 有管理权限时可以新建；没有时提示在服务器本机操作或填管理口令。
 */
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button, Input } from 'antd'
import { LeftOutlined } from '@ant-design/icons'
import { createTopic, listTopics, type TopicPreset, type TopicSummary } from '@/api/topics'
import i18n from '@/i18n'
import { AccessPanel, isBusy, StatusLine, TopicCover, TopicHeader } from './shared'

function CreateForm({ presets, onCancel }: { presets: TopicPreset[]; onCancel: () => void }) {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [preset, setPreset] = useState(presets[0]?.id || 'standards')
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    if (!name.trim()) return
    setSaving(true)
    try {
      const t = await createTopic({ name: name.trim(), description: description.trim(), preset })
      navigate(`/topics/${t.id}`)
    } catch {
      setSaving(false)
    }
  }

  return (
    <form className="tp-panel tp-form" onSubmit={(e) => { e.preventDefault(); submit() }}>
      <label className="tp-field">
        <span>{i18n.t('topic.form.name')}</span>
        <Input
          autoFocus
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
          placeholder={i18n.t('topic.form.namePh')}
        />
      </label>
      <label className="tp-field">
        <span>{i18n.t('topic.form.desc')}</span>
        <Input.TextArea
          value={description}
          maxLength={300}
          autoSize={{ minRows: 2, maxRows: 4 }}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={i18n.t('topic.form.descPh')}
        />
      </label>
      <div className="tp-field" role="radiogroup" aria-label={i18n.t('topic.form.preset')}>
        <span>{i18n.t('topic.form.preset')}</span>
        <div className="tp-presets">
          {presets.map((p) => (
            <button
              type="button"
              role="radio"
              aria-checked={preset === p.id}
              key={p.id}
              className={`tp-preset ${preset === p.id ? 'on' : ''}`}
              onClick={() => setPreset(p.id)}
            >
              <b>{p.name}</b>
              <span>{p.description}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="tp-form-actions">
        <Button type="primary" htmlType="submit" loading={saving} disabled={!name.trim()}>
          {i18n.t('topic.form.create')}
        </Button>
        <Button onClick={onCancel}>{i18n.t('topic.form.cancel')}</Button>
      </div>
    </form>
  )
}

function TopicRow({ topic }: { topic: TopicSummary }) {
  const ready = topic.stats.claims > 0
  const s = topic.stats
  return (
    <li className="tp-row">
      <Link to={`/topics/${topic.id}`} tabIndex={-1} aria-hidden="true">
        <TopicCover name={topic.name} />
      </Link>
      <div>
        <h3><Link to={`/topics/${topic.id}`}>{topic.name}</Link></h3>
        {topic.description && <p className="tp-row-desc">{topic.description}</p>}
        <div className="tp-meta">
          <span><b>{topic.file_count}</b>{i18n.t('topic.stat.files')}</span>
          {topic.categories > 0 && <span><b>{topic.categories}</b>{i18n.t('topic.stat.categories')}</span>}
          {ready && <span><b>{s.entities.toLocaleString()}</b>{i18n.t('topic.stat.entities')}</span>}
          {ready && <span><b>{s.claims.toLocaleString()}</b>{i18n.t('topic.stat.claims')}</span>}
        </div>
        {(!ready || isBusy(topic.status)) && <StatusLine topic={topic} />}
      </div>
      <div className="tp-row-actions">
        {ready && <Link to={`/g/${topic.id}/galaxy`} className="hm-btn ghost">{i18n.t('topic.action.galaxy')}</Link>}
        {ready && <Link to={`/g/${topic.id}/explore`} className="hm-btn ghost">{i18n.t('topic.action.explore')}</Link>}
        <Link to={`/topics/${topic.id}`} className="hm-btn ghost">{i18n.t('topic.action.manage')}</Link>
      </div>
    </li>
  )
}

export default function TopicsPage() {
  const [data, setData] = useState<Awaited<ReturnType<typeof listTopics>> | null>(null)
  const [creating, setCreating] = useState(false)

  const load = useCallback(() => listTopics().then(setData).catch(() => {}), [])

  useEffect(() => {
    document.title = i18n.t('topic.docTitle')
    load()
  }, [load])

  const anyBusy = data?.items.some((t) => isBusy(t.status))
  useEffect(() => {
    const timer = window.setInterval(load, anyBusy ? 5000 : 30000)
    return () => window.clearInterval(timer)
  }, [anyBusy, load])

  return (
    <div className="hm-page tp-page">
      <div className="paper-nebula" />
      <TopicHeader />
      <main className="tp-main">
        <Link to="/" className="tp-crumb"><LeftOutlined />{i18n.t('topic.home')}</Link>
        <div className="tp-head">
          <div>
            <h1>{i18n.t('topic.title')}</h1>
            <p className="tp-lead">{i18n.t('topic.lead')}</p>
          </div>
          {data?.can_manage && !creating && (
            <button type="button" className="hm-btn main" onClick={() => setCreating(true)}>{i18n.t('topic.new')}</button>
          )}
        </div>

        {data && !data.can_manage && <AccessPanel onSaved={load} />}
        {creating && data && <CreateForm presets={data.presets} onCancel={() => setCreating(false)} />}

        {!data && <div className="tp-empty">{i18n.t('topic.loading')}</div>}
        {data && !data.items.length && !creating && <div className="tp-empty">{i18n.t('topic.empty')}</div>}
        {data && data.items.length > 0 && (
          <ul className="tp-list">
            {data.items.map((t) => <TopicRow key={t.id} topic={t} />)}
          </ul>
        )}
      </main>
    </div>
  )
}
