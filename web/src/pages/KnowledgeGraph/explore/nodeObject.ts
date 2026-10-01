/**
 * 节点的三维对象工厂（nodeThreeObject 的实现）
 *
 * 一个节点最多由三层组成：
 *   1. 贴图 —— Photo/Video 的矩形封面、Person 的圆形头像（没有缩略图就不加，
 *              图库会保留默认球体，见 nodeThreeObjectExtend）
 *   2. 标签 —— SpriteText，只有重要节点默认可见
 *   3. 视频 —— 只有 Video 节点有；默认隐藏，聚焦时才加载并播放
 *
 * 标签为什么不用 CSS2DObject（第一版踩过的坑，别改回去）：
 *   - CSS2DObject 的 DOM 元素只在它自己被移除时才清理。嵌在 Group 里时，
 *     图库回收节点移除的是 Group，孙节点收不到 removed 事件，元素就永远留在
 *     页面上，冻结在最后的屏幕位置——看上去就是一堆既不跟随视角也不缩放的字。
 *   - CSS2DRenderer 每帧自己覆写 element.style.display，外部改 style 控制
 *     显隐会被抹掉（视频节点的显隐因此只能改 CSS2DObject.visible）。
 *   - CSS2D 是屏幕空间尺寸，缩小视角时文字不会跟着变小，挤成一团。
 * SpriteText 是普通 Three 对象：随 Group 一起回收、跟着视角缩放、被几何体遮挡。
 *
 * 视频仍然只能用 CSS2DObject（要真的 <video> 元素），所以给 Group 挂了一个
 * removed 监听手工清理后代元素，补上上面说的那个缺口。
 */
import * as THREE from 'three'
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js'
import SpriteText from 'three-spritetext'

import type { EntityMedia } from '@/api/knowledge-graph'
import { nodeColor } from '@/utils/graphStyle'
import { palette } from '@/theme/palette'
import { NODE_REL_SIZE, shortLabel, type SimNode } from './graph3dConfig'
import {
  makeAvatarSprite,
  makeThumbSprite,
  makeVideoElement,
  nodeThumbUrl,
  nodeVideoUrl,
} from './nodeMedia'

/** 画布持有的登记表，键是实体 id。标签与视频都存三维对象，靠 visible 切显隐。
 *  视频存的是 CSS2DObject（element 即 <video>）：CSS2DRenderer 每帧会按
 *  object.visible 覆写 element.style.display，所以显隐只能改对象的 visible，
 *  直接改元素 style 下一帧就被抹掉——黑块满屏的 bug 就是这么来的。 */
export interface NodeObjectRegistry {
  labels: Map<string, THREE.Object3D>
  videos: Map<string, CSS2DObject>
}

/** 标签在世界坐标里的字高。只在建对象时用一次——之后画布每帧按相机距离
 *  把它反缩放到 LABEL_SCREEN_PX，屏幕上字号恒定，不再随镜头放大糊满画布。 */
export const LABEL_TEXT_HEIGHT = 10

/** 标签 sprite：额外记住建好时的原始缩放。
 *  画布按相机距离反缩放时要在原始缩放上乘一个系数，直接 setScalar 会把
 *  文字的长宽比压掉。 */
export interface LabelSprite extends THREE.Sprite {
  __baseScale?: THREE.Vector3
}

/** 标签贴图的画布分辨率（不影响显示大小，只影响放大后清不清晰） */
const LABEL_FONT_SIZE = 96

/** 光点相对节点半径的倍数：中间实心部分差不多就是节点半径 */
const GLOW_SCALE = 2.6
/** 光点贴图分辨率 */
const GLOW_RESOLUTION = 128

function toRgba(color: string, alpha: number): string {
  const hex = color.trim().replace('#', '')
  const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex
  const value = Number.parseInt(full, 16)
  if (Number.isNaN(value)) return `rgba(148,163,184,${alpha})`
  return `rgba(${(value >> 16) & 255},${(value >> 8) & 255},${value & 255},${alpha})`
}

/**
 * 柔和光点：径向渐变（中心实、外圈淡淡化开）。
 *
 * 之前节点是 MeshLambert 球体，浅色底上一颗颗生硬的色块；换成贴片光点后
 * 节点像发光的小灯，密集处自然叠出层次，也不再有明显的球面高光。
 */
export function makeGlowSprite(color: string, size: number): THREE.Sprite {
  const canvas = document.createElement('canvas')
  canvas.width = GLOW_RESOLUTION
  canvas.height = GLOW_RESOLUTION
  const ctx = canvas.getContext('2d')
  if (ctx) {
    const half = GLOW_RESOLUTION / 2
    const gradient = ctx.createRadialGradient(half, half, 0, half, half, half)
    gradient.addColorStop(0, toRgba(color, 0.95))
    gradient.addColorStop(0.32, toRgba(color, 0.62))
    gradient.addColorStop(0.62, toRgba(color, 0.2))
    gradient.addColorStop(1, toRgba(color, 0))
    ctx.fillStyle = gradient
    ctx.beginPath()
    ctx.arc(half, half, half, 0, Math.PI * 2)
    ctx.fill()
  }
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(canvas),
    transparent: true,
    depthWrite: false,
  }))
  sprite.scale.set(size, size, 1)
  return sprite
}

export function buildNodeObject(
  node: SimNode,
  media: EntityMedia | undefined,
  registry: NodeObjectRegistry,
  labelVisible: boolean,
  colorOverride?: string,
): THREE.Object3D {
  const group = new THREE.Group()
  const color = colorOverride || nodeColor(node.label).main
  // 与图库 nodeRelSize 一致的球体半径（半径 = 体积值的立方根 × nodeRelSize）
  const radius = Math.cbrt(node.__val || 6) * NODE_REL_SIZE
  // 标签要挂在实际画出来的东西上方：贴图节点比球体大得多
  let labelOffset = radius + LABEL_TEXT_HEIGHT * 0.7
  // 标签先建出来（样式在下面统一设），封面尺寸异步到位后要回来调它的位置
  const label = new SpriteText(shortLabel(node.name))

  const thumbUrl = nodeThumbUrl(node, media)
  if (thumbUrl) {
    // 人物贴圆形头像，照片/视频贴矩形封面（像一张贴在空间里的照片）
    const size = node.label === 'Person' ? radius * 3.4 : radius * 4
    group.add(node.label === 'Person'
      ? makeAvatarSprite(thumbUrl, size, color)
      // 封面按真实宽高比定尺寸（等图片到达），标签随实际高度贴到图的上沿：
      // 横图会比占位正方形矮不少，不调的话标签悬在半空
      : makeThumbSprite(thumbUrl, size, (_width, height) => {
        label.position.y = height / 2 + LABEL_TEXT_HEIGHT * 0.7
      }))
    labelOffset = size / 2 + LABEL_TEXT_HEIGHT * 0.7
  } else {
    // 没有贴图的实体：画成柔和光点（替代图库默认的实心球）
    group.add(makeGlowSprite(color, radius * GLOW_SCALE))
  }

  const videoUrl = nodeVideoUrl(node, media)
  if (videoUrl) {
    const video = makeVideoElement(videoUrl)
    video.style.width = `${Math.round(radius * 14)}px`
    // 默认隐藏：改 CSS2DObject.visible 而不是 element.style.display（见上）
    const holder = new CSS2DObject(video)
    holder.visible = false
    registry.videos.set(node.id, holder)
    group.add(holder)
    // Group 被回收时手工摘掉后代的 CSS2D 元素，否则会残留在页面上
    group.addEventListener('removed', () => {
      group.traverse((child) => {
        const element = (child as CSS2DObject).element
        if (element?.parentNode) element.remove()
      })
    })
  }

  label.textHeight = LABEL_TEXT_HEIGHT
  label.fontSize = LABEL_FONT_SIZE
  const ink = palette()
  label.color = ink.ink
  // 中文要显式给字体，否则 canvas 在部分环境下会回退成方框
  label.fontFace = '"Microsoft YaHei", "PingFang SC", sans-serif'
  label.fontWeight = '600'
  // 白底小药丸 + 同色描边：标签压在连线或其他节点上也读得清，
  // 边框颜色带出实体类型，比整段彩色文字更好读。
  // padding / borderWidth / borderRadius 的单位都是「字高的倍数」，所以取小数。
  label.backgroundColor = ink.halo
  label.borderColor = color
  label.borderWidth = 0.06
  label.padding = [0.26, 0.14]
  label.borderRadius = 0.3
  label.position.y = labelOffset
  label.visible = labelVisible
  ;(label as LabelSprite).__baseScale = label.scale.clone()
  registry.labels.set(node.id, label)
  group.add(label)

  return group
}
