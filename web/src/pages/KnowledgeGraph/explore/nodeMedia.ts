/**
 * 3D 图谱的多媒体节点贴图
 *
 * 三类节点要贴真图，不能只画球：
 *   - Photo 实体  → 照片缩略图（矩形贴图，像一张贴在空间里的照片）
 *   - Video 实体  → 视频封面（矩形贴图；聚焦时外层换成 HTML <video> 播放）
 *   - Person 实体 → 人员库人脸头像（圆形裁切，避免方块压住节点）
 *
 * Photo/Video 的缩略图地址能从节点自带的 attachment_id 直接拼出来（后端把它
 * 提到了节点顶层），不用等接口；Person 头像必须走 getEntityMedia 批量解析，
 * 因为图谱与人员库是靠姓名对齐的。
 *
 * 纹理一律走缓存：探索页会反复重建节点对象（聚焦、过滤、展开邻域），
 * 每次都 new Texture 会让显存和 GC 都失控。
 */
import * as THREE from 'three'

import type { EntityMedia, GraphNode } from '@/api/knowledge-graph'

/** 缩略图接口前缀，与后端 photo_routes / video_routes 的 url_prefix 一致 */
const PHOTO_API = '/api/data-governance/photos'
const VIDEO_API = '/api/data-governance/videos'

/** 纹理缓存上限：一屏几百个节点，留足余量同时挡住无限增长 */
const TEXTURE_CACHE_MAX = 240

/** 缓存条目：纹理 + 图片原始宽高比（加载完成后才有）+ 等待宽高比的回调 */
interface TextureEntry {
  texture: THREE.Texture
  aspect: number | null
  waiters: Array<(aspect: number) => void>
}

/** url -> 纹理条目。Map 保持插入顺序，命中时重新插入实现 LRU 淘汰 */
const textureCache = new Map<string, TextureEntry>()

function putTexture(url: string, entry: TextureEntry) {
  textureCache.set(url, entry)
  // 超限时淘汰最久未用的那条，并释放显存
  while (textureCache.size > TEXTURE_CACHE_MAX) {
    const oldest = textureCache.keys().next().value
    if (oldest === undefined) break
    textureCache.get(oldest)?.texture.dispose()
    textureCache.delete(oldest)
  }
}

function getCached(url: string): TextureEntry | null {
  const hit = textureCache.get(url)
  if (!hit) return null
  // 重新插入 = 标记为最近使用
  textureCache.delete(url)
  textureCache.set(url, hit)
  return hit
}

/** 图片加载完成后按真实宽高比回调；已加载过的直接同步回调 */
function onAspectReady(entry: TextureEntry, callback: (aspect: number) => void) {
  if (entry.aspect != null) callback(entry.aspect)
  else entry.waiters.push(callback)
}

/**
 * 矩形缩略图纹理（照片 / 视频封面）。
 * 缩略图接口按原图比例缩放（视频封面多为 16:9，照片有横有竖），不是正方形，
 * 所以要把真实宽高比记下来，精灵按它设尺寸，否则图会被压扁/拉长。
 */
function rectTexture(url: string): TextureEntry {
  const cached = getCached(url)
  if (cached) return cached
  const entry: TextureEntry = { texture: null as unknown as THREE.Texture, aspect: null, waiters: [] }
  entry.texture = new THREE.TextureLoader().load(url, (texture) => {
    const image = texture.image as { width?: number; height?: number } | undefined
    const aspect = image?.width && image?.height ? image.width / image.height : 1
    entry.aspect = aspect
    entry.waiters.splice(0).forEach((fn) => fn(aspect))
  })
  // 不设 sRGB 的话缩略图在深色底上会明显偏暗
  entry.texture.colorSpace = THREE.SRGBColorSpace
  putTexture(url, entry)
  return entry
}

/**
 * 圆形头像纹理：先返回一张空白 canvas 纹理，图片到达后再裁成圆形画上去。
 * 这样节点不用等网络就能先出现，头像随后无感刷进来。
 */
function circleTexture(url: string, ringColor: string): THREE.Texture {
  const cached = getCached(url)
  if (cached) return cached.texture

  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  // 圆形头像始终 1:1，宽高比直接定死
  putTexture(url, { texture, aspect: 1, waiters: [] })

  const img = new Image()
  img.onload = () => {
    ctx.clearRect(0, 0, size, size)
    ctx.save()
    ctx.beginPath()
    ctx.arc(size / 2, size / 2, size / 2 - 4, 0, Math.PI * 2)
    ctx.closePath()
    ctx.clip()
    // 短边充满圆形，长边居中裁掉，人脸不会被拉变形
    const scale = Math.max(size / img.width, size / img.height)
    const w = img.width * scale
    const h = img.height * scale
    ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h)
    ctx.restore()
    // 描边用实体类型色，头像和图谱配色对得上
    ctx.beginPath()
    ctx.arc(size / 2, size / 2, size / 2 - 3, 0, Math.PI * 2)
    ctx.lineWidth = 5
    ctx.strokeStyle = ringColor
    ctx.stroke()
    texture.needsUpdate = true
  }
  img.src = url
  return texture
}

/** 节点的缩略图地址：媒体实体自己就能拼出来，其余（Person）靠接口解析结果 */
export function nodeThumbUrl(node: GraphNode, media?: EntityMedia): string | null {
  if (node.attachment_id) {
    if (node.label === 'Photo') return `${PHOTO_API}/${node.attachment_id}/thumbnail`
    if (node.label === 'Video') return `${VIDEO_API}/${node.attachment_id}/thumbnail`
  }
  return media?.thumb_url || null
}

/** 视频原件地址：聚焦时用它做内联播放 */
export function nodeVideoUrl(node: GraphNode, media?: EntityMedia): string | null {
  if (node.label !== 'Video') return null
  if (node.attachment_id) return `${VIDEO_API}/${node.attachment_id}`
  return media?.file_url || null
}

/**
 * 矩形照片精灵：照片 / 视频封面。
 * 以 size 为外接正方形边长，按图片真实宽高比缩放（长边 = size），不拉伸变形。
 * 图片到达前先按正方形占位；尺寸确定后通过 onSized 通知调用方（标签要挂在图上方）。
 */
export function makeThumbSprite(
  url: string,
  size: number,
  onSized?: (width: number, height: number) => void,
): THREE.Sprite {
  const entry = rectTexture(url)
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: entry.texture,
    transparent: true,
  }))
  sprite.scale.set(size, size, 1)
  onAspectReady(entry, (aspect) => {
    const width = aspect >= 1 ? size : size * aspect
    const height = aspect >= 1 ? size / aspect : size
    sprite.scale.set(width, height, 1)
    onSized?.(width, height)
  })
  return sprite
}

/** 圆形头像精灵：人物节点 */
export function makeAvatarSprite(url: string, size: number, ringColor: string): THREE.Sprite {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: circleTexture(url, ringColor),
    transparent: true,
  }))
  sprite.scale.set(size, size, 1)
  return sprite
}

/**
 * 内联视频元素。这里刻意不设 src：视频要等节点被聚焦才加载，
 * 否则一屏视频会同时开始下载。真实地址先存在 dataset 上，由调用方按需搬到 src。
 *
 * 注意不能用 src='' 占位——浏览器会把空字符串解析成当前页面地址并发起请求，
 * 之后 video.src 读出来还是非空的，"有没有加载过"的判断就失效了。
 *
 * muted 是自动播放的前置条件，浏览器不允许带声音的自动播放。
 */
export function makeVideoElement(url: string): HTMLVideoElement {
  const video = document.createElement('video')
  video.dataset.src = url
  video.className = 'g3d-video'
  video.muted = true
  video.loop = true
  video.playsInline = true
  return video
}

/** 首次播放时才真正加载视频源 */
export function playVideo(video: HTMLVideoElement) {
  if (!video.dataset.loaded && video.dataset.src) {
    video.src = video.dataset.src
    video.dataset.loaded = '1'
  }
  void video.play().catch(() => { /* 自动播放被浏览器拦下时保持封面即可 */ })
}
