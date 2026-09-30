# @proteus-vue/animation

Proteus **Morpheus 动画引擎的声明式表面**（MA1）——预设驱动的转场/布局动画声明、编译期校验、编译到内核指令。**零运行时依赖**：本包不引入任何曲线数学，宿主侧同样零曲线数学（曲线求值与物理积分在 Rust 内核 `layout-core-rust/src/anim.rs`，唯一实现）。

## 三层分工

```
本包（声明 + 校验 + 编译）          ← 一句话写动画 / 编译期拦住"会不会掉帧"
     ↓ 引擎指令（跨语言契约：AnimKind/Curve 编号、spring 预设同值）
Rust 内核（曲线求值 + 物理 + FLIP） ← 唯一实现，每帧零 JS 求值
     ↓ 每帧二进制通道 / 平台提交规格
宿主（翻译成平台 API）              ← iOS CAKeyframeAnimation→render server / Android RenderNodeAnimator→RenderThread
```

## 导出

| API | 说明 |
|-----|------|
| `AnimKind` / `ANIM_KIND_ID` | 动画属性封闭集（`translateX/translateY/scale/rotate/opacity`）与内核编号契约 |
| `Curve` / `CURVE_ID` | 曲线封闭集（`easeOut/snappy/easeInOut/linear/customBezier`）与内核编号契约 |
| `validateAnimations(decls)` / `formatIssues(issues)` | 编译期校验：非法参数 / **非合成属性** / **同属性重复** / 目标缺失等 7 类 |
| `compileAnimations(decls, targets)` | 校验（失败即 throw）→ 归一化（补默认时长/曲线）→ 绑目标 → `CompiledBatch` |
| `compileRoute(spec, { enter, exit })` | 转场预设 → 整批指令（进场页 + 出场页分别绑节点） |
| `toWireBatch(batch)` / `isPlatformEligible(batch)` | 输出内核 `animStart` 的线上格式 / 判定整批是否可走平台零参与路径 |
| `presets` / `route` / `list` / `element` / `easing` / `scroll` | 预设库（见下） |

## 预设库（"开箱即用" = 预设，不是参数）

| 预设 | 说明 |
|------|------|
| `route.bottomSheet()` | 半屏弹窗从底部滑入，**只动进场页**（对齐 `wx://bottom-sheet`） |
| `route.slideUp()` | 全屏向上推入，旧页视差让位 + 淡出（对齐 `wx://upwards`） |
| `route.zoom()` | 新页缩放进入 + 旧页下沉（对齐 `wx://zoom`） |
| `route.cupertinoModal()` | iOS 风格全屏模态（弹簧）（对齐 `wx://cupertino-modal`） |
| `list.shift()` | **列表项增删让位**（映射内核 FLIP：几何在内核，零跨边界；是 §5 招牌能力） |
| `element.fadeIn()` / `pressRelease()` / `press()` / `shake()` / `sharedElementFlyIn()` | 元素入场 / 按压弹回（单段）/ **按压序列**（下压+回弹两段）/ **抖动** / 共享元素飞入（落点简化形态） |
| `element.sharedElement()` | ★**真·共享元素**（从源飞到目标再归位）：`fromNodeId`（同树节点）或 `fromRect`（系统坐标） |
| `scroll.sticky()` / `parallax()` / `fadeIn()` | **滚动联动**（吸顶 / 视差 / 渐显——滚动位置驱动，换算在内核；见下） |
| `easing.snappy` / `easing.smooth` | 手感弹簧预设（**与内核 `SpringParams::snappy/smooth` 同值**，两侧各有测试钉住） |

每个转场预设带 `wxRouteType` 字段与微信 routeType **语义对齐**——同一份源码在 MP 走 Skyline routeType、在 App 走 Morpheus 预设，降低双端认知差。

## 使用

```ts
import { presets, compileRoute, compileAnimations, easing } from '@proteus-vue/animation'

// ① 转场（预设 → 指令；enter/exit 是"谁进场/谁出场"的节点 id）
const spec = presets.route.bottomSheet()
const batch = compileRoute(spec, { enter: 101, exit: 100 })
engine.animStart(JSON.stringify({ anims: batch.anims }))

// ② 列表让位（FLIP：变更前记快照 → 改数据 → 启动补间）
const shift = presets.list.shift({ staggerMs: 20 })
engine.flipCapture()
applyListMutation()
engine.flipStart({ durMs: shift.durationMs, curve: 1, staggerMs: shift.staggerMs })

// ③ 自定义声明（仍经编译期校验）
const custom = compileAnimations(
  [{ kind: 'opacity', from: 0, to: 1, durationMs: 200 },
   { kind: 'scale', from: 0.9, to: 1, spring: easing.snappy }],
  { node: detailCardId },
)

// ④ 滚动联动（MA5）：宿主滚动回调里**只报原始位置**，窗口换算在内核
const px = presets.scroll.parallax({ factor: 0.4, from: 0, to: 400 })
const batch = compileAnimations(px.decls, { node: heroBgId })
engine.animStart(JSON.stringify({ anims: batch.anims }))
onScroll((offsetY) => engine.animSeekScroll(JSON.stringify({ scroll: offsetY })))
```

## 滚动联动（MA5）——驱动通路

```
宿主滚动回调（UIScrollView didScroll / 手势 / 内容偏移）
      ↓ 只报**原始滚动位置**（px）
内核 anim_seek_scroll —— 窗口换算（(off-from)/span + 钳制 + curve_eval）唯一实现
      ↓ updates（一次算完视差层 + 吸顶头 + 渐显项）
宿主当帧写层
```

**滚动过程零 JS**，宿主零曲线数学、零窗口数学（它不需要知道任何动画窗口的存在）。声明侧只需给窗口：

```ts
presets.scroll.parallax({ factor: 0.4, from: 0, to: 400 })   // 滚 400px ⇒ 反向位移 -160px
presets.scroll.sticky({ pinAt: 80, span: 120 })              // 滚过 80px 后 120px 内完成钉住位移
presets.scroll.fadeIn({ from: 100, to: 300, risePx: 12 })    // 滚入区间内 opacity 0→1 + 上移 12px
```

★**滚动批次不走平台零参与路径**：那条路径是"提交后平台按**时间**自主插值"，而滚动动画的进度来自
**外部位置**——混用会把"跟手"变成"到点自动播放"。编译期 `isPlatformEligible` 预判 + 内核
`anim_commit_spec` 明确拒绝，双重拦住。

多段序列已落地，并收敛在**每属性一条动画**里（内核 `AnimMode::Keyframes`）：

```ts
// 一条动画内两段（不是两条声明——内核对同属性是替换语义，两条会互相覆盖）
presets.element.press()   // scale: 1 → 0.94（90ms）→ 1（260ms 弹性近似）
presets.element.shake()   // translateX: 0 → -10 → +10 → 0（三段；末段必回 0）
// 或手写：
compileAnimations([{ kind: 'scale', from: 1, to: 1,
  keyframes: [{ to: 0.9, durationMs: 80 }, { to: 1, durationMs: 200, curve: 'springApprox' }] }],
  { nodeId: btn })
```

★**多段 ≠ 多条**：整段序列在平台零参与路径上仍是**一条** `CAKeyframeAnimation`（采样整段），
不额外增加提交次数。段的边界精确（分段定位按 `p × 总时长`，边界处值恰为段 `to`）。

## 编译期校验（把"会不会掉帧"变成编译期问题）

`compileAnimations` / `compileRoute` 内部先跑 `validateAnimations`，**失败即 throw**（附 `formatIssues` 可读文本 + 修复提示）。7 类判据：

- 参数非法（时长 ≤ 0、弹簧参数越界、from/to 非有限值）
- **同属性重复**：内核对同 `(节点, 属性)` 是**替换**语义 ⇒ 同一批次里出现两次会静默替换 ⇒ 编译期拦截
- 目标缺失 / 未知 `kind` / 未知 `curve` / 非合成属性警告（走平台零参与路径的门槛）

## 共享元素（cross-element flight）

几何由**内核**算（`proteus_layout_shared_element`）：吃「源矩形 + 目标节点」，吐 `dx/dy/scale`
（中心差 + 宽度比），宿主只把数字喂给层 + 做**层级提升**（`zPosition`）。

```ts
// 源 = 同树节点（同页面共享元素，如列表缩略图 → 详情大图）
const sp = presets.element.sharedElement({ fromNodeId: thumbnailId, durationMs: 400 })
node.sharedElement(JSON.stringify({ targetId: heroId, sourceNodeId: thumbnailId, durMs: sp.durationMs, fadeIn: sp.fadeIn }))
// 源 = 系统坐标矩形（跨稳态：静态布局可在编译期算出，随指令下发）
node.sharedElement(JSON.stringify({ targetId: heroId, sourceRect: { x: 24, y: 300, w: 80, h: 80 } }))
```

★**硬重启语义**：起点是**算出来的几何**（不是上一条动画的当前值）——若走接管，层上起点会被覆盖
⇒ 视觉上不落在源矩形（静默错位，与滚动联动同一条红线）。首帧起点随 `updates` 立即返回（不跳变）。
★**层级必须复位**：`zPosition` 是持久状态，飞行结束要复位（否则后续相位里该层一直压着兄弟）。

## 未做（诚实边界）

- **跨属性编排**（如"位移与缩放共享一条时间轴、各自多段"）：当前每个属性各自成条，段之间**没有共享时间轴**的约束（各条动画用各自 `durMs`，内核按各自进度求值）。要"多属性严格对齐的分段编排"需引入显式时间轴（评估中）。
- **共享元素的等比边界**：内核只有**等比** scale ⇒ 以**宽度比**为准；源/目标宽高比不一致时，高度按目标宽高比推出（要精确对应须业务侧保持一致）。
- **跨页面稳态几何的回传**：`fromRect` 由调用方注入（静态布局可编译期算）；真正的"上一页滚动位置/动态位置"需要页面栈层提供回传通道，当前未接。
- **手势驱动 API 表面**：内核已支持 `Progress` 驱动（`seek` 立即写字段，手指到哪画面到哪），但本包暂未提供对应的声明式入口（当前由宿主直接调 `animSeek`）。
- **`scroll.sticky` 是"位移补偿"而非布局吸顶**：本引擎只写合成属性，真·改变定位（`position: sticky`）属布局属性、不在属性面上（会被编译期拦）。吸顶观感依赖"位移补偿 + 布局让位"的组合。
- **滚动输入源**：`presets.scroll` 的驱动接口（报位置）已与输入源解耦；真机验证走的是宿主滚动通路（`applyContentOffset`，与既有 `scrollBy` 同一路径），真手指拖动 UIScrollView 的接线属后续工作。
- **平台零参与路径的粒度**：iOS 已落地（CAKeyframeAnimation → render server）；Android 当前是**页面级**（ViewPropertyAnimator 挂在容器上），逐节点形态需要改"真拍平"承载结构，单独评估。

## 门禁与测试

```bash
npx vitest run tests/animation-presets.test.ts    # 24 条：编译正确性 / 归一化 / 校验红侧 / 跨语言数值对账
pnpm --filter @proteus-vue/animation build        # 产物构建（ESM bundle + d.ts）
```

真机验证：`hosts/ios/check-anim-rt2.py`（**全 51 条判据**，iPhone 12 全绿）。分组：

- H 组 6 条 = 预设编译 / 微信语义对齐 / 指令下发 / 端上驱动 / 校验有效 / 跨语言同值；
- I 组 5 条 = 滚动联动（视差映射 / 宿主滚动通路生产形态 / 退化窗口与滚动+弹簧拦截 / 平台路径排除）；
- J 组 4 条 = 序列编排（一条动画三段 / 分段推进与边界精确 / 终值精确 / 平台路径仍一条）；
- K 组 6 条 = 共享元素（内核几何 / 首帧在源矩形 / 层级提升与复位 / 终值归位 / 宽度比生效 / 错误冒泡）；
- 另有判据 -1：**任何相位异常必须红**（读数缺失不得伪装成「没做」）。
