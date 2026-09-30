// packages/animation/src/rules.ts
// ★★Morpheus（MA1 收尾）—— **动画声明项的 AI 说明书**
//
// 【为什么必须有（Morpheus §13 执行指令第 11 条，原文硬性要求）】
//   「每个预设与声明项**必须配 conformance 断言 + AI 说明书**，与既有 111 条规则同构。」
//   本仓的透明定位（AI-native）：**能力必须自描述**——AI 要能枚举"这个引擎能做什么"、
//   查单条的 what/why/when/how-verify、并由 `source` 直接跳读实现，而不是靠读散文猜。
//
// 【与 `@proteus-vue/compiler` 的 `TransformRule` 的关系】
//   同一套字段语义（id/title/status/description/why/when/example/verify/source/decision），
//   但动画的"规则"不是**源码变换**而是**声明项与约束**（预设 = 可声明的能力；
//   约束 = 会静默出错的陷阱）。故不共用类型（那是另一条流水线），**共用写作规范与验收标准**：
//   每条必须能被机器校验（见 `conformance.ts` 的断言 + `scripts/gen-anim-manual.mjs --check`）。
//
// 【诚实边界】本表是**人写的自描述**；"它说的是不是真的"由 conformance 套件对账
//   （预设编译结果 ↔ 内核数值/编号），不靠本文件自我声明。

/** 动画声明项的类别（决定读者怎么用它） */
export type AnimRuleKind =
  | 'preset' // 开箱即用的预设（可直接用）
  | 'primitive' // 声明面原语（字段/取值）
  | 'constraint' // 约束与陷阱（会静默出错，必须知道）
  | 'boundary' // 诚实边界（能做/不能做）

/** 一条动画声明项的 AI 说明书 */
export interface AnimRule {
  /** 稳定 ID：`<kind>/<name>`，如 `preset/route.bottomSheet`（文档/测试引用此 ID） */
  id: string
  kind: AnimRuleKind
  /** 人类可读标题 */
  title: string
  /** what：它是什么 / 做什么 */
  description: string
  /** why：为什么这样设计（含本仓决策号或真机教训） */
  why: string
  /** when：什么时候用（触发条件/适用场景） */
  when: string
  /** 最小可用示例（可复制；真实可跑的形态） */
  example: string
  /** 如何验证：对应测试 / 真机判据（**必须指向真实存在的检查**） */
  verify: string
  /** implemented = 已落地可用；planned = 规划中；limitation = 明确不做 */
  status: 'implemented' | 'planned' | 'limitation'
  /** 实现位置（文件:符号），AI 跳读源码用 */
  source: string
  /** 相关决策（PROJECT_MEMORY.md 的条目号 / 文档章节） */
  decision?: string
}

/**
 * ★**全量动画声明项**（单一事实来源——生成物、门禁、AI 都读这里）
 *
 * 覆盖：4 组预设（route/list/element/scroll）+ 声明面原语（AnimKind/Curve/字段）
 *       + 约束（同属性替换、驱动源互斥、接管语义）+ 诚实边界。
 */
export const ANIM_RULES: readonly AnimRule[] = [
  /* ────────────────────────── 预设：路由转场 ────────────────────────── */
  {
    id: 'preset/route.bottomSheet',
    kind: 'preset',
    title: '半屏弹窗（从底部滑入）',
    description: '进场页 translateY: distance → 0；**只动进场页**（旧页不动）。语义对齐微信 `wx://bottom-sheet`。',
    why: '弹窗场景下旧页保持不动（背景被遮罩压暗即可）——动它反而让用户误以为页面在跳。与微信行为一致。',
    when: '半屏弹窗 / 抽屉 / 底部面板',
    example: `const spec = presets.route.bottomSheet()
const batch = compileRoute(spec, { enter: 101, exit: 100 })
engine.animStart(JSON.stringify({ anims: batch.enter.anims }))`,
    verify: 'tests/animation-presets.test.ts「bottomSheet：只动进场页」；hosts/ios/check-anim-rt2.py 的 H4',
    status: 'implemented',
    source: 'packages/animation/src/presets.ts:route.bottomSheet',
  },
  {
    id: 'preset/route.slideUp',
    kind: 'preset',
    title: '全屏向上推入（旧页视差让位）',
    description: '进场页 translateY: +distance → 0；退出页反向位移 + 淡出。语义对齐微信 `wx://upwards`。',
    why: '旧页向反方向让位（视差）+ 轻微淡出——这是"推入"的层次感来源；只动新页会显得扁平。',
    when: '全屏页面推进（详情页 / 二级页）',
    example: `const spec = presets.route.slideUp()
const batch = compileRoute(spec, { enter: 2, exit: 1 })`,
    verify: 'tests/animation-presets.test.ts「slideUp：进场页推入 + 旧页反向让位」',
    status: 'implemented',
    source: 'packages/animation/src/presets.ts:route.slideUp',
  },
  {
    id: 'preset/route.zoom',
    kind: 'preset',
    title: '缩放下沉（新页放大进入 + 旧页下沉）',
    description: '进场页 scale + translateY + opacity 三属性同时进场；退出页缩小 + 变暗。对齐 `wx://zoom`。',
    why: '旧页"下沉"（缩小 + 变暗）视觉上像被压到下面——这是 zoom 转场的层次感来源。',
    when: '需要"放大进入"观感的转场（卡片展开 / 模态详情）',
    example: `const spec = presets.route.zoom({ fromScale: 0.9, fromOffsetY: 40 })
const batch = compileRoute(spec, { enter: 2, exit: 1 })`,
    verify: 'tests/animation-presets.test.ts 路由转场 4 预设编译通过',
    status: 'implemented',
    source: 'packages/animation/src/presets.ts:route.zoom',
  },
  {
    id: 'preset/route.cupertinoModal',
    kind: 'preset',
    title: 'iOS 风格模态（弹簧手感）',
    description: '进场页 translateY: distance → 0（**弹簧**而非曲线）；退出页轻微缩小。对齐 `wx://cupertino-modal`。',
    why: '与 bottomSheet 的差别：模态是**全屏**（距离=屏幕高）且带阻尼感（弹簧）。手感预设与内核 `SpringParams::smooth` 同值。',
    when: 'iOS 观感的模态（全屏弹出）',
    example: `const spec = presets.route.cupertinoModal({ distance: 844 })`,
    verify: 'tests/animation-presets.test.ts「cupertinoModal 用弹簧」；Rust `spring_presets_match_ts_side`',
    status: 'implemented',
    source: 'packages/animation/src/presets.ts:route.cupertinoModal',
  },

  /* ────────────────────────── 预设：元素与列表 ────────────────────────── */
  {
    id: 'preset/list.shift',
    kind: 'preset',
    title: '列表项增删让位（FLIP）',
    description: '映射内核 FLIP 的三个参数（durationMs / curve / staggerMs）——变更前 `flipCapture`、变更后 `flipStart`。',
    why: '本仓几何本来就在内核 ⇒ 两次快照都是内部读，**零跨边界、零 JS**（传统 FLIP 要前后各读一次几何）。这是招牌能力。',
    when: '列表增删 / 排序 / 筛选导致的元素位移',
    example: `const shift = presets.list.shift({ staggerMs: 20 })
engine.flipCapture()
applyListMutation()
engine.flipStart({ durMs: shift.durationMs, curve: 1, staggerMs: shift.staggerMs })`,
    verify: 'hosts/ios/check-anim-rt2.py 的 F3；packages/layout-core-rust/src/anim.rs 的 `flip_zero_stagger_has_no_tail_delay`',
    status: 'implemented',
    source: 'packages/animation/src/presets.ts:list.shift',
    decision: 'Morpheus §5（布局动画是超能力）',
  },
  {
    id: 'preset/element.press',
    kind: 'preset',
    title: '按压反馈（两段序列：下压 → 回弹）',
    description: '一条动画内两段：`1 → fromScale`（downMs）→ `1`（upMs，弹簧近似曲线）。',
    why: '★这是"序列编排"的存在理由：内核对同 (节点,属性) 是**替换**语义，'
      + '"先下压再弹回"用两条声明会被后者静默替换 ⇒ 多段必须收敛在**一条**动画里（内核 `AnimMode::Keyframes`）。',
    when: '按钮 / 卡片的按压反馈',
    example: `const press = presets.element.press({ fromScale: 0.94, downMs: 90, upMs: 260 })
const c = compileAnimations(press.decls, { nodeId: btnId })   // → 1 条动画、内两段`,
    verify: 'tests/animation-presets.test.ts「press 编译出一条动画、内两段」；hosts/ios/check-anim-rt2.py 的 J 组',
    status: 'implemented',
    source: 'packages/animation/src/presets.ts:element.press',
    decision: 'PROJECT_MEMORY ⑱（MA6 序列编排）',
  },
  {
    id: 'preset/element.shake',
    kind: 'preset',
    title: '抖动（错误提示，三段往复）',
    description: 'translateX 三段：`0 → -amp → +amp → 0`（末段**必须**回 0）。',
    why: '★抖动是**扰动不是位移**：末段不回 0 会让元素永久偏移（"看起来对、实际错位"的典型）——预设已保证末段 to=0。',
    when: '表单校验失败 / 非法操作的视觉反馈',
    example: `const shake = presets.element.shake({ amplitude: 10, durationMs: 360 })`,
    verify: 'tests/animation-presets.test.ts「shake 末段必须回到 0」',
    status: 'implemented',
    source: 'packages/animation/src/presets.ts:element.shake',
  },
  {
    id: 'preset/element.sharedElement',
    kind: 'preset',
    title: '共享元素（从源飞到目标再归位）',
    description: '给**源**（`fromNodeId` 同树节点 / `fromRect` 系统坐标）与**目标节点**，内核算 `dx/dy/scale`（中心差 + 宽度比）。',
    why: '几何必须在内核算（纪律 #22）：中心差 + 宽度比是跨页面过渡的**全部视觉语义**，'
      + '三端各写一份会手感分叉且只在真机上肉眼可见。★**硬重启**语义：起点是算出的几何，不是上一条动画的当前值。',
    when: '列表缩略图 → 详情大图的连续过渡（B1 benchmark 核心环节）',
    example: `const sp = presets.element.sharedElement({ fromNodeId: thumbId })
node.sharedElement(JSON.stringify({ targetId: heroId, sourceNodeId: thumbId, durMs: sp.durationMs }))`,
    verify: 'hosts/ios/check-anim-rt2.py 的 K 组 6 条（内核几何 / 首帧在源矩形 / 层级提升与复位 / 终值归位 / 宽度比 / 错误冒泡）',
    status: 'implemented',
    source: 'packages/animation/src/presets.ts:element.sharedElement（几何在内核 anim.rs:start_shared_element）',
    decision: 'PROJECT_MEMORY ⑲',
  },
  {
    id: 'preset/element.fadeIn',
    kind: 'preset',
    title: '淡入（可选叠加上移）',
    description: 'opacity `0 → 1`；`risePx > 0` 时追加 translateY `rise → 0`。',
    why: '裸淡入显平淡；轻微上移让元素"浮上来"（两条声明属性不同 ⇒ 合法并存）。',
    when: '内容加载完成 / 首次出现的元素',
    example: `const fade = presets.element.fadeIn({ durationMs: 240, risePx: 8 })`,
    verify: 'tests/animation-presets.test.ts「元素预设可编译」',
    status: 'implemented',
    source: 'packages/animation/src/presets.ts:element.fadeIn',
  },

  /* ────────────────────────── 预设：滚动联动 ────────────────────────── */
  {
    id: 'preset/scroll.parallax',
    kind: 'preset',
    title: '视差（背景层随滚动反向慢移）',
    description: '窗口 `[from, to]` 内 translateY `0 → -(span × factor)`。',
    why: '驱动通路是"宿主滚动回调只报**原始位置**，换算在内核"——JS 与曲线数学都不在链路上（滚动过程零 JS）。',
    when: '滚动视差（Hero 区 / 背景层）',
    example: `const px = presets.scroll.parallax({ factor: 0.4, from: 0, to: 400 })
const c = compileAnimations(px.decls, { nodeId: heroBgId })
engine.animStart(JSON.stringify({ anims: c.anims }))
onScroll((y) => engine.animSeekScroll(JSON.stringify({ scroll: y })))`,
    verify: 'hosts/ios/check-anim-rt2.py 的 I2（窗 0..400 × 0.4：0→0.00 / 200→-80.00 / 400→-160.00）',
    status: 'implemented',
    source: 'packages/animation/src/presets.ts:scroll.parallax（换算在内核 anim.rs:seek_scroll）',
    decision: 'PROJECT_MEMORY ⑰（MA5）',
  },
  {
    id: 'preset/scroll.sticky',
    kind: 'preset',
    title: '吸顶（位移补偿）',
    description: '窗口 `[pinAt, pinAt+span]` 内 translateY `0 → -span`。',
    why: '★**诚实边界**：本引擎只写**合成属性** ⇒ 吸顶表达为"位移补偿 + 布局让位"，'
      + '真·改变定位（position: sticky）属布局属性、不在属性面上（会被编译期拦）。',
    when: '滚动时的头部钉住（配合布局让位）',
    example: `const sticky = presets.scroll.sticky({ pinAt: 80, span: 120 })`,
    verify: 'hosts/ios/check-anim-rt2.py 的 I1（滚动预设下发 started=3）',
    status: 'limitation',
    source: 'packages/animation/src/presets.ts:scroll.sticky',
  },
  {
    id: 'preset/scroll.fadeIn',
    kind: 'preset',
    title: '渐显（滚入区间内 0 → 1）',
    description: '窗口 `[from, to]` 内 opacity `0 → 1`；可叠加轻微上移。',
    why: '`from/to` 通常取"元素进入视口"的滚动位置区间（由布局计算给出，预设不猜）。',
    when: '滚动到某位置才出现的元素（内容渐显 / 懒加载占位）',
    example: `const f = presets.scroll.fadeIn({ from: 100, to: 300, risePx: 12 })`,
    verify: 'hosts/ios/check-anim-rt2.py 的 I4（退化窗口 / 滚动+弹簧 各被拦）',
    status: 'implemented',
    source: 'packages/animation/src/presets.ts:scroll.fadeIn',
  },

  /* ────────────────────────── 声明面原语 ────────────────────────── */
  {
    id: 'primitive/AnimDecl',
    kind: 'primitive',
    title: '动画声明（封闭集的全部字段）',
    description: '`kind`（动哪个属性，必填）+ `to`（终点，必填）+ 三者之一（`curve` / `spring` / `keyframes`）'
      + ' + `from` / `durationMs` / `delayMs` / `scroll` / `takeover`。',
    why: '★**不开放任意 JS 动画函数**（Morpheus §13 第 3 条）——能声明的是**封闭集**；'
      + '曲线求值与物理积分**只在 Rust 内核**（唯一实现，纪律 #22）。',
    when: '所有动画声明的入口（预设最终也编译成它）',
    example: `compileAnimations(
  [{ kind: 'opacity', from: 0, to: 1, durationMs: 200 },
   { kind: 'scale', from: 0.9, to: 1, spring: easing.snappy }],
  { nodeId: cardId },
)`,
    verify: 'tests/animation-presets.test.ts 编译段（绿侧 + 默认值归一 + 目标绑定）',
    status: 'implemented',
    source: 'packages/animation/src/types.ts:AnimDecl',
  },
  {
    id: 'primitive/AnimKind',
    kind: 'primitive',
    title: '动画属性封闭集（5 个，全部是合成属性）',
    description: '`translateX`(0) / `translateY`(1) / `scale`(2) / `rotate`(3) / `opacity`(4)——编号是**跨语言契约**。',
    why: '★**合成属性判定是分水岭**（§5-bis.1）：只有 transform/opacity 子集能走平台渲染线程零参与路径；'
      + '本引擎**只做绘制层变换** ⇒ 五个全是合成属性（`width/height/margin` 这类布局属性会被编译期拦）。',
    when: '任何声明都要从这里选（写错名字是类型级错误）',
    example: `import { AnimKind, ANIM_KIND_ID } from '@proteus-vue/animation'
ANIM_KIND_ID.translateY   // → 1（与内核 AnimKind 同号）`,
    verify: 'packages/layout-core-rust/src/anim.rs 的 `AnimKind::from_u8`；tests/animation-presets.test.ts「编号与内核一致（0..4）」',
    status: 'implemented',
    source: 'packages/animation/src/types.ts:AnimKind（内核 anim.rs:AnimKind）',
  },
  {
    id: 'primitive/Curve',
    kind: 'primitive',
    title: '曲线封闭集（5 个）',
    description: '`linear`(0) / `easeOut`(1) / `easeIn`(2) / `easeInOut`(3) / `springApprox`(4)——编号与内核 `CURVE_*` 同号。',
    why: '`springApprox` 是**阻尼振荡的查表近似**（与真弹簧不同）——需要物理语义时用 `spring` 字段而非这条曲线；'
      + '内核另有 `curve_bezier_approx` 供 Android `PathInterpolator`（弹簧**诚实返回 None**：非单调，无贝塞尔近似）。',
    when: '声明 `curve` 字段时（与 `spring` 二选一）',
    example: `{ kind: 'translateX', from: 0, to: 100, curve: 'easeOut', durationMs: 300 }`,
    verify: 'tests/animation-presets.test.ts「Curve 编号与内核一致（0..4）」；packages/layout-core-rust/src/anim.rs 的 `table_matches_exact_formula`',
    status: 'implemented',
    source: 'packages/animation/src/types.ts:Curve（内核 anim.rs:CURVE_*）',
  },
  {
    id: 'primitive/keyframes',
    kind: 'primitive',
    title: '序列编排（一条动画内多段）',
    description: '`keyframes: [{ to, durationMs, curve? }, …]`——段间起点 = 上段终点（首段起点 = `from`）。',
    why: '★内核对同 (节点,属性) 是**替换**语义 ⇒ 多段必须收敛在**一条**动画里；'
      + '★整段序列在平台零参与路径上仍是**一条** `CAKeyframeAnimation`（不增提交次数）。',
    when: '"先压再弹" / "抖动" / 任何同属性的多段编排',
    example: `{ kind: 'scale', from: 1, to: 1, keyframes: [
    { to: 0.9, durationMs: 80 }, { to: 1, durationMs: 200, curve: 'springApprox' }] }`,
    verify: 'packages/layout-core-rust/src/anim.rs 的 6 条序列单测；hosts/ios/check-anim-rt2.py 的 J2（边界精确 0.600）',
    status: 'implemented',
    source: 'packages/animation/src/types.ts:KeyframeSeg（内核 anim.rs:AnimMode::Keyframes）',
  },

  /* ────────────────────────── 约束与陷阱 ────────────────────────── */
  {
    id: 'constraint/duplicate-kind',
    kind: 'constraint',
    title: '同属性重复声明会被静默替换（编译期拦截）',
    description: '一个批次里同 `kind` 出现两次 ⇒ 后者替换前者（内核对同 (节点,属性) 是替换语义）。',
    why: '开发者以为"按下再弹回"，实际只有一条在跑——**静默**。⇒ 编译期拦住并指向正解（`keyframes`）。',
    when: '想写"序列"时（错法）',
    example: `// ✗ 编译期报错
compileAnimations([{ kind: 'scale', to: 0.9, durationMs: 100 },
                   { kind: 'scale', to: 1, durationMs: 100 }], { nodeId: 1 })
// ✓ 正解
compileAnimations([{ kind: 'scale', from: 1, to: 1, keyframes: [...] }], { nodeId: 1 })`,
    verify: 'tests/animation-presets.test.ts「同属性重复的提示现在指向 keyframes」；hosts/ios/check-anim-rt2.py 的 H5（被拦）',
    status: 'implemented',
    source: 'packages/animation/src/validate.ts:validateAnimations',
  },
  {
    id: 'constraint/drive-source-exclusive',
    kind: 'constraint',
    title: '滚动驱动 ≠ 平台零参与路径（驱动源互斥）',
    description: '带 `scroll` 窗口的批次**不得**走 `anim_commit_spec`（平台路径）。',
    why: '平台路径的语义是"提交后平台按**时间**自主插值"，而滚动动画的进度来自**外部位置**——'
      + '混用会把"跟手"变成"到点自动播放"（完全不是同一动效）。编译期预判 + 内核**双重拒绝**。',
    when: '用滚动联动时',
    example: `isPlatformEligible(compileAnimations(presets.scroll.parallax().decls, { nodeId: 1 }))  // → false`,
    verify: 'tests/animation-presets.test.ts「滚动批次不具备平台零参与资格」；hosts/ios/check-anim-rt2.py 的 I5',
    status: 'implemented',
    source: 'packages/animation/src/compile.ts:isPlatformEligible',
  },
  {
    id: 'constraint/takeover-semantics',
    kind: 'constraint',
    title: '接管语义（位置连续 + 速度移交），但三类动画例外',
    description: '默认 `takeover=true`：同 (节点,属性) 已有动画 ⇒ 新动画从**当前位置与速度**接管。',
    why: '★三类**特殊处理**（都是静默错位的预防）：'
      + '· **滚动驱动不接管**——`from/to` 是窗口映射两端，被覆盖会整体偏一截；'
      + '· **序列不重映射 from**——锚点是编排好的两端，重映射会让"下压→回弹"错形；'
      + '· **共享元素不接管**——起点是算出的几何，被覆盖就不落在源矩形。',
    when: '打断/接管场景（手势介入、快速切换）',
    example: `{ kind: 'translateX', to: 300, spring: easing.snappy, takeover: false }  // 硬重启`,
    verify: 'packages/layout-core-rust/src/anim.rs 的 `start_scroll_does_not_inherit_previous_value_into_range`'
      + ' / `keyframes_takeover_does_not_remap_anchors` / `shared_element_does_not_take_over_previous_animation`',
    status: 'implemented',
    source: 'packages/layout-core-rust/src/anim.rs:AnimEngine::start（三处例外）+ start_scroll/start_shared_element',
    decision: 'PROJECT_MEMORY ⑰⑱⑲（三次真机教训各一条）',
  },
  {
    id: 'constraint/platform-eligible',
    kind: 'constraint',
    title: '平台零参与路径的资格（合成属性 + 非滚动）',
    description: '`isPlatformEligible(batch)`：全为合成属性 **且** 不含滚动驱动。',
    why: '真值以**内核**为准（唯一实现）；本函数是"快速否决"，不是"第二份判定"——避免明知不可行还发一轮跨边界调用。',
    when: '想把动画交给平台渲染线程（iOS CAKeyframeAnimation / Android 容器或载体）',
    example: `if (isPlatformEligible(batch)) engine.animCommit(JSON.stringify({ anims: batch.anims }))`,
    verify: 'packages/layout-core-rust/src/anim.rs 的 `plan_animations`（真值）+ hosts/ios/check-anim-rt2.py 的 G1/G4',
    status: 'implemented',
    source: 'packages/animation/src/compile.ts:isPlatformEligible',
  },

  {
    id: 'constraint/escape-hatch',
    kind: 'constraint',
    title: '逃生口（§4.2）：能用，但必须登记且被统计',
    description: '`escapes.register({kind, detail, reason, behaviorRisk, site?})`——封闭集表达不了时走这条'
      + '（`custom-easing` / `external-driver` / `layout-property` / `cross-property-timeline` / `platform-mixing` / `other`）。',
    why: '★§4.2 的三条硬要求：① 显式（不静默降级）② **可统计**（与 UC0 漏点统计同构）'
      + '③ `degraded` **单列**（"最高危险度"）。'
      + '★为什么不直接拦住：拦死会逼开发者绕过框架（脱离统计视野，比登记更糟）。',
    when: '封闭集（5 曲线 / 5 属性 / 单段时间轴）确实表达不了，且补预设来不及',
    example: `escapes.register({
  kind: 'layout-property', detail: 'width 0→200 展开动画',
  reason: '需要真实占位变化（合成属性无法表达）',
  behaviorRisk: '触发重排，平台零参与路径失效，且与声明式动画可能打架',
  site: 'components/Accordion.vue',
})
console.log(escapes.format())   // degraded 单列 + 类别汇总 + 率对照 5% 目标`,
    verify: 'tests/animation-presets.test.ts 逃生口段 8 条（三要素必填 / 率分母含声明式 / 零副作用 / degraded 单列 / 类别恒输出 / 阈值提示 / 报错指向 / reset）',
    status: 'implemented',
    source: 'packages/animation/src/escape.ts:EscapeRegistry',
    decision: 'Morpheus §4.2（MA0 第三项）',
  },

  /* ────────────────────────── 诚实边界 ────────────────────────── */
  {
    id: 'boundary/cross-property-timeline',
    kind: 'boundary',
    title: '跨属性共享时间轴：未做',
    description: '当前每个属性各自成条、各按自身 `durMs`/进度求值；**没有**"多属性严格对齐的分段编排"。',
    why: '要"位移与缩放共享一条时间轴、各自多段"需引入显式时间轴模型（评估中）；当前用同名时长可近似。',
    when: '需要多属性精确同拍的复杂编排时（当前能力不足，需拆解或接受近似）',
    example: `// 近似做法：给同一 durationMs，让各属性各自跑完
[{ kind: 'translateX', to: 100, durationMs: 400 }, { kind: 'scale', to: 1.2, durationMs: 400 }]`,
    verify: '包 README「未做」一节（如实记录）',
    status: 'planned',
    source: 'packages/animation/README.md:未做（conformance 只保证"已声称的与实现一致"，不覆盖未做项）',
  },
  {
    id: 'boundary/slot-identity-binding',
    kind: 'boundary',
    title: 'Slot 身份绑定：经**节点回收解绑**实现（非直接绑 Slot）',
    description: '动画绑定到 **node id**；节点被回收到别的数据项时，回收路径自动 `stop_nodes`（含清值）解绑。',
    why: 'Morpheus §7.3 要求"绑 Slot 身份，不是 Node 身份"。本仓的等价保护是**回收即解绑**'
      + '（§7.3 的第二句"节点回收时动画状态必须一并解绑"）——真机 D 组判据守住。'
      + '★**如实边界**：`VirtualRow.key`（行身份）在宿主侧**存了但尚未消费**，且 `setupVirtual` '
      + '只在挂载时调用（**没有"行数据重键"路径**）⇒ "同一 node id 换了数据、动画应随之失效"这一形态当前不可达。',
    when: '长列表快速滚动 / 行复用（当前由回收解绑覆盖）',
    example: `// 宿主回收行时自动解绑（宿主内部）：
view.onRowDematerialized = { ids in animStopNodes({ nodeIds: ids }) }`,
    verify: 'hosts/ios/check-anim-rt2.py 的 D 组（回收已解绑 / 解绑后不再被 tick 改动）；'
      + 'packages/layout-core-rust/src/anim.rs 的 `stop_nodes_unbinds_animations_for_recycled_nodes`',
    status: 'limitation',
    source: 'packages/layout-core-rust/src/anim.rs:stop_nodes（含 reset_visuals）+ hosts/ios/ProteusHost/selfdraw-scene.swift:dematerializeRow',
    decision: 'Morpheus §7.3（MA0 第二项）',
  },
  {
    id: 'boundary/no-arbitrary-js-animation',
    kind: 'boundary',
    title: '不开放任意 JS 动画函数（设计红线）',
    description: '没有"让开发者写任意动画逻辑"的 API；能声明的只有封闭集。',
    why: 'Morpheus §13 第 3 条：那是"在第一王炸上开口子"（与"不开放任意原生调用"同理）。'
      + '需要算不出来的东西时，走**显式逃生口**（§4.2：可用但必须登记，且被统计为 degraded）。',
    when: '遇到"预设和字段都不够用"时（**不要**找后门，先看是否该补预设）',
    example: `// 显式逃生口（§4.2）：能用，但必须登记三要素并被计入 degraded
escapes.register({
  kind: 'custom-easing', detail: 'cubic-bezier(.1,.9,.2,1)',
  reason: '品牌曲线不在封闭集 5 条里',
  behaviorRisk: '不进内核曲线表 ⇒ 无法走平台零参与路径',
})`,
    verify: 'tests/animation-presets.test.ts 逃生口段（三要素必填 / 率统计 / degraded 单列 / 零副作用）',
    status: 'limitation',
    source: 'packages/animation/src/types.ts（封闭集定义）',
    decision: 'Morpheus §13 第 3 条',
  },
]

/** 按类别枚举（省略 kind 返回全部） */
export function listAnimRules(kind?: AnimRuleKind): AnimRule[] {
  return kind ? ANIM_RULES.filter((r) => r.kind === kind) : [...ANIM_RULES]
}

/** 按稳定 ID 查单条 */
export function getAnimRule(id: string): AnimRule | undefined {
  return ANIM_RULES.find((r) => r.id === id)
}

/** ★渲染单条规则的 AI 说明书（人可读文本，可直接喂给 AI / 写入文档）——与 compiler 侧同形 */
export function formatAnimRule(rule: AnimRule): string {
  const lines = [
    `## ${rule.id}（${rule.kind}）`,
    `**${rule.title}** \`[${rule.status}]\``,
    `- 是什么：${rule.description}`,
    `- 为什么：${rule.why}`,
    `- 何时用：${rule.when}`,
    `- 示例：\n\`\`\`ts\n${rule.example}\n\`\`\``,
    `- 如何验证：${rule.verify}`,
    `- 实现位置：${rule.source}`,
  ]
  if (rule.decision) lines.push(`- 相关决策：${rule.decision}`)
  return lines.join('\n')
}

/** ★渲染全量目录（按类别分组） */
export function formatAnimCatalog(): string {
  const kinds: AnimRuleKind[] = ['preset', 'primitive', 'constraint', 'boundary']
  const labels: Record<AnimRuleKind, string> = {
    preset: '预设（可直接用）',
    primitive: '声明面原语（字段/取值）',
    constraint: '约束与陷阱（会静默出错）',
    boundary: '诚实边界（能做/不能做）',
  }
  const blocks = kinds.map((kind) => {
    const rules = listAnimRules(kind)
    const items = rules.map((r) => `- \`${r.id}\` \`[${r.status}]\` ${r.title}`).join('\n')
    return `### ${labels[kind]}（${rules.length} 条）\n\n${items}`
  })
  return [`# Morpheus 动画声明项目录（共 ${ANIM_RULES.length} 条）`, '', ...blocks].join('\n')
}
