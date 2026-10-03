/** 专题列表页与详情页共用：顶栏、状态文字与进度、管理口令输入 */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { App, Button, Input } from 'antd'
import { adminToken, setAdminToken } from '@/api/adminToken'
import type { TopicStatus, TopicSummary } from '@/api/topics'
import { BrandMark, LocaleToggle, ThemeToggle } from '@/theme/ThemeProvider'
import i18n from '@/i18n'
import '../Home/home.css'
import './topics.css'

export const STEP_ORDER = ['crawl', 'seeds', 'extract', 'load', 'build']

export function TopicHeader() {
  return (
    <header className="hm-header">
      <Link to="/" className="hm-brand" aria-label={i18n.t('topic.home')}>
        <BrandMark size={40} />
        <div>
          <div className="hm-brand-name">{i18n.t('home.brand')}{i18n.t('home.brandEm') ? <b>{i18n.t('home.brandEm')}</b> : null}</div>
          <div className="hm-brand-sub">{i18n.t('home.brandSub')}</div>
        </div>
      </Link>
      <div className="hm-header-actions">
        <LocaleToggle />
        <ThemeToggle />
      </div>
    </header>
  )
}

export function isBusy(s: TopicStatus | null | undefined): boolean {
  return s?.state === 'running' || s?.state === 'queued'
}

/** 整条管线的完成度（0–1）：转写按份数，抽取按份数，其余步骤按步计 */
export function progressOf(s: TopicStatus): number {
  if (s.state === 'done') return 1
  if (!s.step) return 0.02
  const i = Math.max(STEP_ORDER.indexOf(s.step), 0)
  let within = 0.3
  if (s.step === 'crawl' && s.ingest?.files_total) within = s.ingest.files_done / s.ingest.files_total
  if (s.step === 'extract' && s.units) within = (s.extracted ?? 0) / s.units
  return Math.min(1, (i + within) / STEP_ORDER.length)
}

export function stateText(s: TopicStatus): string {
  if (s.external && s.state === 'running') return i18n.t('topic.state.external')
  if (s.state === 'running' && s.step) return `${i18n.t('topic.state.running')} · ${i18n.t(`topic.step.${s.step}`)}`
  if (!s.state) return i18n.t('topic.state.none')
  return i18n.t(`topic.state.${s.state}`)
}

export function StatusLine({ topic }: { topic: TopicSummary }) {
  const s = topic.status
  const busy = isBusy(s)
  return (
    <div className="tp-status">
      <span className={`tp-dot is-${s.state || 'none'}`} aria-hidden="true" />
      <span>{stateText(s)}</span>
      {busy && (
        <span className="tp-bar" aria-hidden="true">
          <span style={{ transform: `scaleX(${progressOf(s)})` }} />
        </span>
      )}
    </div>
  )
}

export function TopicCover({ name }: { name: string }) {
  return (
    <div className="hm-cover hm-cover-type cat-topic">
      <span className="hm-cover-slip">{name}</span>
    </div>
  )
}

export function formatBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`
  if (n >= 1024 ** 2) return `${Math.round(n / 1024 ** 2)} MB`
  return `${Math.max(1, Math.round(n / 1024))} KB`
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleString(i18n.language.startsWith('en') ? 'en' : 'zh-CN', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

/** 没有管理权限时：说明原因，可填管理口令（存浏览器，之后每个请求都带上） */
export function AccessPanel({ onSaved }: { onSaved: () => void }) {
  const { message } = App.useApp()
  const [token, setToken] = useState(adminToken())
  return (
    <section className="tp-panel tp-access">
      <h2>{i18n.t('topic.access.title')}</h2>
      <p>{i18n.t('topic.access.desc')}</p>
      <form
        className="tp-access-row"
        onSubmit={(e) => {
          e.preventDefault()
          setAdminToken(token.trim())
          message.success(i18n.t('topic.access.saved'))
          onSaved()
        }}
      >
        <Input.Password
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder={i18n.t('topic.access.ph')}
          autoComplete="current-password"
        />
        <Button htmlType="submit">{i18n.t('topic.access.save')}</Button>
      </form>
    </section>
  )
}
