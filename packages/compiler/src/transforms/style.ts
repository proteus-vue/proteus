// src/compiler/transforms/style.ts
// style 阶段编译规则注册表 —— 每条规则一份 AI 说明书
// ★阶段三分派层示范：implemented 规则可携带 apply()——AI 覆盖 apply 即生效（底线循环 ①）
import { TAG_MAP, SEMANTIC_CLASS } from '../tags'
import type { TransformRule, RuleContext } from './types'

export const STYLE_RULES: TransformRule[] = [
  {
    id: 'style/px-to-rpx',
    phase: 'style',
    status: 'implemented',
    title: 'px → rpx（仅 MP 端编译期生效）',
    description: 'CSS 数值 px → rpx（rpxRatio 默认 2：48px → 96rpx）；Web 端永不转换（Vite 原生处理）',
    why: '小程序 rpx 是屏幕等比单位（750 设计稿），跨端 CSS 一致性的编译期吸收（决策 #9：MP 端 px→rpx，Web 端保持标准 CSS）',
    when: 'style 中出现数值 px（style.px2rpx=true）时',
    example: { before: 'padding: 48px;', after: 'padding: 96rpx;' },
    verify: 'tests/mp-transform.test.ts px→rpx 用例',
    source: 'src/compiler/style.ts → transformStyleToWxss（px2rpx 分支）',
    decision: '#9',
    // ★分派层：AI 覆盖此实现（如改换算公式/单位映射）→ 编译输出即时变化，无需改 style.ts
    apply: (ctx: RuleContext) => {
      const input = ctx.input as string
      const ratio = Number(ctx.options?.rpxRatio ?? 2)
      ctx.output = input.replace(/(\d+(?:\.\d+)?)px\b/g, (_m: string, n: string) => `${Number(n) * ratio}rpx`)
    },
  },
  {
    id: 'style/selector-tag',
    phase: 'style',
    status: 'implemented',
    title: '选择器 HTML 标签 → 小程序标签',
    description: '选择器中的标签名重写为小程序标签（.links a → .links view、div > p → view > .proteus-p）；属性选择器/类名/ID/长标识符不误伤',
    why: '模板已把 div/a/h1 等映射为 view/text，若样式选择器不重写则匹配不到元素（决策 #57 修复的 bug）；命中条件=标签位于选择器起始或组合器之后，避免 .a/#input/tag-a 误伤',
    when: 'style 选择器中含 TAG_MAP 中的标签名时',
    example: { before: '.links a { color: #1a7af8; }', after: '.links .proteus-a { color: #1a7af8; }' },
    verify: 'tests/mp-transform.test.ts 选择器重写用例；产物验证 .links a → .links view 对齐 wxml（决策 #57）',
    source: 'src/compiler/style.ts → rewriteTagSelectors + TAG_SELECTOR_RE',
    decision: '#57',
    mapping: { ...TAG_MAP },
  },
  {
    id: 'style/selector-semantic',
    phase: 'style',
    status: 'implemented',
    title: '语义标签选择器 → proteus-* 类选择器',
    description: 'h1-h6/p/a 选择器映射为基础类选择器（.card h3 → .card .proteus-h3、.links a → .links .proteus-a），而非标签',
    why: 'h3 与 p 都映射为 text，若都映射为标签，同特异性规则后写覆盖先写（决策 #61 修复：.card p 的 color 曾污染 h3）；模板侧已附加 proteus-* 类故精确匹配',
    when: '选择器中含 h1-h6/p/a 标签时',
    example: { before: '.card h3 { font-weight: 700; }', after: '.card .proteus-h3 { font-weight: 700; }' },
    verify: 'tests/mp-transform.test.ts 选择器重写用例（showcase.wxss 两条规则独立）',
    source: 'src/compiler/style.ts → rewriteTagSelectors（semantic 分支）+ src/compiler/tags.ts SEMANTIC_CLASS',
    decision: '#61',
    mapping: { ...SEMANTIC_CLASS },
  },
  {
    id: 'style/semantic-base-wxss',
    phase: 'style',
    status: 'implemented',
    title: '注入语义基础 WXSS（h1-h6/p/a 视觉还原）',
    description: '产物 WXSS 头部注入 .proteus-h1~h6/.proteus-p/.proteus-a 基础样式（对齐 HTML 标准附录 D：字号/字重/单边 em 段距/链接色），位于用户样式之前',
    why: 'Web 浏览器有 UA 默认样式，小程序 text/view 没有；注入基础类还原两端视觉一致（决策 #58）；margin 用单边 bottom + em 相对自身字号——Skyline 自研引擎不折叠 margin，单边 em 与 Web 折叠在主流程组合下视觉一致（决策 #59）',
    when: '每次 style 转换（作为产物前缀）',
    example: {
      before: '// 源码无样式时产物仍含',
      after: '.proteus-h1 { display: block; font-size: 64rpx; font-weight: 700; margin: 0 0 0.67em; }\n.proteus-p { display: block; margin: 0 0 1em; }\n.proteus-a { color: #1a7af8; text-decoration: underline; }',
    },
    verify: 'golden fixture showcase.wxss；产物验证 <text class="proteus-h1"> + .proteus-h1（决策 #58）',
    source: 'src/compiler/style.ts → BASE_SEMANTIC_WXSS',
    decision: '#58 / #59',
  },
  {
    id: 'style/skyline-unsupported',
    phase: 'style',
    status: 'implemented',
    title: 'Skyline 不支持属性编译期警告',
    description: 'float、position: fixed 出现时编译期警告（不阻断构建）',
    why: 'Skyline 自研渲染引擎不支持这些布局属性，编译期警告让开发者提前知道（反黑盒原则：警告可见、可统计）',
    when: 'WXSS 中出现 float: 或 position: fixed 时',
    example: { before: '.banner { position: fixed; }', after: '警告：WXSS 检测到 Skyline 不支持的属性：position: fixed（编译期警告）' },
    verify: 'tests/mp-transform.test.ts 警告用例',
    source: 'src/compiler/style.ts → transformStyleToWxss（unsupported 分支）',
  },
  {
    id: 'style/scoped-css',
    phase: 'style',
    status: 'implemented',
    title: 'scoped CSS：选择器追加作用域属性（v0.3）',
    description: '<style scoped> 存在时：:deep(X) 去包装 + 每条规则选择器末尾追加 [data-v-xxx]（@media/@keyframes 骨架保留）；模板侧元素已附加该属性（template/scope-attr）',
    why: '小程序无 scoped CSS 原生机制，编译期用属性选择器等价（v0.3，决策 #77）；MVP 单层简化：任一 style scoped 则全量作用域化、:deep 部分同样作用域化（组件边界场景后续完善）',
    when: 'SFC 含 <style scoped> 且规则未被禁用时',
    example: { before: '.card { color: red; }', after: '.card[data-v-abc123] { color: red; }' },
    verify: 'tests/mp-transform.test.ts scoped CSS 用例',
    source: 'packages/compiler/src/style.ts → transformStyleToWxss（scopeId 分支）',
    decision: '#77（v0.3 scoped CSS）',
  },
  {
    id: 'transition/animation-wxss',
    phase: 'style',
    status: 'implemented',
    title: '<transition> 进入动画 keyframes 注入',
    description: 'wxss 尾部注入 proteus-transition-* 进入动画（fade/slide-up/scale keyframes）——配合模板侧 transition 装饰 class',
    why: 'vue-compat-advance Batch 2（决策 #117）：<transition> 进入动画运行时等价（元素 wx:if 重建时 animation 自动播放）；离开动画 MP 无钩子',
    when: '任一页面使用 <transition>（默认注入；rules.disabled 可关）',
    example: { before: '<transition name="fade">…', after: 'wxss 含 .proteus-transition-fade + @keyframes proteus-fade-in' },
    verify: 'tests/vue-compat-advance.test.ts Transition 用例',
    source: 'packages/compiler/src/style.ts → TRANSITION_WXSS 注入',
    decision: '#117',
  },
]
