/**
 * 影视对照播放弹窗：B 站外链播放器（player.bilibili.com），不自动播放。
 * 手机上全宽、16:9；桌面 880px。
 */
import { useEffect, useState } from 'react'
import { Modal } from 'antd'
import { activeGraphId } from '@/graph/profile'
import { getVideoCatalog, type VideoCatalog, type VideoEpisode } from '@/api/knowledge-graph'
import { useIsMobile } from '@/hooks/useIsMobile'
import i18n from '@/i18n'
import './videoModal.css'

export interface VideoTarget {
  bvid: string
  page: number
  title: string
}

const catalogCache = new Map<string, Promise<VideoCatalog>>()

/** 当前图谱的影视对照表，按图谱缓存，只请求一次 */
export function useVideoCatalog(): VideoCatalog | null {
  const graph = activeGraphId() || ''
  const [catalog, setCatalog] = useState<VideoCatalog | null>(null)
  useEffect(() => {
    if (!graph) return
    let alive = true
    if (!catalogCache.has(graph)) {
      catalogCache.set(graph, getVideoCatalog().then((r) => r.data).catch(() => ({ source: null, episodes: [] })))
    }
    catalogCache.get(graph)!.then((c) => { if (alive) setCatalog(c) })
    return () => { alive = false }
  }, [graph])
  return catalog
}

/** 这些单元对应的剧集（按集号排序、去重） */
export function episodesForChapters(catalog: VideoCatalog | null, chapters: number[]): VideoEpisode[] {
  if (!catalog?.episodes.length || !chapters.length) return []
  const set = new Set(chapters)
  return catalog.episodes.filter((ep) => ep.chapters.some((c) => set.has(c)))
}

/** 剧集显示名：对照表自带的（电影、单集故事）优先，否则「第 N 集 标题」 */
export function episodeLabel(ep: Pick<VideoEpisode, 'ep' | 'title' | 'label' | 'label_en'>): string {
  const own = i18n.language?.startsWith('en') ? ep.label_en || ep.label : ep.label
  return own || i18n.t('video.episode', { ep: ep.ep, title: ep.title })
}

export function episodeTarget(catalog: VideoCatalog, ep: VideoEpisode): VideoTarget {
  return { bvid: catalog.source!.bvid, page: ep.page, title: episodeLabel(ep) }
}

export default function VideoModal({ target, sourceTitle, onClose }: {
  target: VideoTarget | null
  sourceTitle?: string
  onClose: () => void
}) {
  const mobile = useIsMobile()
  const src = target
    ? `https://player.bilibili.com/player.html?bvid=${target.bvid}&page=${target.page}&autoplay=0&high_quality=1&danmaku=0`
    : ''
  return (
    <Modal
      open={!!target}
      onCancel={onClose}
      footer={null}
      destroyOnHidden
      centered
      width={mobile ? '100%' : 880}
      rootClassName={`video-modal ${mobile ? 'is-mobile' : ''}`}
      title={target ? <span className="vm-title">{sourceTitle ? `${sourceTitle} · ` : ''}{target.title}</span> : null}
    >
      {target && (
        <>
          <div className="vm-frame">
            <iframe
              src={src}
              title={target.title}
              allow="fullscreen; encrypted-media"
              allowFullScreen
              referrerPolicy="no-referrer-when-downgrade"
              sandbox="allow-scripts allow-same-origin allow-popups allow-presentation"
            />
          </div>
          <div className="vm-foot">
            视频由 B 站外链播放，版权归原权利人
            <a href={`https://www.bilibili.com/video/${target.bvid}?p=${target.page}`} target="_blank" rel="noreferrer">{i18n.t('video.open')}</a>
          </div>
        </>
      )}
    </Modal>
  )
}
