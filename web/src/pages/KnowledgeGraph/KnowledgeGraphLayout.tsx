import { useEffect, useMemo, useState } from 'react'
import { Link, NavLink, Outlet, useNavigate, useParams } from 'react-router-dom'
import { Dropdown, Result, Button, Spin, type MenuProps } from 'antd'
import { ClusterOutlined, CompassOutlined, DownOutlined } from '@ant-design/icons'
import { getGraphProfile, listGraphs, type GraphCategory } from '@/api/kg-explore'
import { setActiveProfile, type GraphProfile, type GraphSummary } from '@/graph/profile'
import { BrandMark, ThemeToggle } from '@/theme/ThemeProvider'
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
        document.title = `${p.name} · 知识图谱 · 无限连接`
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
      onClick: ({ key }) => navigate(`/g/${key}/galaxy`),
    }
  }, [catalog, graphId, navigate])

  const stats = profile?.stats
  const t = profile?.terms

  return (
    <div className="kg-shell kg-scope">
      <header className="kg-appbar">
        <Link className="kg-appbar-home" to="/" title="返回首页">
          <BrandMark size={30} />
        </Link>
        <div className="kg-appbar-brand">
          {switchMenu ? (
            <Dropdown menu={switchMenu} trigger={['click']} placement="bottomLeft">
              <button type="button" className="kg-appbar-switch">
                <b>{profile?.name || '…'}</b>
                <DownOutlined />
              </button>
            </Dropdown>
          ) : <b>{profile?.name || '…'}</b>}
          <span className="kg-appbar-sub">知识图谱</span>
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
              {stats.entities > 0 && <span><b>{stats.entities.toLocaleString()}</b> 实体</span>}
              {stats.claims > 0 && <span><b>{stats.claims.toLocaleString()}</b> 事实</span>}
            </>
          )}
        </div>
        <ThemeToggle />
      </header>
      <main className="kg-shell-body">
        {error ? (
          <Result
            status="404"
            title="没有这个图谱"
            subTitle={error}
            extra={<Button type="primary" onClick={() => navigate('/')}>回到首页</Button>}
          />
        ) : !profile || profile.id !== graphId ? (
          <div className="kg-shell-loading"><Spin /></div>
        ) : !profile.stats?.claims ? (
          <Result
            status="info"
            title={`${profile.name}还在整理中`}
            subTitle="后台正在抓取原文、抽取事实并构建星图，完成后这里会自动可用。"
            extra={<Button onClick={() => navigate('/')}>看看其他图谱</Button>}
          />
        ) : (
          <Outlet key={graphId} />
        )}
      </main>
    </div>
  )
}

export default KnowledgeGraphLayout
