/**
 * 节点卡图集：主图 + 缩略条，点主图进大图预览（可左右翻）。
 * 每张图下注明作者、许可与出处（维基共享资源的公有领域古画 / 百度百科配图）。
 */
import { useEffect, useState } from 'react'
import { Image } from 'antd'
import type { EntityMedia, MediaImage } from '@/api/knowledge-graph'
import i18n from '@/i18n'

function sourceName(source?: string): string {
  if (source === 'commons') return i18n.t('explore.sourceCommons')
  if (source === 'baike') return i18n.t('explore.sourceBaike')
  if (source === 'gutenberg') return i18n.t('explore.sourceGutenberg')
  return ''
}

function caption(img: MediaImage): string {
  const parts = [img.credit, img.license, sourceName(img.source)].filter(Boolean)
  return parts.join(' · ')
}

export default function NodeGallery({ name, media }: { name: string; media: EntityMedia }) {
  const gallery: MediaImage[] = media.gallery?.length ? media.gallery : [{ src: media.thumb_url || '' }]
  const [idx, setIdx] = useState(0)
  useEffect(() => setIdx(0), [name])
  const current = gallery[Math.min(idx, gallery.length - 1)]

  return (
    <div className="inf-nc-gallery">
      <div className="inf-nc-media">
        <Image.PreviewGroup items={gallery.map((g) => ({ src: g.src, alt: g.title || name }))}>
          <Image src={current.src} alt={current.title || name} />
        </Image.PreviewGroup>
      </div>
      {gallery.length > 1 && (
        <div className="inf-nc-thumbs">
          {gallery.slice(0, 8).map((g, i) => (
            <button
              type="button"
              key={g.src}
              className={i === idx ? 'on' : ''}
              onClick={() => setIdx(i)}
              title={g.title}
            >
              <img src={g.src} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      )}
      {(current.title || caption(current)) && (
        <div className="inf-nc-caption">
          {current.page_url
            ? <a href={current.page_url} target="_blank" rel="noreferrer">{current.title || i18n.t('explore.creditLink')}</a>
            : <span>{current.title}</span>}
          {caption(current) && <em>{caption(current)}</em>}
        </div>
      )}
    </div>
  )
}
