import { useEffect, useMemo, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom'
import { Dropdown, Result, Button, Spin, type MenuProps } from 'antd'
import { ClusterOutlined, CompassOutlined, DownOutlined, LeftOutlined } from '@ant-design/icons'
import { getGraphProfile, listGraphs, type GraphCategory } from '@/api/kg-explore'
import { setActiveProfile, type GraphProfile, type GraphSummary } from '@/graph/profile'
import { BrandMark, ThemeToggle } from '@/theme/ThemeProvider'
import { useIsMobile } from '@/hooks/useIsMobile'
import './tokens.css'
import './graph.css'
import './layout.css'

/**
 * 单个图谱的外壳：顶栏（品牌 / 图谱切换 / 语义星图 · 关系探索 / 计数 / 主题）+ 全高画布。
 * 先拉取图谱配置并设为激活图谱，再挂载页面；切换图谱时以 graphId 为 key 整体重挂载，
 * 页面里的模块级缓存与 ECharts 实例都随之重建。
 */
function KnowledgeGraphLayout() {
  const { graphId = '' } = useParams()
  const navigate = useNavigate()
  const { pathname, search } = useLocation()
  const onGalaxy = pathname.endsWith('/galaxy')
  const [profile, setProfile] = useState<GraphProfile | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [catalog, setCatalog] = useState<{ categories: GraphCategory[]; items: GraphSummary[] } | null>(null)

  useEffect(() => {
    let cancelled = false
    setProfile(null)
    setError(null)
    setActiveProfile(null)
    getGraphProfile(graphId)
      .then((p) => {
        if (cancelled) return
        setActiveProfile(p)
        setProfile(p)
        document.title = `${p.name} · 学习图谱 · 无限连接`
      })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : '图谱不存在') })
    return () => { cancelled = true }
  }, [graphId])

  useEffect(() => {
    listGraphs().then(setCatalog).catch(() => {})
  }, [])

  const switchMenu = useMemo<MenuProps | null>(() => {
    if (!catalog) return null
    return {
      selectedKeys: [graphId],
      items: catalog.categories
        .map((cat) => ({
          type: 'group' as const,
          key: cat.id,
          label: cat.name,
          children: catalog.items
            .filter((g) => g.category === cat.id)
            .map((g) => ({
              key: g.id,
              disabled: !g.ready,
              label: <span className="kg-switch-item">{g.name}{!g.ready && <em>整理中</em>}</span>,
            })),
        }))
        .filter((group) => group.children.length),
      onClick: ({ key }) => navigate(`/g/${key}/${onGalaxy ? 'galaxy' : 'explore'}`),
    }
  }, [catalog, graphId, navigate, onGalaxy])

  const stats = profile?.stats
  const t = profile?.terms
  const mobile = useIsMobile()
  const view = onGalaxy
    ? 'galaxy'
    : new URLSearchParams(search).get('mode') === 'clue' ? 'clue' : 'explore'

  const title = switchMenu ? (
    <Dropdown menu={switchMenu} trigger={['click']} placement={mobile ? 'bottom' : 'bottomLeft'}>
      <button type="button" className="kg-appbar-switch" aria-label="切换学习材料">
        <b>{profile?.name || '…'}</b>
        <DownOutlined />
      </button>
    </Dropdown>
  ) : <b>{profile?.name || '…'}</b>

  return (
    <div className="kg-shell kg-scope">
      {mobile ? (
        <header className="kg-mbar">
          <div className="kg-mbar-row">
            <Link className="kg-mbar-back" to="/" aria-label="返回首页"><LeftOutlined /></Link>
            <div className="kg-mbar-title">{title}</div>
            <ThemeToggle />
          </div>
          <nav className="kg-mbar-seg" aria-label="学习视图">
            <Link to={`/g/${graphId}/explore`} className={view === 'explore' ? 'on' : ''} aria-current={view === 'explore' ? 'page' : undefined}>关系</Link>
            <Link to={`/g/${graphId}/galaxy`} className={view === 'galaxy' ? 'on' : ''} aria-current={view === 'galaxy' ? 'page' : undefined}>星图</Link>
            <Link to={`/g/${graphId}/explore?mode=clue`} className={view === 'clue' ? 'on' : ''} aria-current={view === 'clue' ? 'page' : undefined}>线索</Link>
          </nav>
        </header>
      ) : (
      <header className="kg-appbar">
        <Link className="kg-appbar-home" to="/" title="返回首页">
          <BrandMark size={30} />
        </Link>
        <div className="kg-appbar-brand">
          {title}
          <span className="kg-appbar-sub">学习图谱</span>
        </div>
        <nav className="kg-appbar-tabs">
          <NavLink to={`/g/${graphId}/galaxy`} className={({ isActive }) => (isActive ? 'active' : '')}>
            <ClusterOutlined /> <span>语义星图</span>
          </NavLink>
          <NavLink to={`/g/${graphId}/explore`} className={({ isActive }) => (isActive ? 'active' : '')}>
            <CompassOutlined /> <span>关系探索</span>
          </NavLink>
        </nav>
        <div className="kg-appbar-stats">
          {stats && t && (
            <>
              <span><b>{stats.units}</b> {profile?.unit.name}</span>
              {stats.clusters > 0 && <span><b>{stats.clusters}</b> {t.cluster}</span>}
              {stats.entities > 0 && <span><b>{stats.entities.toLocaleString()}</b> 条目</span>}
              {stats.claims > 0 && <span><b>{stats.claims.toLocaleString()}</b> 条关系</span>}
            </>
          )}
        </div>
        <ThemeToggle />
      </header>
      )}
      <main className="kg-shell-body">
        {error ? (
          <Result
            status="404"
            title="没有找到这份学习材料"
            subTitle={error}
            extra={<Button type="primary" onClick={() => navigate('/')}>回到首页</Button>}
          />
        ) : !profile || profile.id !== graphId ? (
          <div className="kg-shell-loading"><Spin /></div>
        ) : !profile.stats?.claims ? (
          <Result
            status="info"
            title={`${profile.name}还在整理中`}
            subTitle="后台正在抓取原文、抽取关系并构建星图，完成后这里会自动可用。"
            extra={<Button onClick={() => navigate('/')}>看看其他材料</Button>}
          />
        ) : (
          <Outlet key={graphId} />
        )}
      </main>
    </div>
  )
}

export default KnowledgeGraphLayout
