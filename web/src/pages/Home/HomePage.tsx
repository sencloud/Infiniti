/**
 * 首页：按分类浏览全部学习材料（文学名著 / 经史典籍 / 学科知识 / 自由探索）+ 跨材料总搜索。
 * 视觉沿用 /people 旧首页的纸墨风格：暖纸底、墨字、朱砂点缀、宋体标题。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { listGraphs, searchAllGraphs, type GlobalSearchHit, type GraphCategory } from '@/api/kg-explore'
import type { GraphSummary } from '@/graph/profile'
import { BrandMark, LocaleToggle, ThemeToggle } from '@/theme/ThemeProvider'
import i18n from '@/i18n'
import { importGuideUrl, peopleHref } from '@/i18n/locale'
import { useIsMobile } from '@/hooks/useIsMobile'
import './home.css'

function peopleCategory(): GraphCategory {
  return {
    id: 'people',
    name: i18n.t('home.freeName'),
    description: i18n.t('home.freeDesc'),
  }
}

const STEP_KEYS: Record<string, string> = {
  crawl: 'home.stepCrawl',
  seeds: 'home.stepSeeds',
  extract: 'home.stepExtract',
  load: 'home.stepLoad',
  build: 'home.stepBuild',
}

const isTopic = (g: GraphSummary) => g.category === 'topic'

function buildText(g: GraphSummary): string {
  const b = g.build
  if (!b) return i18n.t('home.wait')
  if (b.state === 'failed' || b.state === 'stopped') return i18n.t('home.interrupted')
  if (b.step === 'extract' && b.units) return i18n.t('home.extracting', { done: b.extracted ?? 0, total: b.units })
  if (isTopic(g) && b.step === 'crawl') {
    return b.ingest?.files_total
      ? i18n.t('home.ingesting', { done: b.ingest.files_done, total: b.ingest.files_total })
      : i18n.t('home.stepIngest')
  }
  return b.step ? (STEP_KEYS[b.step] ? i18n.t(STEP_KEYS[b.step]) : b.step) : i18n.t('home.wait')
}

function buildPct(g: GraphSummary): number {
  const b = g.build
  if (!b?.step) return 4
  const order = ['crawl', 'seeds', 'extract', 'load', 'build']
  const i = order.indexOf(b.step)
  let within = 0.3
  if (b.step === 'extract' && b.units) within = (b.extracted ?? 0) / b.units
  if (b.step === 'crawl' && b.ingest?.files_total) within = b.ingest.files_done / b.ingest.files_total
  return Math.round(((Math.max(i, 0) + within) / order.length) * 100)
}

/** 线装书题签式封面：没有封面图时用书名竖排 */
function BookCover({ graph }: { graph: GraphSummary }) {
  const [failed, setFailed] = useState(false)
  if (graph.cover && !failed) {
    return (
      <div className="hm-cover">
        <img src={graph.cover} alt={graph.name} loading="lazy" onError={() => setFailed(true)} />
      </div>
    )
  }
  return (
    <div className={`hm-cover hm-cover-type cat-${graph.category}`}>
      <span className="hm-cover-slip">{graph.book || graph.name}</span>
    </div>
  )
}

function GraphCard({ graph }: { graph: GraphSummary }) {
  const s = graph.stats
  return (
    <article className={`hm-card ${graph.ready ? '' : 'is-pending'}`}>
      {graph.ready ? (
        <Link to={`/g/${graph.id}/galaxy`} className="hm-card-cover-link" aria-label={i18n.t('home.enter', { name: graph.name })}>
          <BookCover graph={graph} />
        </Link>
      ) : <BookCover graph={graph} />}
      <div className="hm-card-body">
        <h3>{graph.name}</h3>
        <p className="hm-card-desc">{graph.description}</p>
        {graph.ready ? (
          <>
            <div className="hm-card-stats">
              <span><b>{s.units}</b> {graph.unit.name}</span>
              <span><b>{s.entities.toLocaleString()}</b> {i18n.t('common.entryNoun', { count: s.entities })}</span>
              <span><b>{s.claims.toLocaleString()}</b> {i18n.t('common.relationNoun', { count: s.claims })}</span>
            </div>
            <div className="hm-card-actions">
              <Link to={`/g/${graph.id}/galaxy`} className="hm-btn main">{i18n.t('home.galaxy')}</Link>
              <Link to={`/g/${graph.id}/explore`} className="hm-btn ghost">{i18n.t('home.explore')}</Link>
              {isTopic(graph) && <Link to={`/topics/${graph.id}`} className="hm-btn ghost">{i18n.t('home.topicManage')}</Link>}
            </div>
          </>
        ) : (
          <div className="hm-card-pending">
            <div className="hm-progress"><span style={{ width: `${buildPct(graph)}%` }} /></div>
            <span>{buildText(graph)}</span>
            {isTopic(graph) && (
              <div className="hm-card-actions">
                <Link to={`/topics/${graph.id}`} className="hm-btn ghost">{i18n.t('home.topicProgress')}</Link>
              </div>
            )}
          </div>
        )}
      </div>
    </article>
  )
}

/** 专题分区末尾：新建或管理自己的专题（虚线框 = 你的资料放这里） */
function NewTopicCard() {
  return (
    <Link to="/topics" className="hm-card hm-topic-new">
      <div className="hm-card-body">
        <h3>{i18n.t('home.topicNew')}</h3>
        <p className="hm-card-desc">{i18n.t('home.topicNewDesc')}</p>
        <span className="hm-topic-new-go">{i18n.t('home.topicNewGo')}</span>
      </div>
    </Link>
  )
}

function PeopleCard({ persons }: { persons: number | null }) {
  return (
    <article className="hm-card">
      <a href={peopleHref()} className="hm-card-cover-link" aria-label={i18n.t('home.freeEnter')}>
        <div className="hm-cover hm-cover-type cat-people">
          <span className="hm-cover-slip">{i18n.t('home.freeName')}</span>
        </div>
      </a>
      <div className="hm-card-body">
        <h3>{i18n.t('home.peopleTitle')}</h3>
        <p className="hm-card-desc">{peopleCategory().description}</p>
        <div className="hm-card-stats">
          {persons != null && <span>{i18n.t('home.peopleCount', { count: persons.toLocaleString() })}</span>}
          <span>{i18n.t('home.peopleExamples')}</span>
        </div>
        <div className="hm-card-actions">
          <a href={peopleHref()} className="hm-btn main">{i18n.t('home.peopleAction')}</a>
        </div>
      </div>
    </article>
  )
}

function ShelfBook({ graph }: { graph: GraphSummary }) {
  const s = graph.stats
  const body = (
    <>
      <BookCover graph={graph} />
      <div className="hm-shelf-info">
        <h3>{graph.name}</h3>
        {graph.ready ? (
          <span>{i18n.t('home.shelf', { units: s.units, unit: graph.unit.name, entities: s.entities.toLocaleString() })}</span>
        ) : (
          <span className="hm-shelf-pending">{buildText(graph)}</span>
        )}
      </div>
    </>
  )
  return graph.ready
    ? <Link to={`/g/${graph.id}/explore`} className="hm-shelf-book">{body}</Link>
    : <div className="hm-shelf-book is-pending">{body}</div>
}

function CourseRow({ graph }: { graph: GraphSummary }) {
  const s = graph.stats
  const body = (
    <>
      <BookCover graph={graph} />
      <div className="hm-row-body">
        <h3>{graph.name}</h3>
        <span>
          {graph.ready
            ? i18n.t('home.knowledge', { units: s.units, unit: graph.unit.name, entities: s.entities.toLocaleString() })
            : buildText(graph)}
        </span>
      </div>
      {graph.ready && <span className="hm-row-go">{i18n.t('home.goNetwork')}</span>}
    </>
  )
  return graph.ready
    ? <Link to={`/g/${graph.id}/explore`} className="hm-row">{body}</Link>
    : <div className="hm-row is-pending">{body}</div>
}

function MobileCatalog({ catalog, persons }: {
  catalog: { categories: GraphCategory[]; items: GraphSummary[] }
  persons: number | null
}) {
  const books = catalog.items.filter((g) => g.category !== 'subject' && !isTopic(g))
  const courses = catalog.items.filter((g) => g.category === 'subject')
  const topics = catalog.items.filter(isTopic)
  return (
    <main className="hm-main hm-m-main">
      <section className="hm-m-section">
        <div className="hm-m-head">
          <h2>{i18n.t('home.books')}</h2>
          <span>{i18n.t('home.booksMeta', { count: books.length })}</span>
        </div>
        <div className="hm-shelf">
          {books.map((g) => <ShelfBook key={g.id} graph={g} />)}
        </div>
      </section>

      {courses.length > 0 && (
        <section className="hm-m-section">
          <div className="hm-m-head"><h2>{i18n.t('home.course')}</h2></div>
          {courses.map((g) => <CourseRow key={g.id} graph={g} />)}
        </section>
      )}

      <section className="hm-m-section">
        <div className="hm-m-head"><h2>{i18n.t('home.topics')}</h2></div>
        {topics.map((g) => <CourseRow key={g.id} graph={g} />)}
        <Link to="/topics" className="hm-import">
          <p>{i18n.t('home.topicNewDesc')}</p>
          <span>{i18n.t('home.topicNewGo')}</span>
        </Link>
      </section>

      <section className="hm-m-section">
        <div className="hm-m-head"><h2>{i18n.t('home.free')}</h2></div>
        <a href={peopleHref()} className="hm-row">
          <div className="hm-cover hm-cover-type cat-people">
            <span className="hm-cover-slip">{i18n.t('home.freeName')}</span>
          </div>
          <div className="hm-row-body">
            <h3>{i18n.t('home.peopleTitle')}</h3>
            <span>
              {persons ? i18n.t('home.peopleCount', { count: persons.toLocaleString() }) : ''}{i18n.t('home.peopleExamples')}
            </span>
          </div>
          <span className="hm-row-go">{i18n.t('home.peopleAction')}</span>
        </a>
      </section>

      <section className="hm-m-section">
        <div className="hm-m-head"><h2>{i18n.t('home.tech')}</h2></div>
        <a href={importGuideUrl()} target="_blank" rel="noreferrer" className="hm-import">
          <p>{i18n.t('home.import')}</p>
          <span>{i18n.t('home.importLink')}</span>
        </a>
      </section>
    </main>
  )
}

function GlobalSearch({ compact = false }: { compact?: boolean }) {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<GlobalSearchHit[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [sel, setSel] = useState(0)
  const seq = useRef(0)

  useEffect(() => {
    const kw = q.trim()
    const my = ++seq.current
    const timer = window.setTimeout(() => {
      if (!kw) { setHits([]); setLoading(false); return }
      setLoading(true)
      searchAllGraphs(kw, 4)
        .then((r) => { if (my === seq.current) { setHits(r.items); setSel(0) } })
        .catch(() => { if (my === seq.current) setHits([]) })
        .finally(() => { if (my === seq.current) setLoading(false) })
    }, 280)
    return () => window.clearTimeout(timer)
  }, [q])

  const go = (hit: GlobalSearchHit) => navigate(`/g/${hit.graph_id}/explore?entity=${encodeURIComponent(hit.entity_id)}`)

  return (
    <div className="hm-search" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false) }}>
      <div className="hm-search-box">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" />
        </svg>
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel((i) => Math.min(i + 1, hits.length - 1)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((i) => Math.max(i - 1, 0)) }
            else if (e.key === 'Enter' && hits[sel]) go(hits[sel])
            else if (e.key === 'Escape') setOpen(false)
          }}
          placeholder={compact ? i18n.t('home.searchCompact') : i18n.t('home.searchFull')}
          aria-label={i18n.t('home.searchAria')}
          enterKeyHint="search"
        />
        {!compact && <button type="button" className="go" onClick={() => hits[sel] && go(hits[sel])}>{i18n.t('common.search')}</button>}
      </div>
      {open && q.trim() && (
        <div className="hm-search-drop" role="listbox">
          {loading && !hits.length && <div className="hm-drop-status">{i18n.t('home.searching')}</div>}
          {!loading && !hits.length && <div className="hm-drop-status">{i18n.t('home.noHit', { q: q.trim() })}</div>}
          {hits.map((hit, i) => (
            <button
              type="button"
              key={`${hit.graph_id}:${hit.entity_id}`}
              className={`hm-drop-item ${i === sel ? 'sel' : ''}`}
              onMouseEnter={() => setSel(i)}
              onClick={() => go(hit)}
            >
              <span className="hm-drop-main">
                <span className="n">{hit.canonical_name}</span>
                {hit.title && hit.title !== hit.canonical_name && <span className="o">{hit.title}</span>}
              </span>
              <span className="d">{hit.graph_name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function HomePage() {
  const [catalog, setCatalog] = useState<{ categories: GraphCategory[]; items: GraphSummary[] } | null>(null)
  const [persons, setPersons] = useState<number | null>(null)
  const [active, setActive] = useState<string>('all')
  const mobile = useIsMobile()

  useEffect(() => {
    document.title = i18n.t('home.docTitle')
    document.querySelector('meta[name="description"]')?.setAttribute('content', i18n.t('home.meta'))
    const load = () => listGraphs().then(setCatalog).catch(() => {})
    load()
    // 后台批处理还在跑时，卡片进度每 20 秒刷新一次
    const timer = window.setInterval(load, 20000)
    fetch('/api/stats').then((r) => r.json()).then((j) => setPersons(j?.persons ?? null)).catch(() => {})
    return () => window.clearInterval(timer)
  }, [])

  const categories = useMemo(() => [...(catalog?.categories || []), peopleCategory()], [catalog])
  const shown = active === 'all' ? categories : categories.filter((c) => c.id === active)
  const readyCount = catalog?.items.filter((g) => g.ready).length ?? 0

  return (
    <div className="hm-page">
      <div className="paper-nebula" />
      <header className="hm-header">
        <Link to="/" className="hm-brand">
          <BrandMark size={40} />
          <div>
            <div className="hm-brand-name">{i18n.t('home.brand')}{i18n.t('home.brandEm') ? <b>{i18n.t('home.brandEm')}</b> : null}</div>
            <div className="hm-brand-sub">{i18n.t('home.brandSub')}</div>
          </div>
        </Link>
        <div className="hm-header-actions">
          <Link to="/topics" className="hm-header-link">{i18n.t('home.topics')}</Link>
          <a href={peopleHref()} className="hm-header-link" title={i18n.t('home.freeTitle')}>{i18n.t('home.free')}</a>
          <LocaleToggle />
          <ThemeToggle />
        </div>
      </header>

      <section className="hm-hero">
        <h1><span className="hm-h1-line">{i18n.t('home.hero1')}</span><span className="hm-h1-line">{i18n.t('home.hero2')}<b>{i18n.t('home.hero2em')}</b></span></h1>
        <p className="hm-tagline">{i18n.t('home.tagline')}</p>
        <GlobalSearch compact={mobile} />
        {mobile ? (
          <ol className="hm-steps" aria-label={i18n.t('home.how')}>
            <li>{i18n.t('home.step1')}</li>
            <li>{i18n.t('home.step2')}</li>
            <li>{i18n.t('home.step3')}</li>
          </ol>
        ) : (
        <nav className="hm-chips" aria-label={i18n.t('home.cats')}>
          {[{ id: 'all', name: i18n.t('home.all') }, ...categories].map((c) => (
            <button
              type="button"
              key={c.id}
              className={`hm-chip ${active === c.id ? 'on' : ''}`}
              onClick={() => setActive(c.id)}
            >
              {c.name}
            </button>
          ))}
        </nav>
        )}
      </section>

      {mobile && catalog ? <MobileCatalog catalog={catalog} persons={persons} /> : (
      <main className="hm-main">
        {!catalog && <div className="hm-loading">{i18n.t('home.loading')}</div>}
        {catalog && shown.map((cat) => {
          const graphs = cat.id === 'people' ? [] : catalog.items.filter((g) => g.category === cat.id)
          return (
            <section key={cat.id} className="hm-section">
              <div className="hm-section-head">
                <h2>{cat.name}</h2>
                <p>{cat.description}</p>
              </div>
              <div className="hm-grid">
                {cat.id === 'people'
                  ? <PeopleCard persons={persons} />
                  : graphs.map((g) => <GraphCard key={g.id} graph={g} />)}
                {cat.id === 'topic' && <NewTopicCard />}
              </div>
            </section>
          )
        })}
      </main>
      )}

      <footer className="hm-footer">
        {catalog && (
          <span>
            {readyCount < catalog.items.length
              ? i18n.t('home.footerPartial', { ready: readyCount, total: catalog.items.length })
              : i18n.t('home.footerAll', { count: catalog.items.length })}
          </span>
        )}
        <span>{i18n.t('home.credit')}</span>
      </footer>
    </div>
  )
}
