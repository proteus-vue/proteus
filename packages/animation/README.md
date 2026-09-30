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
| `presets` / `route` / `list` / `element` / `easing` | 预设库（见下） |

## 预设库（"开箱即用" = 预设，不是参数）

| 预设 | 说明 |
|------|------|
| `route.bottomSheet()` | 半屏弹窗从底部滑入，**只动进场页**（对齐 `wx://bottom-sheet`） |
| `route.slideUp()` | 全屏向上推入，旧页视差让位 + 淡出（对齐 `wx://upwards`） |
| `route.zoom()` | 新页缩放进入 + 旧页下沉（对齐 `wx://zoom`） |
| `route.cupertinoModal()` | iOS 风格全屏模态（弹簧）（对齐 `wx://cupertino-modal`） |
| `list.shift()` | **列表项增删让位**（映射内核 FLIP：几何在内核，零跨边界；是 §5 招牌能力） |
| `element.fadeIn()` / `pressRelease()` / `sharedElementFlyIn()` | 元素入场 / 按压弹回 / 共享元素飞入 |
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
```

## 编译期校验（把"会不会掉帧"变成编译期问题）

`compileAnimations` / `compileRoute` 内部先跑 `validateAnimations`，**失败即 throw**（附 `formatIssues` 可读文本 + 修复提示）。7 类判据：

- 参数非法（时长 ≤ 0、弹簧参数越界、from/to 非有限值）
- **同属性重复**：内核对同 `(节点, 属性)` 是**替换**语义 ⇒ 同一批次里出现两次会静默替换 ⇒ 编译期拦截
- 目标缺失 / 未知 `kind` / 未知 `curve` / 非合成属性警告（走平台零参与路径的门槛）

## 未做（诚实边界）

- **序列编排（sequence）**：内核对同 `(节点, 属性)` 是替换语义，"先下压再弹回"这类**两段串联**在一个批次里表达不了 ⇒ 需要调用方拆成两次启动（或用单个弹簧从按下值弹回）。序列编排是已知缺口。
- **共享元素跨页面**：`element.sharedElementFlyIn` 目前只做"在落点上做缩放+淡入"；真正的"从起点矩形飞入"需要三端 `platform/` 层（跨页面坐标换算），见 Morpheus 文档 B1 评测项。
- **手势驱动 API 表面**：内核已支持 `Progress` 驱动（`seek` 立即写字段，手指到哪画面到哪），但本包暂未提供对应的声明式入口（当前由宿主直接调 `animSeek`）。
- **平台零参与路径的粒度**：iOS 已落地（CAKeyframeAnimation → render server）；Android 当前是**页面级**（ViewPropertyAnimator 挂在容器上），逐节点形态需要改"真拍平"承载结构，单独评估。

## 门禁与测试

```bash
npx vitest run tests/animation-presets.test.ts    # 24 条：编译正确性 / 归一化 / 校验红侧 / 跨语言数值对账
pnpm --filter @proteus-vue/animation build        # 产物构建（ESM bundle + d.ts）
```

真机验证：`hosts/ios/check-anim-rt2.py`（H 组 6 条判据：预设编译 → 微信语义对齐 → 指令下发 → 端上驱动 → 校验有效 → 跨语言同值）。
