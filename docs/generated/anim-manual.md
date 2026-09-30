---
title: Morpheus 动画声明项 AI 说明书
order: 92
group: 框架能力
generated: true
---

# Morpheus 动画声明项 AI 说明书

> **生成物，勿手改**：`node scripts/gen-anim-manual.mjs`（`--check` 接 CI，漂移即红）
> **单一事实来源**：`packages/animation/src/rules.ts` 的 `ANIM_RULES`（22 条）
>
> 本表与编译器的 111 条规则**同构**（Morpheus §13 第 11 条硬性要求）——
> 每条含 what / why / when / 示例 / 如何验证 / 实现位置，AI 可单独消费一条。
>
> **conformance**：本页生成前会跑 `runConformance()` 对账（预设真实存在 / 跨语言契约值一致 /
> `verify` 可追溯）——**对不上就不生成**，避免产出误导性文档。

## 预设（可直接用）（12 条）

### `preset/route.bottomSheet`

**半屏弹窗（从底部滑入）** `[implemented]`

- **是什么**：进场页 translateY: distance → 0；**只动进场页**（旧页不动）。语义对齐微信 `wx://bottom-sheet`。
- **为什么**：弹窗场景下旧页保持不动（背景被遮罩压暗即可）——动它反而让用户误以为页面在跳。与微信行为一致。
- **何时用**：半屏弹窗 / 抽屉 / 底部面板
- **如何验证**：tests/animation-presets.test.ts「bottomSheet：只动进场页」；hosts/ios/check-anim-rt2.py 的 H4
- **实现位置**：`packages/animation/src/presets.ts:route.bottomSheet`

```ts
const spec = presets.route.bottomSheet()
const batch = compileRoute(spec, { enter: 101, exit: 100 })
engine.animStart(JSON.stringify({ anims: batch.enter.anims }))
```

### `preset/route.slideUp`

**全屏向上推入（旧页视差让位）** `[implemented]`

- **是什么**：进场页 translateY: +distance → 0；退出页反向位移 + 淡出。语义对齐微信 `wx://upwards`。
- **为什么**：旧页向反方向让位（视差）+ 轻微淡出——这是"推入"的层次感来源；只动新页会显得扁平。
- **何时用**：全屏页面推进（详情页 / 二级页）
- **如何验证**：tests/animation-presets.test.ts「slideUp：进场页推入 + 旧页反向让位」
- **实现位置**：`packages/animation/src/presets.ts:route.slideUp`

```ts
const spec = presets.route.slideUp()
const batch = compileRoute(spec, { enter: 2, exit: 1 })
```

### `preset/route.zoom`

**缩放下沉（新页放大进入 + 旧页下沉）** `[implemented]`

- **是什么**：进场页 scale + translateY + opacity 三属性同时进场；退出页缩小 + 变暗。对齐 `wx://zoom`。
- **为什么**：旧页"下沉"（缩小 + 变暗）视觉上像被压到下面——这是 zoom 转场的层次感来源。
- **何时用**：需要"放大进入"观感的转场（卡片展开 / 模态详情）
- **如何验证**：tests/animation-presets.test.ts 路由转场 4 预设编译通过
- **实现位置**：`packages/animation/src/presets.ts:route.zoom`

```ts
const spec = presets.route.zoom({ fromScale: 0.9, fromOffsetY: 40 })
const batch = compileRoute(spec, { enter: 2, exit: 1 })
```

### `preset/route.cupertinoModal`

**iOS 风格模态（弹簧手感）** `[implemented]`

- **是什么**：进场页 translateY: distance → 0（**弹簧**而非曲线）；退出页轻微缩小。对齐 `wx://cupertino-modal`。
- **为什么**：与 bottomSheet 的差别：模态是**全屏**（距离=屏幕高）且带阻尼感（弹簧）。手感预设与内核 `SpringParams::smooth` 同值。
- **何时用**：iOS 观感的模态（全屏弹出）
- **如何验证**：tests/animation-presets.test.ts「cupertinoModal 用弹簧」；Rust `spring_presets_match_ts_side`
- **实现位置**：`packages/animation/src/presets.ts:route.cupertinoModal`

```ts
const spec = presets.route.cupertinoModal({ distance: 844 })
```

### `preset/list.shift`

**列表项增删让位（FLIP）** `[implemented]`

- **是什么**：映射内核 FLIP 的三个参数（durationMs / curve / staggerMs）——变更前 `flipCapture`、变更后 `flipStart`。
- **为什么**：本仓几何本来就在内核 ⇒ 两次快照都是内部读，**零跨边界、零 JS**（传统 FLIP 要前后各读一次几何）。这是招牌能力。
- **何时用**：列表增删 / 排序 / 筛选导致的元素位移
- **相关决策**：Morpheus §5（布局动画是超能力）
- **如何验证**：hosts/ios/check-anim-rt2.py 的 F3；packages/layout-core-rust/src/anim.rs 的 `flip_zero_stagger_has_no_tail_delay`
- **实现位置**：`packages/animation/src/presets.ts:list.shift`

```ts
const shift = presets.list.shift({ staggerMs: 20 })
engine.flipCapture()
applyListMutation()
engine.flipStart({ durMs: shift.durationMs, curve: 1, staggerMs: shift.staggerMs })
```

### `preset/element.press`

**按压反馈（两段序列：下压 → 回弹）** `[implemented]`

- **是什么**：一条动画内两段：`1 → fromScale`（downMs）→ `1`（upMs，弹簧近似曲线）。
- **为什么**：★这是"序列编排"的存在理由：内核对同 (节点,属性) 是**替换**语义，"先下压再弹回"用两条声明会被后者静默替换 ⇒ 多段必须收敛在**一条**动画里（内核 `AnimMode::Keyframes`）。
- **何时用**：按钮 / 卡片的按压反馈
- **相关决策**：PROJECT_MEMORY ⑱（MA6 序列编排）
- **如何验证**：tests/animation-presets.test.ts「press 编译出一条动画、内两段」；hosts/ios/check-anim-rt2.py 的 J 组
- **实现位置**：`packages/animation/src/presets.ts:element.press`

```ts
const press = presets.element.press({ fromScale: 0.94, downMs: 90, upMs: 260 })
const c = compileAnimations(press.decls, { nodeId: btnId })   // → 1 条动画、内两段
```

### `preset/element.shake`

**抖动（错误提示，三段往复）** `[implemented]`

- **是什么**：translateX 三段：`0 → -amp → +amp → 0`（末段**必须**回 0）。
- **为什么**：★抖动是**扰动不是位移**：末段不回 0 会让元素永久偏移（"看起来对、实际错位"的典型）——预设已保证末段 to=0。
- **何时用**：表单校验失败 / 非法操作的视觉反馈
- **如何验证**：tests/animation-presets.test.ts「shake 末段必须回到 0」
- **实现位置**：`packages/animation/src/presets.ts:element.shake`

```ts
const shake = presets.element.shake({ amplitude: 10, durationMs: 360 })
```

### `preset/element.sharedElement`

**共享元素（从源飞到目标再归位）** `[implemented]`

- **是什么**：给**源**（`fromNodeId` 同树节点 / `fromRect` 系统坐标）与**目标节点**，内核算 `dx/dy/scale`（中心差 + 宽度比）。
- **为什么**：几何必须在内核算（纪律 #22）：中心差 + 宽度比是跨页面过渡的**全部视觉语义**，三端各写一份会手感分叉且只在真机上肉眼可见。★**硬重启**语义：起点是算出的几何，不是上一条动画的当前值。
- **何时用**：列表缩略图 → 详情大图的连续过渡（B1 benchmark 核心环节）
- **相关决策**：PROJECT_MEMORY ⑲
- **如何验证**：hosts/ios/check-anim-rt2.py 的 K 组 6 条（内核几何 / 首帧在源矩形 / 层级提升与复位 / 终值归位 / 宽度比 / 错误冒泡）
- **实现位置**：`packages/animation/src/presets.ts:element.sharedElement（几何在内核 anim.rs:start_shared_element）`

```ts
const sp = presets.element.sharedElement({ fromNodeId: thumbId })
node.sharedElement(JSON.stringify({ targetId: heroId, sourceNodeId: thumbId, durMs: sp.durationMs }))
```

### `preset/element.fadeIn`

**淡入（可选叠加上移）** `[implemented]`

- **是什么**：opacity `0 → 1`；`risePx > 0` 时追加 translateY `rise → 0`。
- **为什么**：裸淡入显平淡；轻微上移让元素"浮上来"（两条声明属性不同 ⇒ 合法并存）。
- **何时用**：内容加载完成 / 首次出现的元素
- **如何验证**：tests/animation-presets.test.ts「元素预设可编译」
- **实现位置**：`packages/animation/src/presets.ts:element.fadeIn`

```ts
const fade = presets.element.fadeIn({ durationMs: 240, risePx: 8 })
```

### `preset/scroll.parallax`

**视差（背景层随滚动反向慢移）** `[implemented]`

- **是什么**：窗口 `[from, to]` 内 translateY `0 → -(span × factor)`。
- **为什么**：驱动通路是"宿主滚动回调只报**原始位置**，换算在内核"——JS 与曲线数学都不在链路上（滚动过程零 JS）。
- **何时用**：滚动视差（Hero 区 / 背景层）
- **相关决策**：PROJECT_MEMORY ⑰（MA5）
- **如何验证**：hosts/ios/check-anim-rt2.py 的 I2（窗 0..400 × 0.4：0→0.00 / 200→-80.00 / 400→-160.00）
- **实现位置**：`packages/animation/src/presets.ts:scroll.parallax（换算在内核 anim.rs:seek_scroll）`

```ts
const px = presets.scroll.parallax({ factor: 0.4, from: 0, to: 400 })
const c = compileAnimations(px.decls, { nodeId: heroBgId })
engine.animStart(JSON.stringify({ anims: c.anims }))
onScroll((y) => engine.animSeekScroll(JSON.stringify({ scroll: y })))
```

### `preset/scroll.sticky`

**吸顶（位移补偿）** `[limitation]`

- **是什么**：窗口 `[pinAt, pinAt+span]` 内 translateY `0 → -span`。
- **为什么**：★**诚实边界**：本引擎只写**合成属性** ⇒ 吸顶表达为"位移补偿 + 布局让位"，真·改变定位（position: sticky）属布局属性、不在属性面上（会被编译期拦）。
- **何时用**：滚动时的头部钉住（配合布局让位）
- **如何验证**：hosts/ios/check-anim-rt2.py 的 I1（滚动预设下发 started=3）
- **实现位置**：`packages/animation/src/presets.ts:scroll.sticky`

```ts
const sticky = presets.scroll.sticky({ pinAt: 80, span: 120 })
```

### `preset/scroll.fadeIn`

**渐显（滚入区间内 0 → 1）** `[implemented]`

- **是什么**：窗口 `[from, to]` 内 opacity `0 → 1`；可叠加轻微上移。
- **为什么**：`from/to` 通常取"元素进入视口"的滚动位置区间（由布局计算给出，预设不猜）。
- **何时用**：滚动到某位置才出现的元素（内容渐显 / 懒加载占位）
- **如何验证**：hosts/ios/check-anim-rt2.py 的 I4（退化窗口 / 滚动+弹簧 各被拦）
- **实现位置**：`packages/animation/src/presets.ts:scroll.fadeIn`

```ts
const f = presets.scroll.fadeIn({ from: 100, to: 300, risePx: 12 })
```

## 声明面原语（字段/取值）（4 条）

### `primitive/AnimDecl`

**动画声明（封闭集的全部字段）** `[implemented]`

- **是什么**：`kind`（动哪个属性，必填）+ `to`（终点，必填）+ 三者之一（`curve` / `spring` / `keyframes`） + `from` / `durationMs` / `delayMs` / `scroll` / `takeover`。
- **为什么**：★**不开放任意 JS 动画函数**（Morpheus §13 第 3 条）——能声明的是**封闭集**；曲线求值与物理积分**只在 Rust 内核**（唯一实现，纪律 #22）。
- **何时用**：所有动画声明的入口（预设最终也编译成它）
- **如何验证**：tests/animation-presets.test.ts 编译段（绿侧 + 默认值归一 + 目标绑定）
- **实现位置**：`packages/animation/src/types.ts:AnimDecl`

```ts
compileAnimations(
  [{ kind: 'opacity', from: 0, to: 1, durationMs: 200 },
   { kind: 'scale', from: 0.9, to: 1, spring: easing.snappy }],
  { nodeId: cardId },
)
```

### `primitive/AnimKind`

**动画属性封闭集（5 个，全部是合成属性）** `[implemented]`

- **是什么**：`translateX`(0) / `translateY`(1) / `scale`(2) / `rotate`(3) / `opacity`(4)——编号是**跨语言契约**。
- **为什么**：★**合成属性判定是分水岭**（§5-bis.1）：只有 transform/opacity 子集能走平台渲染线程零参与路径；本引擎**只做绘制层变换** ⇒ 五个全是合成属性（`width/height/margin` 这类布局属性会被编译期拦）。
- **何时用**：任何声明都要从这里选（写错名字是类型级错误）
- **如何验证**：packages/layout-core-rust/src/anim.rs 的 `AnimKind::from_u8`；tests/animation-presets.test.ts「编号与内核一致（0..4）」
- **实现位置**：`packages/animation/src/types.ts:AnimKind（内核 anim.rs:AnimKind）`

```ts
import { AnimKind, ANIM_KIND_ID } from '@proteus-vue/animation'
ANIM_KIND_ID.translateY   // → 1（与内核 AnimKind 同号）
```

### `primitive/Curve`

**曲线封闭集（5 个）** `[implemented]`

- **是什么**：`linear`(0) / `easeOut`(1) / `easeIn`(2) / `easeInOut`(3) / `springApprox`(4)——编号与内核 `CURVE_*` 同号。
- **为什么**：`springApprox` 是**阻尼振荡的查表近似**（与真弹簧不同）——需要物理语义时用 `spring` 字段而非这条曲线；内核另有 `curve_bezier_approx` 供 Android `PathInterpolator`（弹簧**诚实返回 None**：非单调，无贝塞尔近似）。
- **何时用**：声明 `curve` 字段时（与 `spring` 二选一）
- **如何验证**：tests/animation-presets.test.ts「Curve 编号与内核一致（0..4）」；packages/layout-core-rust/src/anim.rs 的 `table_matches_exact_formula`
- **实现位置**：`packages/animation/src/types.ts:Curve（内核 anim.rs:CURVE_*）`

```ts
{ kind: 'translateX', from: 0, to: 100, curve: 'easeOut', durationMs: 300 }
```

### `primitive/keyframes`

**序列编排（一条动画内多段）** `[implemented]`

- **是什么**：`keyframes: [{ to, durationMs, curve? }, …]`——段间起点 = 上段终点（首段起点 = `from`）。
- **为什么**：★内核对同 (节点,属性) 是**替换**语义 ⇒ 多段必须收敛在**一条**动画里；★整段序列在平台零参与路径上仍是**一条** `CAKeyframeAnimation`（不增提交次数）。
- **何时用**："先压再弹" / "抖动" / 任何同属性的多段编排
- **如何验证**：packages/layout-core-rust/src/anim.rs 的 6 条序列单测；hosts/ios/check-anim-rt2.py 的 J2（边界精确 0.600）
- **实现位置**：`packages/animation/src/types.ts:KeyframeSeg（内核 anim.rs:AnimMode::Keyframes）`

```ts
{ kind: 'scale', from: 1, to: 1, keyframes: [
    { to: 0.9, durationMs: 80 }, { to: 1, durationMs: 200, curve: 'springApprox' }] }
```

## 约束与陷阱（会静默出错）（4 条）

### `constraint/duplicate-kind`

**同属性重复声明会被静默替换（编译期拦截）** `[implemented]`

- **是什么**：一个批次里同 `kind` 出现两次 ⇒ 后者替换前者（内核对同 (节点,属性) 是替换语义）。
- **为什么**：开发者以为"按下再弹回"，实际只有一条在跑——**静默**。⇒ 编译期拦住并指向正解（`keyframes`）。
- **何时用**：想写"序列"时（错法）
- **如何验证**：tests/animation-presets.test.ts「同属性重复的提示现在指向 keyframes」；hosts/ios/check-anim-rt2.py 的 H5（被拦）
- **实现位置**：`packages/animation/src/validate.ts:validateAnimations`

```ts
// ✗ 编译期报错
compileAnimations([{ kind: 'scale', to: 0.9, durationMs: 100 },
                   { kind: 'scale', to: 1, durationMs: 100 }], { nodeId: 1 })
// ✓ 正解
compileAnimations([{ kind: 'scale', from: 1, to: 1, keyframes: [...] }], { nodeId: 1 })
```

### `constraint/drive-source-exclusive`

**滚动驱动 ≠ 平台零参与路径（驱动源互斥）** `[implemented]`

- **是什么**：带 `scroll` 窗口的批次**不得**走 `anim_commit_spec`（平台路径）。
- **为什么**：平台路径的语义是"提交后平台按**时间**自主插值"，而滚动动画的进度来自**外部位置**——混用会把"跟手"变成"到点自动播放"（完全不是同一动效）。编译期预判 + 内核**双重拒绝**。
- **何时用**：用滚动联动时
- **如何验证**：tests/animation-presets.test.ts「滚动批次不具备平台零参与资格」；hosts/ios/check-anim-rt2.py 的 I5
- **实现位置**：`packages/animation/src/compile.ts:isPlatformEligible`

```ts
isPlatformEligible(compileAnimations(presets.scroll.parallax().decls, { nodeId: 1 }))  // → false
```

### `constraint/takeover-semantics`

**接管语义（位置连续 + 速度移交），但三类动画例外** `[implemented]`

- **是什么**：默认 `takeover=true`：同 (节点,属性) 已有动画 ⇒ 新动画从**当前位置与速度**接管。
- **为什么**：★三类**特殊处理**（都是静默错位的预防）：· **滚动驱动不接管**——`from/to` 是窗口映射两端，被覆盖会整体偏一截；· **序列不重映射 from**——锚点是编排好的两端，重映射会让"下压→回弹"错形；· **共享元素不接管**——起点是算出的几何，被覆盖就不落在源矩形。
- **何时用**：打断/接管场景（手势介入、快速切换）
- **相关决策**：PROJECT_MEMORY ⑰⑱⑲（三次真机教训各一条）
- **如何验证**：packages/layout-core-rust/src/anim.rs 的 `start_scroll_does_not_inherit_previous_value_into_range` / `keyframes_takeover_does_not_remap_anchors` / `shared_element_does_not_take_over_previous_animation`
- **实现位置**：`packages/layout-core-rust/src/anim.rs:AnimEngine::start（三处例外）+ start_scroll/start_shared_element`

```ts
{ kind: 'translateX', to: 300, spring: easing.snappy, takeover: false }  // 硬重启
```

### `constraint/platform-eligible`

**平台零参与路径的资格（合成属性 + 非滚动）** `[implemented]`

- **是什么**：`isPlatformEligible(batch)`：全为合成属性 **且** 不含滚动驱动。
- **为什么**：真值以**内核**为准（唯一实现）；本函数是"快速否决"，不是"第二份判定"——避免明知不可行还发一轮跨边界调用。
- **何时用**：想把动画交给平台渲染线程（iOS CAKeyframeAnimation / Android 容器或载体）
- **如何验证**：packages/layout-core-rust/src/anim.rs 的 `plan_animations`（真值）+ hosts/ios/check-anim-rt2.py 的 G1/G4
- **实现位置**：`packages/animation/src/compile.ts:isPlatformEligible`

```ts
if (isPlatformEligible(batch)) engine.animCommit(JSON.stringify({ anims: batch.anims }))
```

## 诚实边界（能做 / 不能做）（2 条）

### `boundary/cross-property-timeline`

**跨属性共享时间轴：未做** `[planned]`

- **是什么**：当前每个属性各自成条、各按自身 `durMs`/进度求值；**没有**"多属性严格对齐的分段编排"。
- **为什么**：要"位移与缩放共享一条时间轴、各自多段"需引入显式时间轴模型（评估中）；当前用同名时长可近似。
- **何时用**：需要多属性精确同拍的复杂编排时（当前能力不足，需拆解或接受近似）
- **如何验证**：包 README「未做」一节（如实记录）
- **实现位置**：`packages/animation/README.md:未做（conformance 只保证"已声称的与实现一致"，不覆盖未做项）`

```ts
// 近似做法：给同一 durationMs，让各属性各自跑完
[{ kind: 'translateX', to: 100, durationMs: 400 }, { kind: 'scale', to: 1.2, durationMs: 400 }]
```

### `boundary/no-arbitrary-js-animation`

**不开放任意 JS 动画函数（设计红线）** `[limitation]`

- **是什么**：没有"让开发者写任意动画逻辑"的 API；能声明的只有封闭集。
- **为什么**：Morpheus §13 第 3 条：那是"在第一王炸上开口子"（与"不开放任意原生调用"同理）。需要算不出来的东西时，走**显式逃生口**（且要可统计），不是开任意函数。
- **何时用**：遇到"预设和字段都不够用"时（**不要**找后门，先看是否该补预设）
- **相关决策**：Morpheus §13 第 3 条
- **如何验证**：validate.ts 的封闭集校验（未知 kind/curve 直接报错）
- **实现位置**：`packages/animation/src/types.ts（封闭集定义）`

```ts
// 逃生口方向（当前未实现）：记 degraded 并单列——不得静默降级
```

<!-- generated by scripts/gen-anim-manual.mjs · SSOT：packages/animation/src/rules.ts ANIM_RULES -->
