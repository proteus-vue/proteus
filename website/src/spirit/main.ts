// website/src/spirit/main.ts —— ★#389i Three.js 3D 海神精灵（iframe 专用页——three 隔离在 spirit chunk，主应用零增量）
// /* d2-exempt-file: 独立多入口原生 iframe 视觉资产入口（spirit.html 直挂）——canvas/WebGL/postMessage 原生实现，不走框架 p-* 页面语义 */
// ★#389j 参考形象重制：果冻水滴形（球体几何重排）+ 大眼白蓝虹膜双高光 + 粉腮红 + 顶部白浪花卷 + 底部白浪环
// 果冻质感：MeshPhysicalMaterial clearcoat + RoomEnvironment PMREM 环境反射 + 每帧顶点谐波位移 + 紫/青双点光
// 交互：点击 iframe = 变身下一形态（颜色插值 + squash 弹跳 + 涟漪环 + O 嘴惊喜）
//       + 躯干/眼球朝向跟随鼠标（G-24 指针语义）
// 向父页 postMessage: { type: 'proteus-spirit-morph', name, theme }——父页弹形态主题气泡
// 降级：WebGL 缺失 → 2D SVG 回退（内嵌）；reduced-motion → 静态姿态单帧渲染；document.hidden → 暂停
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'

interface SpiritForm {
  name: string
  color: string
  theme: string
}

const FORMS: SpiritForm[] = [
  { name: 'Proteus · 本体', color: '#7c5cff', theme: '一种语义，万种形态——变形是我的天性' },
  { name: 'Web · VueDom', color: '#42b883', theme: '语义直出 DOM——标准 Vue 零转换跑进浏览器' },
  { name: 'iOS · UIKit', color: '#0a84ff', theme: 'UILabel / UIStackView——原生控件原生体验' },
  { name: 'Android · Jetpack', color: '#3ddc84', theme: 'Jetpack 视图树——Material 质感由我渲染' },
  { name: '鸿蒙 · ArkUI', color: '#ff8a5c', theme: 'ArkUI 声明式——一次开发多端部署' },
  { name: 'Flutter · Widget', color: '#54c5f8', theme: '一棵 Widget 树在 Skia 画布上生长' },
  { name: '小程序 · Skyline', color: '#00e0c6', theme: 'Skyline 语法直出——wx:if 就是这么来的' },
  { name: '任意端 · Universal', color: '#ffd54f', theme: 'Tier 1-4 任意端——车机 / TV / 手表都是目标' },
]

/** ★#488 英文形态目录（index 与 FORMS 对齐——name/theme 供 EN 态气泡与标签） */
const FORMS_EN: SpiritForm[] = [
  { name: 'Proteus · Core', color: '#7c5cff', theme: 'One semantic set, endless forms — morphing is my nature' },
  { name: 'Web · VueDom', color: '#42b883', theme: 'Semantics straight to the DOM — standard Vue runs as-is in the browser' },
  { name: 'iOS · UIKit', color: '#0a84ff', theme: 'UILabel / UIStackView — native controls, native feel' },
  { name: 'Android · Jetpack', color: '#3ddc84', theme: 'Jetpack view tree — Material polish rendered by me' },
  { name: 'HarmonyOS · ArkUI', color: '#ff8a5c', theme: 'ArkUI declarative — one codebase, many devices' },
  { name: 'Flutter · Widget', color: '#54c5f8', theme: 'A Widget tree growing on a Skia canvas' },
  { name: 'Mini Program · Skyline', color: '#00e0c6', theme: 'Skyline syntax straight out — that is where wx:if comes from' },
  { name: 'Universal', color: '#ffd54f', theme: 'Tier 1-4 targets — in-car / TV / watch are all in scope' },
]

// ★#488 语言态（父页 proteus-spirit-lang 消息驱动；缺省 zh）
let lang: 'zh' | 'en' = 'zh'
function formAt(idx: number): SpiritForm {
  return lang === 'en' ? FORMS_EN[idx] ?? FORMS_EN[0]! : FORMS[idx] ?? FORMS[0]!
}
function morphHint(): string {
  return lang === 'en' ? 'click me to morph' : '点我变身'
}
function paintLabel(idx = formIdx): void {
  if (labelEl) labelEl.textContent = `${formAt(idx).name} · ${morphHint()}`
}

const labelEl = document.getElementById('spirit-label') as HTMLElement
const canvas = document.getElementById('spirit-canvas') as HTMLCanvasElement

// —— 状态 ——
let formIdx = 0
const targetColor = new THREE.Color(FORMS[0]!.color)
// 内芯色（果冻进深感——形体色的加深版）
const innerTarget = new THREE.Color(FORMS[0]!.color).multiplyScalar(0.7)
const pointer = { x: 0, y: 0 }
let wave = 0.5
let popT = 1
let rippleT = 1
let blinkTimer = 2600 + Math.random() * 3000
let surprised = false
let mouthTimer: ReturnType<typeof setTimeout> | undefined
let raf = 0
let running = false
// ★动效守卫（reduced-motion → 单帧静态渲染——JS matchMedia + 分支，零 @media）
const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

// —— 交互 ——
function onMove(e: PointerEvent): void {
  pointer.x = e.clientX / window.innerWidth - 0.5
  pointer.y = e.clientY / window.innerHeight - 0.5
}
window.addEventListener('pointermove', onMove, { passive: true })
canvas.addEventListener('click', onMorph)

// —— 场景对象（模块级；装配在 makeRenderer 内判定 WebGL 后执行） ——
const renderer = makeRenderer()
const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 30)
camera.position.set(0, 0.15, 4.75)
camera.lookAt(0, 0.02, 0)

// 灯光（环境反射为主 + 白主光 + 紫/青双边缘光 = 果冻透亮质感）
scene.add(new THREE.AmbientLight(0xffffff, 0.32))
const keyLight = new THREE.DirectionalLight(0xffffff, 1.15)
keyLight.position.set(2.5, 3.5, 4)
scene.add(keyLight)
const rimPurple = new THREE.PointLight(0x7c5cff, 16)
rimPurple.position.set(-3, 1.5, 2.5)
scene.add(rimPurple)
const rimCyan = new THREE.PointLight(0x00e0c6, 12)
rimCyan.position.set(3, -1, 2.5)
scene.add(rimCyan)
// RoomEnvironment PMREM 环境反射（clearcoat 高光的关键——没有它 Physical 材质是哑光的）
if (renderer) {
  const pmrem = new THREE.PMREMGenerator(renderer)
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
  pmrem.dispose()
}

// —— 躯体组（★参考形象：果冻水滴形 + 顶部浪花卷 + 底部白浪环） ——
const spiritGroup = new THREE.Group()
scene.add(spiritGroup)
const bodyGeo = new THREE.SphereGeometry(1.05, 56, 56)
{
  // 球 → 近正圆胖球（参考图身体就是个大圆球，只轻微收窄；顶部由浪花冠覆盖）
  const p = bodyGeo.attributes.position.array as Float32Array
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i], y = p[i + 1], z = p[i + 2]
    const taper = y > 0 ? 1 - 0.12 * Math.pow(y, 1.5) : 1 + 0.09 * y * y
    p[i] = x * taper
    p[i + 1] = y
    p[i + 2] = z * taper
  }
}
bodyGeo.computeVertexNormals()
const bodyBase = (bodyGeo.attributes.position.array as Float32Array).slice()
const bodyMat = new THREE.MeshPhysicalMaterial({
  color: new THREE.Color(FORMS[0]!.color),
  roughness: 0.14,
  metalness: 0,
  clearcoat: 1,
  clearcoatRoughness: 0.16,
  transparent: true,
  opacity: 0.95,
  envMapIntensity: 1.3,
  // ★自发光同体色——暗背景上保持果冻透亮感（参考图发亮的关键）
  emissive: new THREE.Color(FORMS[0]!.color),
  emissiveIntensity: 0.18,
})
const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat)
spiritGroup.add(bodyMesh)
// 内芯（形体色加深——果冻通透的进深层）
const coreMat = new THREE.MeshBasicMaterial({ color: innerTarget.clone(), transparent: true, opacity: 0.35 })
const coreMesh = new THREE.Mesh(bodyGeo, coreMat)
coreMesh.scale.setScalar(0.82)
spiritGroup.add(coreMesh)

// —— 眼睛（★参考形象：大眼白 + 蓝虹膜 + 深瞳 + 双高光；虹膜组跟随指针，眨眼压眼组） ——
const faceGroup = new THREE.Group()
spiritGroup.add(faceGroup)
const eyeWhiteMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.12, clearcoat: 1, envMapIntensity: 1.0 })
const irisMat = new THREE.MeshPhongMaterial({ color: 0x155fd6, shininess: 130, specular: 0xaad4ff })
const pupilMat = new THREE.MeshBasicMaterial({ color: 0x081030 })
const specMat = new THREE.MeshBasicMaterial({ color: 0xffffff })
const eyes: THREE.Group[] = []
const pupils: THREE.Group[] = []
for (const sx of [-1, 1]) {
  const eye = new THREE.Group()
  eye.position.set(0.42 * sx, 0.18, 0.8)
  const white = new THREE.Mesh(new THREE.SphereGeometry(0.28, 24, 24), eyeWhiteMat)
  white.scale.z = 0.7
  const irisGroup = new THREE.Group()
  irisGroup.position.z = 0.14
  const iris = new THREE.Mesh(new THREE.SphereGeometry(0.19, 20, 20), irisMat)
  iris.scale.z = 0.5
  const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.115, 16, 16), pupilMat)
  pupil.position.z = 0.06
  const specBig = new THREE.Mesh(new THREE.SphereGeometry(0.065, 12, 12), specMat)
  specBig.position.set(-0.065, 0.075, 0.11)
  const specSmall = new THREE.Mesh(new THREE.SphereGeometry(0.032, 10, 10), specMat)
  specSmall.position.set(0.06, -0.06, 0.11)
  irisGroup.add(iris, pupil, specBig, specSmall)
  eye.add(white, irisGroup)
  faceGroup.add(eye)
  eyes.push(eye)
  pupils.push(irisGroup)
}

// 嘴（微笑弧；变身瞬间 O 型）
const mouthSmile = new THREE.Mesh(
  new THREE.TorusGeometry(0.11, 0.03, 10, 24, Math.PI),
  new THREE.MeshBasicMaterial({ color: 0x1a1a20 }),
)
mouthSmile.position.set(0, -0.24, 1.01)
mouthSmile.rotation.z = Math.PI
spiritGroup.add(mouthSmile)
const mouthO = new THREE.Mesh(
  new THREE.SphereGeometry(0.09, 16, 16),
  new THREE.MeshBasicMaterial({ color: 0x1a1a20 }),
)
mouthO.position.set(0, -0.25, 1.0)
mouthO.visible = false
spiritGroup.add(mouthO)

// 腮红（★参考形象：眼睛正下方脸颊前侧——粉嫩立体腮红果，几乎正对观众）
const blushMat = new THREE.MeshPhongMaterial({ color: 0xffa4b4, shininess: 90, specular: 0xffe3e8 })
for (const sx of [-1, 1]) {
  const blush = new THREE.Mesh(new THREE.SphereGeometry(0.17, 18, 18), blushMat)
  blush.position.set(0.6 * sx, -0.34, 0.8)
  blush.scale.set(1, 0.78, 0.42)
  blush.rotation.y = 0.35 * sx
  spiritGroup.add(blush)
}

// ★顶部大浪花卷（参考形象：像头发坐在头顶前上方——根部从头顶内部涌出，卷体前移与头顶轮廓重叠，卷梢垂到额前）
const foamMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.18, clearcoat: 1, envMapIntensity: 1.2 })
const hairGroup = new THREE.Group()
spiritGroup.add(hairGroup)
for (const sx of [-1, 1]) {
  // ★大浪头：肥螺旋骑在球顶两肩上——起点 270° 深埋球内（横向 0.457 < 球宽 0.476），缺口扇区对着中央露蓝，卷梢 160° 向内下潜
  const pts: THREE.Vector3[] = []
  for (let i = 0; i <= 48; i++) {
    const u = i / 48
    const ang = ((270 + u * 250) * Math.PI) / 180
    const r = 0.13 + u * 0.08
    pts.push(new THREE.Vector3(
      sx * (0.42 + Math.cos(ang) * r),
      1.02 + Math.sin(ang) * r,
      0.18 + Math.sin(u * Math.PI) * 0.02,
    ))
  }
  hairGroup.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 80, 0.135, 14), foamMat))
}

// ★底部浪花腰带（参考形象：厚蓬白浪环抱球底——前中下沉、两侧上扬，两端向上卷断成小浪卷；下方露出果冻色球底）
const basePts: THREE.Vector3[] = []
for (let i = 0; i <= 96; i++) {
  const a = (i / 96) * Math.PI * 2
  const dip = Math.pow(Math.max(0, Math.sin(a)), 1.5)
  const rr = 1.0 - 0.15 * dip
  basePts.push(new THREE.Vector3(
    Math.cos(a) * rr,
    -0.48 + 0.07 * Math.sin(a * 2 + 0.4) - 0.2 * dip,
    Math.sin(a) * rr,
  ))
}
const baseGroup = new THREE.Group()
baseGroup.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(basePts, true), 140, 0.17, 14, true), foamMat))
// ★两端浪花卷（在球体两肩外侧向上卷断，内梢轻触球面）
for (const sx of [-1, 1]) {
  const cPts: THREE.Vector3[] = [
    new THREE.Vector3(1.0 * sx, -0.45, 0.0),
    new THREE.Vector3(1.07 * sx, -0.35, 0.02),
  ]
  for (let i = 0; i <= 30; i++) {
    const u = i / 30
    const ang = ((250 + u * 300) * Math.PI) / 180
    const r = 0.07 + u * 0.05
    cPts.push(new THREE.Vector3(
      sx * (1.12 + Math.cos(ang) * r),
      -0.24 + Math.sin(ang) * r,
      0.03,
    ))
  }
  baseGroup.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(cPts), 48, 0.085, 12), foamMat))
}
spiritGroup.add(baseGroup)

// 涟漪环（点击扩散）
const rippleMat = new THREE.MeshBasicMaterial({
  color: 0x00e0c6,
  transparent: true,
  opacity: 0,
  side: THREE.DoubleSide,
})
const ripple = new THREE.Mesh(new THREE.RingGeometry(0.82, 0.95, 48), rippleMat)
ripple.position.set(0, 0.05, 0.3)
scene.add(ripple)

// 上浮气泡 ×2
const bubbleMat = new THREE.MeshBasicMaterial({ color: 0x67e8f9, transparent: true, opacity: 0.4 })
const bubbles: THREE.Mesh[] = []
for (let i = 0; i < 2; i++) {
  const b = new THREE.Mesh(new THREE.SphereGeometry(0.06 + i * 0.02, 14, 14), bubbleMat)
  b.position.z = 1.25
  scene.add(b)
  bubbles.push(b)
}

// —— 交互 ——
function onMorph(): void {
  formIdx = (formIdx + 1) % FORMS.length
  const f = formAt(formIdx)
  targetColor.set(f.color)
  innerTarget.copy(targetColor).multiplyScalar(0.7)
  popT = 0
  rippleT = 0
  surprised = true
  paintLabel(formIdx)
  window.parent.postMessage({ type: 'proteus-spirit-morph', name: f.name, theme: f.theme }, '*')
  clearTimeout(mouthTimer)
  mouthTimer = setTimeout(() => (surprised = false), 750)
  // ★reduced-motion：无 rAF 链——立即以目标色单帧重绘
  if (reduced && renderer) {
    bodyMat.color.copy(targetColor)
    bodyMat.emissive.copy(targetColor)
    coreMat.color.copy(innerTarget)
    drawFrame(performance.now())
  }
}

// —— 主循环（tick 只管 rAF 调度；绘制主体在 drawFrame——reduced-motion 单帧复用） ——
let last = 0
function tick(now: number): void {
  raf = requestAnimationFrame(tick)
  if (document.hidden || !renderer) return
  drawFrame(now)
}

// —— 帧绘制（颜色插值/果冻谐波/squash/视差/眼球·眨眼·嘴/涟漪/气泡） ——
function drawFrame(now: number): void {
  if (!renderer) return
  const dt = Math.min(0.05, (now - last) * 0.001 || 0.016)
  last = now
  const t = now * 0.001

  // 颜色插值（变身过渡——体色 + 自发光 + 内芯色）
  bodyMat.color.lerp(targetColor, 0.12)
  bodyMat.emissive.lerp(targetColor, 0.12)
  coreMat.color.lerp(innerTarget, 0.12)

  // ★果冻顶点谐波（CPU ~2.4k 顶点位移——表面持续液态起伏）
  const pos = bodyGeo.attributes.position.array as Float32Array
  for (let i = 0; i < pos.length; i += 3) {
    const x = bodyBase[i]
    const y = bodyBase[i + 1]
    const z = bodyBase[i + 2]
    const w1 = Math.sin(y * 3.1 + t * 2.2) * 0.045
    const w2 = Math.sin(x * 3.6 + t * 1.6) * 0.035
    const w3 = Math.sin(z * 3.2 + t * 1.2) * 0.03
    const s = 1 + (w1 + w2 + w3) * wave
    pos[i] = x * s
    pos[i + 1] = y * s
    pos[i + 2] = z * s
  }
  bodyGeo.attributes.position.needsUpdate = true
  bodyGeo.computeVertexNormals()

  // squash & stretch（呼吸 + 变身弹跳）
  popT = Math.min(1, popT + dt * 2.4)
  const popE = 1 + Math.sin(popT * Math.PI) * 0.2 * (1 - popT)
  const breath = Math.sin(t * 1.9) * 0.035
  spiritGroup.scale.set(
    1 + breath * 0.6 - (popE - 1) * 0.5,
    1 + breath + (popE - 1),
    1 + breath * 0.6 - (popE - 1) * 0.5,
  )

  // 漂浮 + 指针视差（转向鼠标）
  spiritGroup.position.y = Math.sin(t * 1.4) * 0.09
  spiritGroup.rotation.y += ((pointer.x * 0.55) - spiritGroup.rotation.y) * 0.06
  spiritGroup.rotation.x += ((pointer.y * 0.3) - spiritGroup.rotation.x) * 0.06

  // 虹膜组跟随指针（G-24——眼白不动，虹膜+瞳孔+高光整体偏移）
  pupils.forEach((p) => {
    p.position.x = pointer.x * 0.075
    p.position.y = -pointer.y * 0.06
  })

  // 偶发眨眼（眼睛纵向压扁 160ms 一闭一开）
  blinkTimer -= dt * 1000
  let blinkScale = 1
  if (blinkTimer < 160) {
    if (blinkTimer <= 0) blinkTimer = 2400 + Math.random() * 3200
    else blinkScale = 0.12 + 0.88 * Math.abs((blinkTimer / 160) - 0.5) * 2
  }
  eyes.forEach((e) => (e.scale.y = blinkScale))

  // 嘴（变身 750ms 惊喜 O 型）
  mouthO.visible = surprised
  mouthSmile.visible = !surprised

  // 浪花卷微摆（幅度收敛——双卷梢不越过中央线，避免互相穿插）
  hairGroup.rotation.z = Math.sin(t * 1.3) * 0.03
  hairGroup.rotation.x = Math.sin(t * 0.9) * 0.015
  baseGroup.rotation.y = Math.sin(t * 0.6) * 0.25

  // 涟漪扩散
  if (rippleT < 1) {
    rippleT = Math.min(1, rippleT + dt * 1.6)
    const s = 0.7 + rippleT * 1.7
    ripple.scale.set(s, s, s)
    rippleMat.opacity = (1 - rippleT) * 0.55
  }

  // 气泡上浮
  for (let i = 0; i < bubbles.length; i++) {
    const b = bubbles[i]!
    b.position.y = ((b.position.y + dt * (0.3 + i * 0.1) + 1.8) % 3.6) - 1.8
    b.position.x = (i === 0 ? -0.75 : 0.78) + Math.sin(t * (1.1 + i)) * 0.08
  }

  renderer.render(scene, camera)
}

// —— renderer 工厂（WebGL 探测失败/创建异常 → null → 2D SVG 回退） ——
function makeRenderer(): THREE.WebGLRenderer | null {
  try {
    const probe = document.createElement('canvas')
    if (!probe.getContext('webgl2') && !probe.getContext('webgl')) return null
    const r = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true })
    r.setClearColor(0x000000, 0)
    r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
    return r
  } catch {
    return null
  }
}

// —— 尺寸（以 iframe 视口为准；setSize 同步 canvas 样式） ——
function resize(): void {
  if (!renderer) return
  const w = window.innerWidth
  const h = window.innerHeight
  renderer.setSize(w, h)
  camera.aspect = w / h
  camera.updateProjectionMatrix()
}
window.addEventListener('resize', resize)

// —— 循环保活（hidden → visible 回来补启 rAF 链） ——
function ensure(): void {
  if (!running && renderer) {
    running = true
    last = performance.now()
    raf = requestAnimationFrame(tick)
  }
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) ensure()
})

// ★#488 语言握手：父页切换语言 → 刷新标签/标题/后续形态消息
window.addEventListener('message', (e: MessageEvent) => {
  const d = e.data as { type?: string; lang?: 'zh' | 'en' } | null
  if (d?.type !== 'proteus-spirit-lang') return
  if (d.lang === 'en' || d.lang === 'zh') {
    lang = d.lang
    document.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN'
    document.title = lang === 'en' ? 'Proteus spirit pet' : 'Proteus 海神精灵'
    paintLabel()
  }
})

// —— 2D SVG 回退：点击仍可循环形态（label + postMessage + 身体色同步） ——
function fallback(): void {
  canvas.style.display = 'none'
  const fb = document.getElementById('spirit-fallback')
  if (!fb) return
  fb.classList.add('on')
  const tint = (): void => {
    const path = fb.querySelector('path')
    if (path) path.setAttribute('fill', formAt(formIdx).color)
  }
  tint()
  fb.addEventListener('click', () => {
    onMorph()
    tint()
  })
}

// —— 启动 / 降级 ——
paintLabel(0)
if (renderer) {
  resize()
  if (reduced) {
    drawFrame(performance.now())
  } else {
    ensure()
  }
} else {
  fallback()
}
