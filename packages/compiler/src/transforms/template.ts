// src/compiler/transforms/template.ts
// template 阶段编译规则注册表 —— 每条规则一份 AI 说明书
// 映射表与 src/compiler/tags.ts 同源引用（防漂移），registry 测试校验覆盖完整性
// ★阶段三分派层示范：implemented 规则可携带 apply()——AI 覆盖 apply 即生效（底线循环 ①）
import { TAG_MAP, EVENT_MAP, SEMANTIC_CLASS } from '../tags'
import type { TransformRule, RuleContext } from './types'

/** 表驱动规则工厂：从 TAG_MAP 取同源映射（改 tags.ts 自动生效，测试防遗漏） */
function tagRule(
  id: string,
  title: string,
  tags: string[],
  extra: Omit<TransformRule, 'id' | 'phase' | 'title' | 'mapping' | 'status'>,
): TransformRule {
  return {
    id,
    phase: 'template',
    status: 'implemented',
    title,
    mapping: Object.fromEntries(tags.map((t) => [t, TAG_MAP[t]]).filter(([, v]) => v !== undefined)),
    ...extra,
  }
}

/** 首字母大写（自包含副本——transforms 层不可反向 import template.ts，防循环依赖；template.ts 另有一份，收口待 M5 共享 util） */
function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/**
 * ★#505 内联事件表达式 → 包装方法（event/inline-expression 规则 apply 的实现，自 template.ts tryInlineHandler 迁入——逻辑单点化）。
 * 支持：count++ / count-- / ++count / --count / fn(1) / fn('a', 2) / x = !x / x = 字面量 / store.method(...)。
 * 返回 null = 不可校准形态 → 调用方走 cleanHandler 警告原样输出。
 */
function tryInlineExpressionToWrapper(exp: string): { name: string; code: string } | null {
  const t = exp.trim()
  // 自增/自减（对齐 ref 重写：this.data.x ± 1，决策 #36）
  let m = t.match(/^([\w$]+)\+\+$/) ?? t.match(/^\+\+([\w$]+)$/)
  if (m) {
    return {
      name: `proteusInlineInc${capitalize(m[1])}`,
      code: `this.setData({ ${m[1]}: this.data.${m[1]} + 1 })`,
    }
  }
  m = t.match(/^([\w$]+)--$/) ?? t.match(/^--([\w$]+)$/)
  if (m) {
    return {
      name: `proteusInlineDec${capitalize(m[1])}`,
      code: `this.setData({ ${m[1]}: this.data.${m[1]} - 1 })`,
    }
  }
  // 简单方法调用：fn(字面量参数)——无 . 链（store.xxx 等链式走警告）
  m = t.match(/^([\w$]+)\(([^()]*)\)$/)
  if (m && /^[\w$,'"\s]*$/.test(m[2])) {
    const key = m[2].replace(/\W/g, '') || 'NoArgs'
    return {
      name: `proteusInline${capitalize(m[1])}${key}`,
      code: `this.${m[1]}(${m[2]})`,
    }
  }
  // ★#500 赋值型内联事件：x = !x / x = 字面量 → setData 方法（旧产物把整句当方法名 → bindtap="x = !x" 点击无反应）
  //   裸标识符 RHS（可能是 wx:for 项变量）排除——方法作用域取不到，须走 data-* 捕获，另行登记（反黑盒警告兜底）
  m = t.match(/^([\w$]+)\s*=\s*(![\w$]+|true|false|null|undefined|-?\d+(?:\.\d+)?|'(?:[^']*)'|"(?:[^"]*)")(?:;?)$/)
  if (m) {
    const target = m[1]
    const rhs = m[2]
    const rhsJs = rhs.startsWith('!') ? `!this.data.${rhs.slice(1)}` : rhs
    const key = rhs.replace(/[^A-Za-z0-9]/g, '') || 'Val'
    return {
      name: `proteusInlineSet${capitalize(target)}${capitalize(key)}`,
      code: `this.data.${target} = ${rhsJs}; this.setData({ ${target}: this.data.${target} })`,
    }
  }
  // ★pinia-plan 12 P2：store 方法调用——store.toggle() / store.play({...}) / store.setVolume(store.volume - 0.1)
  //   store 是 useXxxStore() 编译的实例属性（this.store）；事件表达式中 store. 引用改写为 this.store.
  m = t.match(/^store\.([A-Za-z_$][\w$]*)\s*\(([^()]*)\)$/)
  if (m) {
    const method = m[1]
    const args = m[2].trim()
    // key 保留 +/- 语义（store.volume - 0.1 vs + 0.1 区分；否则同名方法冲突覆盖）
    const key = args.replace(/[^A-Za-z0-9_$+-]/g, '').replace(/-/g, 'Minus').replace(/\+/g, 'Plus') || 'NoArgs'
    return {
      name: `proteusStore${capitalize(method)}${key}`,
      code: `this.store.${method}(${args.replace(/\bstore\./g, 'this.store.')})`,
    }
  }
  return null
}

export const TEMPLATE_RULES: TransformRule[] = [
  // ============ 标签映射（TAG_MAP） ============
  tagRule('tag/div-to-view', 'div → view', ['div'], {
    description: '块级容器 div → view（小程序通用容器）',
    descriptionEn: 'block-level container div → view (the universal Mini Program container)',
    why: '小程序没有 div，view 是最通用容器标签；业务代码照写标准 HTML（§0.3 原则 1）',
    whyEn: 'Mini Programs have no div; view is the most general-purpose container tag, so business code keeps writing standard HTML (§0.3 Principle 1)',
    when: 'template 中出现 <div> 时',
    example: { before: '<div class="home">…</div>', after: '<view class="home">…</view>' },
    verify: 'tests/mp-transform.test.ts「标准标签映射」',
    source: 'src/compiler/template.ts → serializeElement（TAG_MAP 查表）',
    decision: '#57（样式标签选择器映射）',
  }),
  tagRule('tag/inline-to-text', 'span → text', ['span'], {
    description: '行内文本 span → text（小程序最小文本节点）',
    descriptionEn: 'inline text span → text (the minimal Mini Program text node)',
    why: '小程序无 span，text 是行内文本容器；text 默认不换行、可被 text 嵌套',
    whyEn: 'Mini Programs have no span; text is the inline text container: it does not wrap by default and text can be nested inside text',
    when: 'template 中出现 <span> 时',
    example: { before: '<span>hi</span>', after: '<text>hi</text>' },
    verify: 'tests/mp-transform.test.ts「标准标签映射」',
    source: 'src/compiler/template.ts → serializeElement（TAG_MAP 查表）',
  }),
  tagRule('tag/heading-to-text', 'h1–h6 → text', ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'], {
    description: '标题 h1-h6 → text，并自动附加 proteus-h1~h6 基础类（见 semantic/base-class）',
    descriptionEn: 'headings h1-h6 → text, automatically appending the proteus-h1~h6 base classes (see semantic/base-class)',
    why: '小程序无标题标签；语义（大字号/加粗）由基础类还原（#58），视觉对齐 Web UA 样式',
    whyEn: 'Mini Programs have no heading tags; the semantics (larger size/bold) are restored by the base classes (#58), aligning the visuals with Web UA styles',
    when: 'template 中出现 <h1>~<h6> 时',
    example: { before: '<h1>标题</h1>', after: '<text class="proteus-h1">标题</text>' },
    verify: 'tests/mp-transform.test.ts「语义标签自动附加基础类」',
    source: 'src/compiler/template.ts → serializeElement + src/compiler/style.ts BASE_SEMANTIC_WXSS',
    decision: '#58 / #59',
  }),
  tagRule('tag/para-to-text', 'p → text', ['p'], {
    description: '段落 p → text，并自动附加 proteus-p 基础类（段距对齐 Web）',
    descriptionEn: 'paragraph p → text, automatically appending the proteus-p base class (paragraph spacing aligned with Web)',
    why: 'p 映射为 text 后无 UA 默认段距，基础类注入 margin: 0 0 1em 还原 Web 折叠间距（#59）',
    whyEn: 'once p is mapped to text there is no UA default paragraph spacing, so the base class injects margin: 0 0 1em to restore the Web collapsing spacing (#59)',
    when: 'template 中出现 <p> 时',
    example: { before: '<p>段落</p>', after: '<text class="proteus-p">段落</text>' },
    verify: 'tests/mp-transform.test.ts「标准标签映射」',
    source: 'src/compiler/template.ts → serializeElement',
    decision: '#59（margin 单边 em）',
  }),
  tagRule('tag/link-to-view', 'a → view', ['a'], {
    description: '链接 a → view（带 href 时升级为导航链接，见 nav/navigate-link）',
    descriptionEn: 'link a → view (upgraded to a navigation link when it carries href; see nav/navigate-link)',
    why: '小程序无 a 标签；导航语义由 data-url + bindtap="proteusNavigateTo" 承担，样式语义由 proteus-a 基础类承担',
    whyEn: 'Mini Programs have no a tag; the navigation semantics are carried by data-url + bindtap="proteusNavigateTo", and the styling semantics by the proteus-a base class',
    when: 'template 中出现 <a> 时',
    example: { before: '<a href="/pages/user/index">用户</a>', after: '<view class="proteus-a" data-url="/pages/user/index" bindtap="proteusNavigateTo">用户</view>' },
    verify: 'tests/mp-transform.test.ts 导航链接用例',
    source: 'src/compiler/template.ts → serializeElement（isNavLink 分支）',
    decision: '#24 / #30（导航链接）/ #58（基础类）',
  }),
  tagRule('tag/image', 'img → image', ['img'], {
    description: '图片 img → image；:src 绑定经 directive/v-bind 转为 src="{{url}}"',
    descriptionEn: 'image img → image; the :src binding is converted to src="{{url}}" via directive/v-bind',
    why: '小程序图片标签是 image',
    whyEn: 'the Mini Program image tag is image',
    when: 'template 中出现 <img> 时',
    example: { before: '<img :src="url" />', after: '<image src="{{url}}" />' },
    verify: 'tests/mp-transform.test.ts「标准标签映射」',
    source: 'src/compiler/template.ts → serializeElement（TAG_MAP 查表）',
  }),
  tagRule('tag/passthrough', '同名标签保留', ['button', 'input', 'textarea', 'video', 'canvas', 'scroll-view', 'slot'], {
    description: 'button / input / textarea / video / canvas / scroll-view / slot 同名保留（小程序原生即有）',
    descriptionEn: 'button / input / textarea / video / canvas / scroll-view / slot keep the same name (native to Mini Programs)',
    titleEn: 'same-name tags are kept as-is',
    why: '这些标签在小程序原生存在，无需映射；input/textarea 同时是 v-model 的目标（directive/v-model）',
    whyEn: 'these tags already exist natively in Mini Programs, so no mapping is needed; input/textarea are also the v-model targets (directive/v-model)',
    when: 'template 中出现以上标签时',
    example: { before: '<button>go</button>', after: '<button>go</button>' },
    verify: 'tests/mp-transform.test.ts 事件/表单用例',
    source: 'src/compiler/template.ts → serializeElement（TAG_MAP 查表）',
  }),
  tagRule('tag/router-link', 'router-link → view', ['router-link'], {
    description: 'Vue Router 的 router-link → view + 导航链接（to 属性 → data-url）',
    descriptionEn: 'Vue Router router-link → view + navigation link (the to attribute → data-url)',
    why: '小程序无 Vue Router 组件；统一转导航链接（决策 #24：<a href> / <router-link> 同为导航入口）',
    whyEn: 'Mini Programs have no Vue Router component; they are uniformly converted to navigation links (decision #24: <a href> / <router-link> are both navigation entry points)',
    when: 'template 中出现 <router-link to="..."> 且无 @click 时',
    example: { before: '<router-link to="/pages/user/index">用户</router-link>', after: '<view data-url="/pages/user/index" bindtap="proteusNavigateTo">用户</view>' },
    verify: 'tests/mp-transform.test.ts 导航链接用例',
    source: 'src/compiler/template.ts → serializeElement（isNavLink 分支）',
    decision: '#24',
  }),
  tagRule('tag/rich-text', 'v-html 容器 → rich-text', [], {
    description: '带 v-html 的容器元素 → rich-text（nodes="{{expr}}"）',
    descriptionEn: 'container elements with v-html → rich-text (nodes="{{expr}}")',
    titleEn: 'v-html container → rich-text',
    why: '小程序无 innerHTML，富文本用 rich-text 组件渲染 HTML 节点',
    whyEn: 'Mini Programs have no innerHTML; rich text is rendered as HTML nodes by the rich-text component',
    when: '元素上有 v-html 指令时（v-html 覆盖标签映射）',
    example: { before: '<div v-html="html"></div>', after: '<rich-text nodes="{{html}}" />' },
    verify: 'tests/mp-transform.test.ts v-html 用例',
    source: 'src/compiler/template.ts → serializeElement（hasVHtml 分支）',
  }),
  tagRule('tag/unknown-kebab', '未注册标签 kebab-case 原样输出', [], {
    description: 'TAG_MAP 未覆盖的标签按 kebab-case 原样输出（组件 / 自定义元素逃生舱）',
    descriptionEn: 'tags not covered by TAG_MAP are emitted as-is in kebab-case (the escape hatch for components / custom elements)',
    titleEn: 'unregistered tags are emitted as-is in kebab-case',
    why: '白名单映射 + 未知标签保守保留：标准 Vue 组件体系（原则 9）与原生组件逃生舱（痛点 #11 对策）依赖此通道',
    whyEn: 'whitelist mapping + conservative retention of unknown tags: the standard Vue component system (Principle 9) and the native-component escape hatch (the pain point #11 countermeasure) rely on this channel',
    when: '标签不在 TAG_MAP 且非 router-link 时',
    example: { before: '<custom-comp foo="bar" />', after: '<custom-comp foo="bar" />' },
    verify: 'tests/mp-transform.test.ts 未注册标签用例',
    source: 'src/compiler/template.ts → serializeElement（TAG_MAP[node.tag] ?? kebabCase）',
  }),
  tagRule('tag/unknown-p-star', 'p-* 标签须组件库语义登记——未登记警告', [], {
    description: 'p- 前缀是框架保留（src/components 语义组件 + p-grid 等语义编译标签 = TAG_SEMANTIC_MAP 登记集）；未登记的 p-* = 拼写错误或未入库组件 → 编译期显式警告（产物仍按未注册自定义组件输出：MP 不渲染、无语义链接）',
    descriptionEn: 'the p- prefix is framework-reserved (src/components semantic components + semantic-compiled tags such as p-grid = the TAG_SEMANTIC_MAP registered set); an unregistered p-* means a typo or a component not in the library, so a compile-time warning is raised (the artifact is still emitted as an unregistered custom component: it does not render on MP and has no semantic link)',
    titleEn: 'p-* tags must be registered in the component library — unknown p-* warns',
    why: '反黑盒（★#505 M3）：conformance 世界已把「p-* 存在但空白」（TAG_SEMANTIC_MAP 未登记）收紧为 render.semanticLink 显式失败，本规则把同源收紧带到主编译产物侧——旧行为静默输出，开发者在 MP 端看到整块不渲染无从归因',
    whyEn: 'anti-black-box (★#505 M3): the conformance world already tightens “p-* present but blank” (not in TAG_SEMANTIC_MAP) into an explicit render.semanticLink failure; this rule brings the same tightening to the main compiled artifact side — the old behavior emitted silently and developers could not attribute a whole block not rendering on MP',
    when: '模板出现 p- 前缀但不在 TAG_SEMANTIC_MAP 的标签（config tags 映射显式覆盖的 p-* 除外）',
    example: { before: '<p-buttn @click="go">x</p-buttn>', after: '编译警告（未登记 p-*——拼写错误或未入库组件）；产物仍按未注册自定义组件输出' },
    verify: 'tests/compiler-ir-m3.test.ts「未知 p-* 主编译警告」',
    source: 'src/compiler/template.ts → serializeElement（未知 p-* 检测）',
  }),

  // ============ 语义基础类 ============
  {
    id: 'semantic/base-class',
    phase: 'template',
    status: 'implemented',
    title: '语义标签自动附加 proteus-* 基础类',
    titleEn: 'semantic tags automatically get proteus-* base classes appended',
    description: 'h1-h6/p/a 映射时自动附加 proteus-h1~h6 / proteus-p / proteus-a 类（与用户 class 合并、与 :class 插值拼接）',
    descriptionEn: 'when h1-h6/p/a are mapped, the proteus-h1~h6 / proteus-p / proteus-a classes are appended automatically (merged with the user class and concatenated with :class interpolation)',
    why: 'Web 端 h1-h6/p/a 有浏览器 UA 默认样式，小程序 text/view 没有；基础类 + 基础 WXSS（style/semantic-base-wxss）还原两端视觉一致（#58）',
    whyEn: 'on the Web, h1-h6/p/a carry browser UA default styles, while Mini Program text/view have none; the base classes + base WXSS (style/semantic-base-wxss) restore visual parity across both ends (#58)',
    when: '语义标签且非 v-html 容器时',
    example: {
      before: '<h1 class="title">a</h1>',
      after: '<text class="proteus-h1 title">a</text>',
    },
    verify: 'tests/mp-transform.test.ts「语义标签自动附加基础类」；golden fixture showcase.wxml',
    source: 'src/compiler/template.ts → serializeElement（baseClass 分支）+ src/compiler/tags.ts SEMANTIC_CLASS',
    decision: '#58 / #59',
    mapping: { ...SEMANTIC_CLASS },
  },

  // ============ 事件映射（EVENT_MAP） ============
  {
    id: 'event/click-to-tap',
    phase: 'template',
    status: 'implemented',
    title: '@click → bindtap（EVENT_MAP 全表）',
    titleEn: '@click → bindtap (the full EVENT_MAP table)',
    description: '标准事件 → 小程序事件：click→tap、input/change/submit/focus/blur/touch*/longpress/confirm 同名保留',
    descriptionEn: 'standard events → Mini Program events: click→tap, while input/change/submit/focus/blur/touch*/longpress/confirm keep the same name',
    why: '小程序无 click，点击事件是 tap；其余事件命名一致（EVENT_MAP 集中在 tags.ts 与样式侧共用）',
    whyEn: 'Mini Programs have no click; the tap event is the click counterpart; the other events keep the same names (EVENT_MAP is centralized in tags.ts and shared with the style side)',
    when: '元素上有 @事件 指令时',
    example: { before: '<button @click="handleTap">go</button>', after: '<button bindtap="handleTap">go</button>' },
    verify: 'tests/mp-transform.test.ts「事件映射」',
    source: 'src/compiler/template.ts → serializeElement（on 分支）+ src/compiler/tags.ts EVENT_MAP',
    mapping: { ...EVENT_MAP },
  },
  {
    id: 'event/modifier-catch',
    phase: 'template',
    title: '.stop / .prevent 修饰符 → catch 前缀',
    titleEn: '.stop / .prevent modifiers → the catch prefix',
    description: '@click.stop / @click.prevent → catchtap（阻止冒泡）；其余修饰符忽略',
    descriptionEn: '@click.stop / @click.prevent → catchtap (prevents bubbling); the other modifiers are ignored',
    why: '小程序无事件修饰符语法，catch* 事件天然阻止冒泡，等价 .stop 语义；.prevent 无对等机制，映射为 catch 兜底',
    whyEn: 'Mini Programs have no event-modifier syntax; catch* events natively stop propagation, which is equivalent to .stop; .prevent has no counterpart, so it is mapped to catch as a fallback',
    when: '事件指令带 stop 或 prevent 修饰符时',
    example: { before: '<a @click.stop="stopFn">s</a>', after: '<a catchtap="stopFn">s</a>' },
    verify: 'tests/mp-transform.test.ts「事件映射」',
    source: 'src/compiler/template.ts → serializeElement（on 分支 isCatch）',
    status: 'implemented',
  },
  {
    id: 'event/modifier-self-once',
    phase: 'template',
    status: 'implemented',
    title: '.self / .once 修饰符 → 包装方法（v0.3 尾）',
    titleEn: '.self / .once modifiers → wrapper methods (late v0.3)',
    description: '@click.self="fn" → bindtap="proteusSelfFn"（e.target === e.currentTarget 才触发）；@click.once="fn" → bindtap="proteusOnceFn"（data 标记首次触发后不再触发）；仅对简单方法名 handler 包装',
    descriptionEn: '@click.self="fn" → bindtap="proteusSelfFn" (fires only when e.target === e.currentTarget); @click.once="fn" → bindtap="proteusOnceFn" (a data flag prevents firing after the first trigger); only handlers with a simple method name are wrapped',
    why: '小程序无 .self/.once 原生语义，编译期生成包装方法（script 侧）：self 用事件源判断、once 用 data 标记；键位修饰符（@keyup.enter）无对等键盘事件 → 编译期警告（input 请用 @confirm）',
    whyEn: 'Mini Programs have no native .self/.once semantics, so wrapper methods are generated at compile time (on the script side): self uses a source-event check and once uses a data flag; key modifiers (@keyup.enter) have no equivalent keyboard event → a compile-time warning (use @confirm on input)',
    when: '事件指令带 self 或 once 修饰符（且 handler 是简单方法名）时',
    example: {
      before: '@click.self="handleTap" / @click.once="handleTap"',
      after: 'bindtap="proteusSelfHandleTap" / bindtap="proteusOnceHandleTap"（包装方法生成于 Page methods）',
    },
    verify: 'tests/mp-transform.test.ts 事件修饰符用例',
    source: 'packages/compiler/src/transforms/template.ts → resolveSelfOnceWrap（★#505 命名+判定迁入规则）+ template.ts → serializeElement（on 分支组装）',
    decision: '#88（v0.3 尾指令补全）',
    // ★#505 校准族第三批：.self/.once 包装判定与命名迁入规则（第六条真实 apply）——
    //   input { handler, isSelf, isOnce } → output { kind, target, wrap } | null：
    //   简单方法名 + self/once → wrap = proteusSelf/Once<Cap>（script 侧生成方法：self 事件源判断 / once data 标记）；
    //   复杂表达式 → null（调用方原样输出 + cleanHandler 既有警告）。禁用规则 → 不包装（.self/.once 语义丢失警告）。
    apply: (ctx: RuleContext) => {
      const input = (ctx.input ?? {}) as { handler?: string; isSelf?: boolean; isOnce?: boolean }
      const handler = input.handler ?? ''
      const isSelf = input.isSelf ?? false
      const isOnce = input.isOnce ?? false
      if ((isSelf || isOnce) && /^[\w$]+$/.test(handler)) {
        ctx.output = {
          kind: isSelf ? 'self' : 'once',
          target: handler,
          wrap: `${isSelf ? 'proteusSelf' : 'proteusOnce'}${capitalize(handler)}`,
        }
      } else {
        ctx.output = null
      }
    },
  },
  {
    id: 'event/handler-simple-ref',
    phase: 'template',
    title: '事件处理器仅支持简单方法引用',
    titleEn: 'event handlers support only simple method references',
    description: '仅支持 handleTap / handleTap($event)；复杂表达式编译期警告并原样输出',
    descriptionEn: 'only handleTap / handleTap($event) are supported; complex expressions raise a compile-time warning and are emitted as-is',
    why: 'MVP 收缩（原则 10）：小程序事件处理器必须是 Page methods 中的方法名，内联表达式无法静态编译',
    whyEn: 'MVP contraction (Principle 10): Mini Program event handlers must be method names in Page methods; inline expressions cannot be statically compiled',
    when: '事件指令的表达式不是简单方法引用时',
    example: {
      before: '@click="count > 0 ? go() : back()"',
      after: '编译期警告：不是简单方法引用，原样输出（产物需人工处理）',
    },
    verify: 'tests/mp-transform.test.ts 事件警告用例',
    source: 'src/compiler/template.ts → cleanHandler',
    status: 'limitation',
  },

  // ============ 指令映射 ============
  {
    id: 'directive/v-if',
    phase: 'template',
    status: 'implemented',
    title: 'v-if → wx:if',
    description: 'v-if="show" → wx:if="{{show}}"',
    descriptionEn: 'v-if="show" → wx:if="{{show}}"',
    why: '小程序条件渲染指令是 wx:if',
    whyEn: 'the Mini Program conditional-rendering directive is wx:if',
    when: '元素上有 v-if 指令时',
    example: { before: '<p v-if="show">a</p>', after: '<p wx:if="{{show}}">a</p>' },
    verify: 'tests/mp-transform.test.ts「v-if / v-else」',
    source: 'src/compiler/template.ts → serializeElement（if 分支）',
  },
  {
    id: 'directive/v-else-if',
    phase: 'template',
    status: 'implemented',
    title: 'v-else-if → wx:elif',
    description: 'v-else-if="cond" → wx:elif="{{cond}}"',
    descriptionEn: 'v-else-if="cond" → wx:elif="{{cond}}"',
    why: '小程序条件链指令是 wx:elif',
    whyEn: 'the Mini Program conditional-chain directive is wx:elif',
    when: '元素上有 v-else-if 指令时',
    example: { before: '<p v-else-if="b">c</p>', after: '<p wx:elif="{{b}}">c</p>' },
    verify: 'tests/mp-transform.test.ts「v-if / v-else」',
    source: 'src/compiler/template.ts → serializeElement（else-if 分支）',
  },
  {
    id: 'directive/v-else',
    phase: 'template',
    status: 'implemented',
    title: 'v-else → wx:else',
    description: 'v-else → wx:else（无值）',
    descriptionEn: 'v-else → wx:else (takes no value)',
    why: '小程序条件链指令是 wx:else',
    whyEn: 'the Mini Program conditional-chain directive is wx:else',
    when: '元素上有 v-else 指令时',
    example: { before: '<p v-else>b</p>', after: '<p wx:else>b</p>' },
    verify: 'tests/mp-transform.test.ts「v-if / v-else」',
    source: 'src/compiler/template.ts → serializeElement（else 分支）',
  },
  {
    id: 'directive/v-for',
    phase: 'template',
    status: 'implemented',
    title: 'v-for → wx:for / wx:for-item / wx:for-index',
    description: 'v-for="(item, idx) in list" → wx:for="{{list}}" + wx:for-item + wx:for-index（支持 in/of）',
    descriptionEn: 'v-for="(item, idx) in list" → wx:for="{{list}}" + wx:for-item + wx:for-index (supports in/of)',
    why: '小程序循环指令是 wx:for，且需显式声明 item/index 变量名',
    whyEn: 'the Mini Program loop directive is wx:for, and the item/index variable names must be declared explicitly',
    when: '元素上有 v-for 指令时',
    example: {
      before: '<div v-for="(item, idx) in list" :key="idx">{{ item }}</div>',
      after: '<view wx:for="{{list}}" wx:for-item="item" wx:for-index="idx" wx:key="idx">{{ item }}</view>',
    },
    verify: 'tests/mp-transform.test.ts「v-for」',
    source: 'src/compiler/template.ts → serializeElement（for 分支）+ parseForExpr',
  },
  {
    id: 'directive/v-bind',
    phase: 'template',
    status: 'implemented',
    title: '普通 :prop 绑定 → prop="{{expr}}"',
    titleEn: 'plain :prop binding → prop="{{expr}}"',
    description: ':src / :href / 任意属性绑定 → 属性="{{表达式}}"，静态属性原样保留',
    descriptionEn: ':src / :href / any attribute binding → attribute="{{expression}}"; static attributes are kept as-is',
    why: '小程序属性绑定语法是 {{expr}}；静态属性（如 placeholder="x"）直接透传',
    whyEn: 'Mini Program attribute-binding syntax is {{expr}}; static attributes (e.g. placeholder="x") are passed through directly',
    when: '元素上有 v-bind 且 arg 不是 class/style/key 时',
    example: { before: '<img :src="url" />', after: '<image src="{{url}}" />' },
    verify: 'tests/mp-transform.test.ts「标准标签映射」',
    source: 'src/compiler/template.ts → serializeElement（bind 分支）',
  },
  {
    id: 'directive/v-bind-class',
    phase: 'template',
    status: 'implemented',
    title: ':class 绑定（对象/数组语法 → 三元拼接）',
    titleEn: ':class binding (object/array syntax → ternary concatenation)',
    description: ':class="{ active: on }" → {{(on?\'active \':\'\')}}；数组语法（v0.3）→ 逐项拼接（字符串/对象/简单变量/三元）',
    descriptionEn: ':class="{ active: on }" → {{(on?\'active \':\'\')}}; the array syntax (v0.3) → item-by-item concatenation (string/object/simple variable/ternary)',
    why: '小程序无 class 对象/数组语法，编译期为三元表达式拼接；数组语法 v0.3 补齐（splitTopLevel 顶层逗号分割，跳过字符串/括号内逗号）',
    whyEn: 'Mini Programs have no object/array class syntax, so the compiler concatenates ternary expressions; the array syntax was completed in v0.3 (splitTopLevel splits at top-level commas, skipping commas inside strings/parentheses)',
    when: '元素上有 :class 绑定且带语义基础类或对象/数组表达式时',
    example: {
      before: '<p :class="[activeClass, { active: on }]">b</p>',
      after: '<text class="proteus-p {{((activeClass)?(activeClass)+\' \':\'\')+(on?\'active \':\'\')}}">b</text>',
    },
    verify: 'tests/mp-transform.test.ts「语义标签自动附加基础类」+ :class 数组用例',
    source: 'packages/compiler/src/template.ts → formatClassBinding + splitTopLevel',
    decision: '#61 / #77（v0.3 数组语法）',
  },
  {
    id: 'directive/v-bind-style',
    phase: 'template',
    status: 'implemented',
    title: ':style 绑定（对象语法 → prop:{{expr}} 拼接；动态标识符派生对象自动序列化字符串 ★#500）',
    titleEn: ':style binding (object syntax → prop:{{expr}} concatenation; dynamic identifier-derived objects auto-serialized to strings ★#500)',
    description: ':style="{ color: c }" → style="color:{{c}}"；属性名 camelCase → kebab-case；★#500 动态标识符绑定（:style="boxStyle"，boxStyle 为 computed）→ 模板侧收集，script 侧同名 computed 派生值自动包 __proteusStyleString() 序列化为字符串（MP 双渲染器 style 属性仅收字符串——对象绑定静默失效，WebView 亦然，#496b 记录修正）',
    descriptionEn: ':style="{ color: c }" → style="color:{{c}}"; camelCase property names → kebab-case; ★#500 dynamic identifier bindings (:style="boxStyle" where boxStyle is a computed) are collected on the template side, and on the script side the same-named computed\'s derived value is automatically wrapped with __proteusStyleString() and serialized to a string (the MP style attribute accepts strings only on both renderers — object bindings fail silently, WebView included; corrects the #496b record)',
    why: '小程序 style 属性支持内联插值，逐属性编译可静态验证；★#500 用户 WebView 实测修正：MP 产物 style 绑定对象在双渲染器均静默失效（p-split gap/p-aspect 比例全死）——动态派生对象必须在数据侧序列化为字符串，编译器自动注入避免每个组件手写 styleToString',
    whyEn: 'the Mini Program style attribute supports inline interpolation, so compiling per-property can be statically validated; ★#500 user correction from WebView testing: object style bindings in MP output fail silently on BOTH renderers (p-split gap / p-aspect ratios all dead) — dynamically derived objects must be serialized to strings at the data level, and the compiler injects this automatically instead of hand-writing styleToString in every component',
    when: '元素上有 :style 绑定（对象语法编译期拼接；动态标识符 → script 侧派生值自动序列化）',
    example: { before: ':style="{ backgroundColor: bg }" / :style="boxStyle"（computed 返回对象）', after: 'style="background-color:{{bg}}" / 派生值 setData 为 __proteusStyleString(...) 字符串' },
    verify: 'tests/mp-transform.test.ts :style 用例',
    source: 'src/compiler/template.ts → formatStyleBinding + styleBindings 收集；packages/compiler/src/script.ts → transformScriptToPage（__proteusStyleString 注入）',
    // ★#505 M2 试点：描述层 → 执行层（第三条真实 apply）——派生序列化决策经分派层执行，
    //   规则判定「动态裸标识符 → script 侧同名 computed 派生值需序列化字符串」（MP style 值域 string-only）。
    //   调用点：template.ts style 分支（executeRule）；输出 { target, derived } 供调用方收集进 styleBindings。
    //   禁用本规则 → 不收集 → script 不注入 __proteusStyleString → 对象直进 setData 静默失效（删规则即红反向验证）。
    apply: (ctx: RuleContext) => {
      const input = (ctx.input ?? {}) as { exp?: string }
      const t = (input.exp ?? '').trim()
      ctx.output = /^[A-Za-z_$][\w$]*$/.test(t) ? { target: t, derived: true } : { derived: false }
    },
  },
  {
    id: 'directive/v-bind-key',
    phase: 'template',
    status: 'implemented',
    title: ':key → wx:key（标识符/属性路径/*this——★#505 对齐官方 StaticStr 语义）',
    titleEn: ':key → wx:key (identifier / property path / *this — ★#505 aligned with the official StaticStr semantics)',
    description: ':key="idx" → wx:key="idx"、:key="item.id" → wx:key="item.id"、:key="item"（基础值列表）→ wx:key="*this"；含 {{}}/运算/括号的表达式编译期警告并忽略',
    descriptionEn: ':key="idx" → wx:key="idx", :key="item.id" → wx:key="item.id", and :key="item" (a list of primitives) → wx:key="*this"; expressions containing {{}}/operators/parentheses trigger a compile-time warning and are ignored',
    why: '官方 glass-easel parse 中 wx:key 是 StaticStr 形态（接受属性路径/*this，仅 {{}} 触发 DataBindingNotAllowed）——★#505 对齐实证：旧实现仅接受简单标识符，:key="t.id" 整个被丢（比产物无效更糟的编译期丢代码）',
    whyEn: 'in the official glass-easel parser wx:key is a StaticStr form (it accepts property paths /*this; only {{}} triggers DataBindingNotAllowed) — ★#505 alignment evidence: the old implementation accepted only simple identifiers, so :key="t.id" was dropped entirely (losing code at compile time is worse than an invalid artifact)',
    when: '元素上有 :key 绑定（通常在 v-for 内）时',
    example: { before: ':key="idx" / :key="item.id"', after: 'wx:key="idx" / wx:key="item.id"' },
    verify: 'tests/mp-transform.test.ts「v-for」+ tests/compiler-ir-key.test.ts',
    source: 'src/compiler/template.ts → serializeElement（key 分支）',
    decision: '#505 G1（官方 StaticStr 对齐）',
  },
  {
    id: 'directive/v-model',
    phase: 'template',
    status: 'implemented',
    title: 'v-model → 双向绑定编译（input 走 value+bindinput；★#500/#G12 自定义组件走 prop + 单段事件 update-arg）',
    titleEn: 'v-model → two-way binding compilation (input → value+bindinput; ★#500/G12 custom components → prop + single-segment event update-arg)',
    description: 'input/textarea 的 v-model="x" → value="{{x}}" + bindinput="proteusOnXInput"；★#500 自定义组件 v-model[:arg]="x"（p-modal v-model:visible）→ {{arg}}="{{x}}" + bind:update-arg="proteusUpdateArgModel"（页面 setData 回写 e.detail）——旧产物无脑 bindinput → 组件双向绑定永不生效；★G12 候选 B（2026-09-07 Skyline 真机实证：双冒号 bind:update:* 被 glass-easel/微信编译链丢弃——p-modal 关不掉/p-switch/p-input 不回传）→ 事件名单段化 update:{arg} → update-{arg}（arg 语义在 IR 保留 vModelComponentHandlers.arg）',
    descriptionEn: 'v-model="x" on input/textarea → value="{{x}}" + bindinput="proteusOnXInput"; ★#500 v-model[:arg]="x" on a custom component (p-modal v-model:visible) → {{arg}}="{{x}}" + bind:update-arg="proteusUpdateArgModel" (the page writes back e.detail via setData) — the old output blindly emitted bindinput, so component two-way binding never worked; ★G12 candidate B (2026-09-07 Skyline on-device evidence: double-colon bind:update:* is dropped by the glass-easel/WeChat compile chain — p-modal cannot close, p-switch/p-input do not write back) → event names are normalized to single segments update:{arg} → update-{arg} (arg semantics stay in the IR as vModelComponentHandlers.arg)',
    why: '小程序无 v-model 语法，需双向绑定的两半：value/prop 绑定 + 事件回写（script/vmodel-handler / vModelComponentHandlers）；★#500 Vue 组件 v-model 是核心语义（prop + update:arg 事件契约），必须按规范编译；★#505 M4：契约完整入 CompileIR（arg/propName 随声明携带，IR 快照单点自足可重建产物——不再旁路手抄丢字段）',
    whyEn: 'Mini Programs have no v-model syntax; the two halves of two-way binding are needed: a value/prop binding + an event write-back (script/vmodel-handler / vModelComponentHandlers); ★#500 v-model on Vue components is core semantics (prop + update:arg event contract) and must be compiled per spec; ★#505 M4: the full contract enters CompileIR (arg/propName travel with the declaration, so the IR snapshot is self-sufficient to rebuild the artifact — no more lost fields from hand-copied side channels)',
    when: 'input/textarea 或自定义组件标签上有 v-model[:arg] 指令时',
    example: { before: '<input v-model="name" /> / <p-modal v-model:visible="show" />', after: '<input value="{{name}}" bindinput="proteusOnNameInput" /> / <p-modal visible="{{show}}" bind:update-visible="proteusUpdateVisibleModel" />' },
    verify: 'tests/mp-transform.test.ts v-model 用例',
    source: 'src/compiler/transforms/template.ts → resolveVModelContract（★#505 形态判定+命名迁入规则）+ template.ts → serializeElement（model 分支组装）',
    decision: '#29 / #500',
    // ★#505 校准族第二批：v-model 形态判定与契约命名整体迁入规则（第五条真实 apply）——
    //   input { model, arg, isInputLike, isNativeTag }（布尔自 template.ts 上下文传入，本层不反向依赖）
    //   → output { kind, model, propName?, updateHandler?, inputHandler? }：
    //   组件形态（非 input-like 且非原生标签）= prop + update:arg 事件契约；原生/input = value + bindinput。
    //   禁用规则 → v-model 忽略（既有 disabled 分支：警告 + 不输出绑定）。
    apply: (ctx: RuleContext) => {
      const input = (ctx.input ?? {}) as { model?: string; arg?: string; isInputLike?: boolean; isNativeTag?: boolean }
      const model = input.model ?? ''
      const arg = input.arg ?? ''
      const isComponent = !input.isInputLike && !input.isNativeTag
      if (isComponent) {
        const propName = arg || 'modelValue'
        // ★2026-09-07 多组件 v-model 撞名修复：handler 名以 **model**（回写目标）标识——
        //   旧命名 proteusUpdate{PropName}Model 只含 propName（arg/modelValue），同页多个无 arg
        //   v-model（p-switch/p-drawer/p-popover/p-action-sheet 全 modelValue）或同 arg 多 model
        //   会撞名 → script 去重后只剩第一个 handler → 其余组件回写丢失（真机：drawer/as/popover 关闭无效）。
        //   新命名与 input 侧 proteusOn{Model}Input 对仗：proteusUpdate{Model}Model（arg 语义在 IR 保留）
        ctx.output = {
          kind: 'component',
          model,
          propName,
          updateHandler: `proteusUpdate${capitalize(model)}Model`,
        }
      } else {
        ctx.output = {
          kind: 'input',
          model,
          inputHandler: `proteusOn${capitalize(model)}Input`,
        }
      }
    },
  },
  {
    id: 'directive/v-html',
    phase: 'template',
    status: 'implemented',
    title: 'v-html → rich-text nodes',
    description: 'v-html="html" → rich-text nodes="{{html}}"（容器标签映射为 rich-text）',
    descriptionEn: 'v-html="html" → rich-text nodes="{{html}}" (the container tag is mapped to rich-text)',
    why: '小程序无 innerHTML，富文本用 rich-text 组件（原生能力兜底，痛点 #11 对策）',
    whyEn: 'Mini Programs have no innerHTML; rich text uses the rich-text component (native capability as the fallback, the pain point #11 countermeasure)',
    when: '元素上有 v-html 指令时',
    example: { before: '<div v-html="html"></div>', after: '<rich-text nodes="{{html}}" />' },
    verify: 'tests/mp-transform.test.ts v-html 用例',
    source: 'src/compiler/template.ts → serializeElement（hasVHtml / html 分支）',
  },
  {
    id: 'directive/v-show',
    phase: 'template',
    status: 'implemented',
    title: 'v-show → hidden 属性',
    titleEn: 'v-show → the hidden attribute',
    description: 'v-show="show" → hidden="{{!show}}"（小程序 hidden 属性 = display:none，元素始终渲染）',
    descriptionEn: 'v-show="show" → hidden="{{!show}}" (the Mini Program hidden attribute equals display:none, and the element is always rendered)',
    why: '小程序无 v-show 指令，hidden 属性语义对齐（display:none 切换）；元素保留在文档流中，与 v-if 的移除不同（v0.3 补齐，原为 MVP 限制）',
    whyEn: 'Mini Programs have no v-show directive; the hidden attribute is its semantic equivalent (toggling display:none); the element stays in the document flow, unlike v-if which removes it (completed in v0.3; previously an MVP limitation)',
    when: '元素上有 v-show 指令时',
    example: { before: '<p v-show="show">a</p>', after: '<p hidden="{{!show}}">a</p>' },
    verify: 'tests/mp-transform.test.ts v-show 用例',
    source: 'packages/compiler/src/template.ts → serializeElement（show 分支）',
    decision: '#76（v0.3 指令补全）',
  },
  {
    id: 'directive/v-text',
    phase: 'template',
    status: 'implemented',
    title: 'v-text → 元素内容覆盖为文本插值',
    titleEn: 'v-text → element content overridden to text interpolation',
    description: 'v-text="expr" → <tag>{{ expr }}</tag>（v-text 覆盖子节点，输出文本插值——Vue 语义）；此前被当自定义指令剥离+警告（文本内容丢失——真 bug 非语义限制）',
    descriptionEn: 'v-text="expr" → <tag>{{ expr }}</tag> (v-text overrides child nodes, outputting text interpolation — Vue semantics); previously stripped as a custom directive with a warning (text content lost — a real bug, not a semantic limitation)',
    why: '小程序无 v-text 指令，但 v-text 语义 =元素内容为文本值——映射为内容插值 {{ expr }}（元素保留 + 内容覆盖）；v-html→rich-text 同族',
    whyEn: 'Mini Programs have no v-text directive, but v-text semantics = element content is the text value — mapped to content interpolation {{ expr }} (element kept + content overridden); same family as v-html→rich-text',
    when: '元素上有 v-text 指令时',
    example: { before: '<view v-text="msg">child</view>', after: '<view>{{ msg }}</view>' },
    verify: 'tests/vue-compat-v-text.test.ts',
    source: 'packages/compiler/src/template.ts → serializeElement（v-text 内容覆盖）',
    decision: 'v-text 对齐（模板指令→文本插值）',
  },
  {
    id: 'template/teleport-root-portal',
    phase: 'template',
    status: 'implemented',
    title: '<teleport> → <root-portal>（Skyline 官方：子树脱离页面层叠）',
    titleEn: '<teleport> → <root-portal> (Skyline official: subtree detaches from the page for layering)',
    description: '<teleport>content</teleport> → <root-portal>content</root-portal>（B2.25.2+，Skyline/WebView：子树脱离页面、类似 fixed position——弹窗/弹出层层叠正解，突破 z-index 层叠上下文）；to 目标 MP 无对等（root-portal 恒脱离页面 = fixed 等价，无 target 选择器）——警告说明忽略 to',
    descriptionEn: '<teleport>content</teleport> → <root-portal>content</root-portal> (base library 2.25.2+, Skyline/WebView: the subtree detaches from the page, like fixed position — the correct layering solution for modals/popovers, breaking out of the z-index stacking context); the to target has no MP equivalent (root-portal always detaches from the page, i.e. fixed-equivalent, with no target-selector semantics) — warns that to is ignored',
    why: 'Skyline/WebView root-portal（官方组件）把子树脱离页面固定，正是 Vue <teleport> 弹层层叠/传送到 body 的跨端等价——解决 p-popover 等弹层被下层元素遮挡（z-index 层叠上下文）',
    whyEn: 'Skyline/WebView root-portal (official component) detaches the subtree from the page, which is the cross-end equivalent of Vue <teleport> layering/teleporting to body — solving popovers (p-popover etc.) being occluded by lower elements (z-index stacking contexts)',
    when: '模板出现 <teleport>（不含 transition 包裹）时',
    example: { before: '<teleport to="body"><view class="overlay">hi</view></teleport>', after: '<root-portal><view class="overlay">hi</view></root-portal>（脱离页面盖层）' },
    verify: 'tests/vue-compat-teleport.test.ts',
    source: 'packages/compiler/src/template.ts → serializeElement（teleport → root-portal 分支）',
    decision: 'teleport→root-portal 对齐（Skyline 官方组件）',
  },
  {
    id: 'directive/v-once',
    phase: 'template',
    status: 'implemented',
    title: 'v-once 诚实对齐（静态剥离等价/含插值警告）',
    titleEn: 'v-once honest alignment (static strip equivalent / interpolation warns)',
    description: 'v-once 元素无 {{ }} 插值（纯静态）→ 剥离无警告（静态内容天然只渲染一次，语义等价）；含 {{ }} 插值 → 诚实警告（MP 数据驱动无「渲染一次」惰性）',
    descriptionEn: 'A v-once element with no {{ }} interpolation (pure static) → stripped with no warning (static content is rendered once anyway, semantically equivalent); with {{ }} interpolation → honest warning (MP data-driven rendering has no render-once laziness)',
    why: 'v-once 语义 = 首次渲染后冻结；MP 数据驱动无静默化对应，静态内容天然满足，响应式内容无对等——诚实区分（不粉饰）',
    whyEn: 'v-once semantics = freeze after the first render; MP data-driven rendering has no static-freeze counterpart, static content naturally satisfies it, reactive content has no equivalent — distinguish honestly (no sugar-coating)',
    when: '元素上有 v-once 指令时',
    example: { before: '<view v-once>hello</view>', after: '<view>hello</view>（静默剥离）' },
    verify: 'tests/vue-compat-v-once-pre.test.ts',
    source: 'packages/compiler/src/template.ts → serializeElement（default v-once 分支）',
    decision: 'v-once 诚实对齐',
  },
  {
    id: 'directive/v-pre',
    phase: 'template',
    status: 'implemented',
    title: 'v-pre 诚实对齐（静态剥离等价/含插值警告）',
    titleEn: 'v-pre honest alignment (static strip equivalent / interpolation warns)',
    description: 'compiler-dom 解析阶段已把 v-pre 元素内容跳过编译（{{ }} 变 raw TEXT），v-pre 属性不在 props——用元素原始源码（node.loc.source）检测；含 {{ }} → 诚实警告（WXML 无 raw 模式仍插值），纯静态 → 静默等价',
    descriptionEn: 'compiler-dom skips compiling the contents of a v-pre element at parse time ({{ }} becomes raw TEXT), so the v-pre attr is absent from props — detected via the element raw source (node.loc.source); if it contains {{ }} → honest warning (WXML has no raw mode so it still interpolates), pure static → silent equivalent',
    why: 'v-pre 语义 = 跳过该节点编译；MP WXML 无 raw 模式（{{ }} 恒插值）——诚实区分静态等价 vs 插值不生效',
    whyEn: 'v-pre semantics = skip compiling this node; MP WXML has no raw mode ({{ }} always interpolates) — distinguish honestly between static-equivalent and interpolation-not-effective',
    when: '元素上有 v-pre 指令时',
    example: { before: '<view v-pre>hello</view>', after: '<view>hello</view>（静默剥离）' },
    verify: 'tests/vue-compat-v-once-pre.test.ts',
    source: 'packages/compiler/src/template.ts → serializeElement（v-pre 源码检测）',
    decision: 'v-pre 诚实对齐',
  },
  {
    id: 'directive/custom',
    phase: 'template',
    status: 'implemented',
    title: '自定义指令剥离（无对等警告）',
    titleEn: 'custom directives are stripped (warning when there is no equivalent)',
    description: 'v-focus 等自定义指令在小程序无对等机制——编译期警告并剥离（逻辑不执行），不再静默',
    descriptionEn: 'custom directives such as v-focus have no equivalent mechanism in Mini Programs — warned at compile time and stripped (the logic never executes), no longer silently',
    why: '反黑盒（vue-compat Batch A，决策 #116）：平台无对等能力必须编译期显式警告',
    whyEn: 'anti-black-box (vue-compat Batch A, decision #116): when the platform has no equivalent capability, it must warn explicitly at compile time',
    when: '元素上有非内置 v-xxx 指令（不在 if/else/for/show/model/html/text/on/bind/slot/pre/once/cloak）',
    example: { before: '<input v-focus />', after: '<input /> + 警告（已剥离）' },
    verify: 'tests/vue-compat.test.ts 自定义指令用例',
    source: 'packages/compiler/src/template.ts → serializeElement（switch default 分支）',
    decision: '#116',
  },
  {
    id: 'template/is-component',
    phase: 'template',
    status: 'implemented',
    title: '动态组件 <component :is> 无对等警告',
    titleEn: 'dynamic component <component :is> has no equivalent — warning',
    description: '<component :is> 动态组件在小程序无对等机制——警告（产物为无效标签），建议 v-if/v-else 条件渲染',
    descriptionEn: 'the <component :is> dynamic component has no equivalent mechanism in Mini Programs — a warning is raised (the output would be an invalid tag); conditional rendering with v-if/v-else is recommended',
    why: '反黑盒（vue-compat Batch A，决策 #116）：不再静默输出无效产物',
    whyEn: 'anti-black-box (vue-compat Batch A, decision #116): no longer silently emitting invalid output',
    when: '模板出现 <component> 标签',
    example: { before: '<component :is="which" />', after: '警告 + 原样输出（无效标签）' },
    verify: 'tests/vue-compat.test.ts 动态组件用例',
    source: 'packages/compiler/src/template.ts → serializeElement（component 分支）',
    decision: '#116',
  },
  {
    id: 'event/inline-expression',
    phase: 'template',
    status: 'implemented',
    title: '内联事件表达式 → 包装方法（vue-compat Batch B；★#500 赋值型）',
    titleEn: 'inline event expressions → wrapper methods (vue-compat Batch B; ★#500 assignments)',
    description: '@click="count++"（自增/自减）、@click="fn(1)"（简单方法调用）与 ★#500 赋值型（x = !x / x = 字面量）→ 生成 proteusInlineXxx 包装方法（setData 更新 / this.fn(1)），产物可运行；裸标识符 RHS 赋值（可能为 v-for 项变量，方法作用域取不到）与复杂表达式仍反黑盒警告',
    descriptionEn: '@click="count++" (increment/decrement), @click="fn(1)" (a simple method call) and ★#500 assignments (x = !x / x = literal) → a proteusInlineXxx wrapper method is generated (setData update / this.fn(1)), keeping the output runnable; assignments whose RHS is a bare identifier (possibly a v-for item variable, unreachable in method scope) and complex expressions still produce an anti-black-box warning',
    why: 'Vue 常见写法支持（决策 #116 Batch B / #500 真机实证：赋值型整句当方法名 → bindtap="x = !x" 点击无反应）：不再原样输出无效 bindtap',
    whyEn: 'support for common Vue patterns (decision #116 Batch B / #500 real-device evidence: an assignment emitted verbatim as the handler name → bindtap="x = !x" with no response on tap): no longer emitting an invalid bindtap as-is',
    when: '事件处理器为自增/自减、简单方法调用（无 . 链）或赋值型（RHS 为字面量/!标识符）时',
    example: { before: '@click="count++" / @click="showModal = !showModal"', after: 'bindtap="proteusInlineIncCount" + 方法 setData / bindtap="proteusInlineSetShowModalShowModal" + 方法 setData' },
    verify: 'tests/vue-compat.test.ts 内联表达式用例 + tests/mp-transform.test.ts #500 赋值用例',
    source: 'packages/compiler/src/transforms/template.ts → tryInlineExpressionToWrapper（★#505 自 template.ts 迁入，逻辑单点）+ template.ts 调用点 executeRule + script.ts → inlineHandlers 注入',
    decision: '#116 / #500',
    // ★#505：描述层 → 执行层（第四条真实 apply）——内联表达式校准判定整体迁入规则：
    //   input { exp } → output { name, code } | null（null = 不可校准形态 → 调用方走 cleanHandler 警告原样）。
    //   禁用本规则 → 不包装 → bindtap="x = !x" 原样输出（#500 缺陷形态）+ 反黑盒警告（删规则即红）。
    apply: (ctx: RuleContext) => {
      const input = (ctx.input ?? {}) as { exp?: string }
      ctx.output = tryInlineExpressionToWrapper(input.exp ?? '')
    },
  },
  {
    id: 'slot/scoped-slot',
    phase: 'template',
    status: 'implemented',
    title: '作用域插槽警告（★Batch 7：MP/Skyline 平台限制确认 + 替代模式）',
    titleEn: 'scoped-slot warning (★Batch 7: MP/Skyline platform-limitation confirmation + alternative pattern)',
    description: '<slot :item="x"> 作用域插槽在小程序无对等机制（父侧拿不到子数据）——★平台限制：微信无模板传参机制（webview 的 template import 无法动态选择多父模板，Skyline 不支持跨文件模板），uni-app/Taro MP 端同样不完整——编译期警告 + 替代模式：子组件 props 接收数据 + 自定义事件回调传数据（<MyList :items :item-tap>）',
    descriptionEn: '<slot :item="x"> scoped slots have no equivalent mechanism in Mini Programs (the parent cannot access child data) — ★platform limitation: WeChat has no template parameter-passing mechanism (webview template import cannot dynamically pick among multiple parent templates, and Skyline does not support cross-file templates); the uni-app/Taro MP sides are likewise incomplete — compile-time warning + alternative pattern: the child component receives data via props and reports it back through custom-event callbacks (<MyList :items :item-tap>)',
    why: '反黑盒（vue-compat-advance Batch 1/7，决策 #117）：不再静默输出无效属性；运行时等价受 MP 平台能力限制（非待办，替代模式 props+事件已由组件系统完整支持）',
    whyEn: 'anti-black-box (vue-compat-advance Batch 1/7, decision #117): no longer silently emitting invalid attributes; runtime equivalence is limited by MP platform capabilities (not a TODO — the props + events alternative is fully supported by the component system)',
    when: '<slot> 元素上有 v-bind 属性（非 class/style/name）',
    example: { before: '<slot :item="item" />', after: '<slot /> + 警告（替代：props 传子 + triggerEvent 事件回调）' },
    verify: 'tests/vue-compat-advance.test.ts 作用域插槽用例',
    source: 'packages/compiler/src/template.ts → serializeElement（bind 分支 slot 检测）',
    decision: '#117',
  },
  {
    id: 'slot/named-template',
    phase: 'template',
    status: 'implemented',
    title: '具名插槽 MP 接线：<template #name> → <view slot="name">（微信 slot 机制；默认插槽解壳内联）',
    titleEn: 'named-slot MP wiring: <template #name> → <view slot="name"> (WeChat slot mechanism; the default slot is unwrapped inline)',
    description: '自定义组件子级的 <template #aside>（含多子元素/默认内容共存）旧产物丢 slot 名并包在 <template>（WXML 不渲染内容）→ 整段不可见（fluid-system-demo 侧边栏/容器全丢真机根因）——现在具名插槽发射 <view slot="aside"> 包装（微信父侧 slot 属性机制，组件侧 <slot name> 对位），默认插槽（#default/无参）解壳内联（微信默认插槽接受直接子节点）；<template v-if>/v-for 包装形态不受影响',
    descriptionEn: 'custom-component child content declared as <template #aside> (including multi-element content coexisting with default content) used to lose the slot name and be wrapped in a plain <template> (WXML does not render the content inline) → the whole section became invisible (root cause of the fluid-system-demo sidebar/container loss on device) — named slots now emit a <view slot="aside"> wrapper (WeChat parent-side slot-attribute mechanism, counterpart of <slot name> on the child side), while the default slot (#default/nameless) is unwrapped inline (WeChat default slots accept direct children); <template v-if>/v-for wrapper forms are unaffected',
    why: '跨端插槽语义等价（2026-09 真机实测）：Vue 命名插槽在微信的自定义组件机制是对位可映射的（slot 属性 ↔ <slot name>），此前编译器把内容丢进不渲染的 <template> 等于静默丢弃——违背反黑盒与双端同源码',
    whyEn: 'cross-platform slot-semantics equivalence (2026-09 device-verified): Vue named slots map 1:1 onto WeChat custom-component slots (slot attribute ↔ <slot name>); wrapping content in a non-rendering <template> was an implicit drop — violating anti-black-box and same-source-for-both-ends',
    when: '模板内自定义组件子级出现 <template #name> / <template #default>（v-slot 形态）',
    example: { before: '<p-split><template #aside>…</template>…</p-split>', after: '<p-split><view slot="aside">…</view>…</p-split>' },
    verify: 'tests/mp-transform.test.ts 具名插槽/作用域默认插槽用例',
    source: 'packages/compiler/src/template.ts → serializeElement（template + v-slot 分支）',
    decision: '#498',
  },
  {
    id: 'slot/scoped-template',
    phase: 'template',
    status: 'implemented',
    title: '作用域默认插槽内容警告（#default="{ errors }"：内容渲染但参数不可用）',
    titleEn: 'scoped default-slot content warning (#default="{ errors }": content renders but the parameter is unavailable)',
    description: '消费侧 <template #default="{ errors }"> 作用域默认插槽：微信 slot 不向内容传参——内容解壳按普通默认插槽渲染（不再包不渲染的 <template>），{ errors } 恒不可用：编译期警告 + 替代模式（props 传子 + 事件回调；与组件侧 <slot :errors> 的 slot/scoped-slot 警告同源）',
    descriptionEn: 'consumer-side scoped default slot <template #default="{ errors }">: WeChat slots pass no data to their content — the content is unwrapped and rendered as a normal default slot (no longer wrapped in a non-rendering <template>), while { errors } is permanently unavailable: compile-time warning + alternative pattern (props down + event callbacks back up; same root as the child-side slot/scoped-slot warning for <slot :errors>)',
    why: '反黑盒（vue-compat-advance Batch 7 平台限制）：作用域数据在 MP/Skyline 无模板传参机制，静默丢参等于假等价——内容仍渲染（视觉等价），参数不可用显式警告',
    whyEn: 'anti-black-box (vue-compat-advance Batch 7 platform limitation): scoped data has no template parameter-passing mechanism on MP/Skyline, and silently dropping the parameter would fake equivalence — the content still renders (visual equivalence) while the unavailable parameter is explicitly warned',
    when: '模板内自定义组件子级出现带参数的 v-slot（#default="{ x }" / v-slot:name="x"）',
    example: { before: '<p-form><template #default="{ errors }">…</template></p-form>', after: '解壳渲染 + 警告（{ errors } 不可用；替代：props 传子 + 事件回调）' },
    verify: 'tests/mp-transform.test.ts 作用域默认插槽用例',
    source: 'packages/compiler/src/template.ts → serializeElement（template + v-slot 分支）',
    decision: '#498',
  },
  {
    id: 'transition/component',
    phase: 'template',
    status: 'implemented',
    title: '<transition> → 装饰式进入动画（子元素注入动画 class）',
    titleEn: '<transition> → decorative enter animation (an animation class is injected into the child element)',
    description: '<transition name="fade"> 装饰式处理：过渡标签不输出，子元素注入 class="proteus-transition-{name}"（进入动画由重建自动播放）；wxss 按 usesTransition 按需注入 keyframes（fade/slide-up/scale）',
    descriptionEn: '<transition name="fade"> is handled decoratively: the transition tag itself is not emitted, and the child element is injected with class="proteus-transition-{name}" (the enter animation replays automatically on re-mount); wxss injects keyframes on demand according to usesTransition (fade/slide-up/scale)',
    why: 'Vue <transition> 运行时等价（vue-compat-advance Batch 2，决策 #117）：MP 无原生 Transition，编译注入动画 class + keyframes 补位；与路由 routeType 转场互补（元素级 vs 页面级）',
    whyEn: 'the runtime equivalent of Vue <transition> (vue-compat-advance Batch 2, decision #117): MP has no native Transition, so the compiler injects an animation class + keyframes to fill the gap; it complements route routeType transitions (element-level vs page-level)',
    when: '模板出现 <transition> 标签',
    example: { before: '<transition name="fade"><view v-if="on">X</view></transition>', after: '<view class="proteus-transition-fade" wx:if="{{__tv0}}">X</view>' },
    verify: 'tests/vue-compat-advance.test.ts Transition 用例',
    source: 'packages/compiler/src/template.ts → serializeElement（transition 分支）+ style.ts TRANSITION_WXSS',
    decision: '#117',
  },
  {
    id: 'transition/leave-state',
    phase: 'template',
    status: 'implemented',
    title: '<transition> 离开动画状态机（裸 ref v-if 延迟移除）',
    titleEn: '<transition> leave-animation state machine (bare-ref v-if removed with a delay)',
    description: 'transition 直接子元素 v-if 为裸 ref 名时启用离开动画：v-if 改写 wx:if="{{__tv{i}}}"（显示状态，初始 = ref 初始值）+ class 插值 {{__tl{i} ? "...-leave" : ""}}（离开中切换 leave 动画）；script 生成 proteusTransitionToggle{i}()（ref 写入点注入：on 变 false → __tl{i}=true 播离开动画 + setTimeout 时长后 __tv{i}=false 延迟移除；on 变 true → 取消定时器恢复进入动画）；wxss 按需注入 leave class + keyframes（forwards 保持末帧）',
    descriptionEn: 'the leave animation is enabled when the v-if on a direct child of transition is a bare ref name: v-if is rewritten to wx:if="{{__tv{i}}}" (the visible state, initially equal to the ref initial value) plus the class interpolation {{__tl{i} ? "...-leave" : ""}} (switching to the leave animation while leaving); the script generates proteusTransitionToggle{i}() (injected at the ref write points: when on turns false → __tl{i}=true plays the leave animation and, after a setTimeout of that duration, __tv{i}=false delays the removal; when on turns true → the timer is cancelled and the enter animation resumes); wxss injects the leave class and keyframes on demand (forwards keeps the last frame)',
    why: 'Vue transition 离开语义：v-if 变 false 先播离开动画再移除（vue-compat-advance Batch 5）；MP wx:if 立即移除无动画——编译期状态机补位；仅裸 ref v-if 支持（复杂表达式保持 Batch 2 现状）',
    whyEn: 'the Vue transition leave semantics: when v-if turns false, the leave animation plays first and only then is the element removed (vue-compat-advance Batch 5); MP wx:if removes immediately without animation — a compile-time state machine fills the gap; only bare-ref v-if is supported (complex expressions keep the Batch 2 behavior)',
    when: '<transition> 直接子元素带 v-if 且表达式为裸 ref 名',
    example: { before: '<transition name="fade"><view v-if="on">X</view></transition>', after: '<view wx:if="{{__tv0}}" class="proteus-transition-fade {{__tl0 ? \'proteus-transition-fade-leave\' : \'\'}}">X</view> + data __tv0/__tl0 + proteusTransitionToggle0()' },
    verify: 'tests/vue-compat-advance.test.ts Batch 5 用例',
    source: 'packages/compiler/src/template.ts → serializeElement（v-if 分支 + class 注入）+ script.ts（data/方法/写入点注入）+ style.ts TRANSITION_WXSS',
    decision: '#117',
  },
  {
    id: 'template/template-ref',
    phase: 'template',
    status: 'implemented',
    title: '模板 ref 无对等警告',
    titleEn: 'template ref has no equivalent — warning',
    description: 'ref="el" 模板 ref 在小程序无对等绑定（永不赋值）——警告，建议 this.selectComponent("#id")',
    descriptionEn: 'a template ref such as ref="el" has no equivalent binding in Mini Programs (never assigned) — a warning is raised; this.selectComponent("#id") is recommended',
    why: '反黑盒（vue-compat Batch A，决策 #116）：不再静默无效',
    whyEn: 'anti-black-box (vue-compat Batch A, decision #116): no longer silent about having no effect',
    when: '元素上有 ref 属性',
    example: { before: '<input ref="el" />', after: '<input /> + 警告' },
    verify: 'tests/vue-compat.test.ts 模板 ref 用例',
    source: 'packages/compiler/src/template.ts → serializeElement（ref 属性分支）',
    decision: '#116',
  },
  {
    id: 'template/no-peer',
    phase: 'template',
    status: 'implemented',
    title: '平台无对等组件警告（Transition/Teleport 等）',
    titleEn: 'warnings for platform components with no equivalent (Transition/Teleport, etc.)',
    description: 'transition/transition-group/teleport/suspense/keep-alive 在小程序无对等组件——警告（原样输出不生效）',
    descriptionEn: 'transition/transition-group/teleport/suspense/keep-alive have no equivalent in Mini Programs — a warning is raised (kept as-is, without effect)',
    why: '反黑盒（vue-compat Batch A，决策 #116）：转场请用路由 routeType，缓存/传送请移除',
    whyEn: 'anti-black-box (vue-compat Batch A, decision #116): use the routeType transition for transitions; remove keep-alive/teleport usage',
    when: '模板出现这些标签',
    example: { before: '<transition name="fade">…</transition>', after: '警告 + 原样输出' },
    verify: 'tests/vue-compat.test.ts 无对等组件用例',
    source: 'packages/compiler/src/template.ts → serializeElement（no-peer 分支）',
    decision: '#116',
  },
  {
    id: 'template/svg-p2-unsupported',
    phase: 'template',
    status: 'implemented',
    title: 'SVG 子树内 use/symbol/text/tspan → 实测不支持警告（SVG→Skyline P2）',
    titleEn: 'use/symbol/text/tspan inside SVG → measured-unsupported warning (SVG→Skyline P2)',
    description: 'Skyline image 渲染 SVG 的实测支持表（真机 spike）：mask/clipPath/渐变/transform/dasharray/opacity/filter 全部支持；use/symbol/text/tspan 渲染为空白 → 编译期诚实警告',
    descriptionEn: 'Measured SVG feature support for Skyline image rendering (on-device spike): mask/clipPath/gradients/transform/dasharray/opacity/filter all work; use/symbol/text/tspan render blank → honest compile-time warning',
    why: 'G-62 SVG→Skyline P2：原方案假设 mask/clip-path 需 canvas 近似；真机实证 Skyline image 原生支持（P2 大幅简化）。仅 use/text 空白——提前告知避免真机踩坑（反黑盒）',
    whyEn: 'G-62 SVG→Skyline P2: the original plan assumed mask/clip-path needed canvas approximation; on-device evidence shows Skyline image supports them natively (P2 greatly simplified). Only use/text render blank — warning ahead of time to avoid on-device surprises (anti-black-box)',
    when: 'SVG 子树含 use/symbol/text/tspan',
    example: { before: '<svg><use href="#icon"/></svg>', after: 'lowering 为 image + 警告「实测不支持」' },
    verify: 'tests/svg-to-image.test.ts',
    source: 'packages/compiler/src/svg-lower.ts SVG_P2_SUPPORT/collectUnsupportedSvgTags + template.ts warnUnsupportedSvgFeatures',
    decision: 'G-62 P2',
  },
  {
    id: 'template/svg-dynamic',
    phase: 'template',
    status: 'implemented',
    title: '动态 <svg> 子树 → computed 重生成 SVG data-URI（SVG→Skyline P1）',
    titleEn: 'Dynamic <svg> subtree → computed SVG data-URI regeneration (SVG→Skyline P1)',
    description: '含动态绑定（:d/:fill/v-if/插值）的 SVG 子树 → computed（运行时拼 SVG 字符串 + encodeURIComponent → URL-encoded data-URI）+ <image src="{{proteusSvgN}}">；复用既有 computed 链路（依赖追踪/init/写入补丁重算）',
    descriptionEn: 'An SVG subtree with dynamic bindings (:d/:fill/v-if/interpolation) becomes a computed (runtime SVG string + encodeURIComponent → URL-encoded data-URI) + <image src="{{proteusSvgN}}">, reusing the existing computed pipeline (dependency tracking / init / write-patch recompute)',
    why: 'G-62 SVG→Skyline P1：原 canvas 方案被 Skyline node() 通道阻塞（专项 §9）；地基探测实证「运行时拼 SVG → computed → setData → Skyline 重渲染 + 响应式有效」，且微信逻辑层无 btoa 须走 URL-encoded（真机 image-spike 验证）',
    whyEn: 'G-62 SVG→Skyline P1: the original canvas approach is blocked by the Skyline node() channel (plan §9); the ground-work probe proved that "runtime SVG string → computed → setData → Skyline re-render + reactivity" works, and that WeChat logic layer lacks btoa so URL-encoded is required (verified on device)',
    when: '模板出现含动态绑定的 <svg> 子树（v-for 暂不支持）',
    example: { before: '<svg viewBox="0 0 24 24"><path :d="d" :fill="c"/></svg>', after: '<image src="{{proteusSvg1}}" mode="aspectFit" /> + computed 拼 SVG 字符串' },
    verify: 'tests/svg-to-image.test.ts',
    source: 'packages/compiler/src/template.ts → serializeElement（svg-dynamic 分支）+ svg-lower.ts lowerSvgDynamic + script.ts（dynamicSvgs → computed）',
    decision: 'G-62 P1',
  },
  {
    id: 'template/svg-to-image',
    phase: 'template',
    status: 'implemented',
    title: '静态 <svg> 子树 → <image> data-URI（SVG→Skyline P0）',
    titleEn: 'Static <svg> subtree → <image> data-URI (SVG→Skyline P0)',
    description: '静态 SVG 子树（无 v-bind/v-if/v-for/插值/事件）序列化为 SVG 字符串 → base64 data-URI → <image src>（Skyline 实测可完整渲染 path/stroke/circle）；含动态绑定不 lowering（诚实警告，P1）',
    descriptionEn: 'A static SVG subtree (no v-bind/v-if/v-for/interpolation/events) is serialized to an SVG string → base64 data-URI → <image src> (Skyline renders path/stroke/circle correctly, verified on device); subtrees with dynamic bindings are not lowered (honest warning, P1)',
    why: 'G-62 SVG→Skyline P0（决策：地基 spike 实证 Skyline <image> 完整渲染 SVG data-URI，而 canvas 路线被 node() 通道阻塞）——静态图标 80% 场景零改代码可用',
    whyEn: 'G-62 SVG→Skyline P0 (decision: the ground-work spike proved Skyline <image> fully renders SVG data-URI while the canvas route is blocked by the node() channel) — 80% of static icon cases work without code changes',
    when: '模板出现静态 <svg> 子树（无动态绑定）',
    example: { before: '<svg viewBox="0 0 24 24"><path d="M12 2 L22 22" fill="red"/></svg>', after: '<image src="data:image/svg+xml;base64,…" mode="aspectFit" />' },
    verify: 'tests/svg-to-image.test.ts',
    source: 'packages/compiler/src/template.ts → serializeElement（svg-to-image 分支）+ svg-lower.ts',
    decision: 'G-62 P0',
  },
  {
    id: 'template/svg-no-peer',
    phase: 'template',
    status: 'implemented',
    title: 'SVG 命名空间标签在小程序无对等组件——警告',
    titleEn: 'SVG namespace tags have no equivalent components in Mini Programs — warning',
    description: 'svg/path/circle/rect 等 SVG 标签在小程序无对等组件（微信无 <svg>，不渲染）——警告（原样输出但无效）；Skia 矢量映射为后续批次',
    descriptionEn: 'SVG tags such as svg/path/circle/rect have no equivalent components in Mini Programs (WeChat has no <svg>, so they do not render) — a warning is raised (kept as-is but ineffective); the Skia vector mapping is a later batch',
    why: '反黑盒（★#505 G2 平台校验抓真实产物：p-svg 组件模板写 <svg>，旧行为静默当未注册自定义组件输出 → 产物无效标签真机不渲染）；矢量组件（p-svg/ui.svg mpEquiv 无）请用 image/背景图或等矢量批次',
    whyEn: 'anti-black-box (★#505 G2 platform check caught a real artifact: the p-svg component template writes <svg>, and the old behavior silently emitted it as an unregistered custom component → an invalid tag that does not render on device); for vector components (p-svg/ui.svg has no mpEquiv), use image/background-image or wait for the vector batch',
    when: '模板出现 SVG 命名空间标签（svg/path/circle/rect/line/ellipse/g/defs/use/symbol/mask/text/tspan 等）',
    example: { before: '<svg viewBox="…"><path d="…"/></svg>', after: '警告 + 原样输出（不渲染）' },
    verify: 'tests/compiler-validate-wxml-platform.test.ts（p-svg SVG 标签警告）',
    source: 'packages/compiler/src/template.ts → serializeElement（SVG_NAMESPACE_TAGS 分支）',
    decision: '#505 G2',
  },

  // ============ 导航链接 ============
  {
    id: 'nav/navigate-link',
    phase: 'template',
    status: 'implemented',
    title: '<a href> / <router-link to> → 导航链接',
    titleEn: '<a href> / <router-link to> → navigation link',
    description: '带 href/to 的导航链接 → data-url + data-route-type + bindtap="proteusNavigateTo"（handler 由 script/nav-handler 注入）',
    descriptionEn: 'navigation links with href/to → data-url + data-route-type + bindtap="proteusNavigateTo" (the handler is injected by script/nav-handler)',
    why: 'Web 端 <a> 走浏览器导航，小程序端需转 data-url + 点击跳转（决策 #24）；保留前导 / 为绝对路径（#30 真机教训：无前导 / 会相对当前页目录解析导致双重前缀）',
    whyEn: 'on the Web <a> relies on browser navigation, while on Mini Programs it must become data-url + a tap-based jump (decision #24); the leading / is kept as an absolute path (#30 real-device lesson: without the leading / the path resolves against the current page directory and doubles the prefix)',
    when: 'a 或 router-link 且无 @click、含 href/to（静态或 :bind）时',
    example: {
      before: '<a href="/pages/user/index">用户</a>',
      after: '<view class="proteus-a" data-url="/pages/user/index" bindtap="proteusNavigateTo">用户</view>',
    },
    verify: 'tests/mp-transform.test.ts 导航链接用例；真机验证归档决策 #30',
    source: 'src/compiler/template.ts → serializeElement（isNavLink / hasNavTarget 分支）',
    decision: '#24 / #30 / #29',
  },
  {
    id: 'nav/route-type',
    phase: 'template',
    status: 'implemented',
    title: '导航链接 route-type 属性 → data-route-type',
    titleEn: 'navigation-link route-type attribute → data-route-type',
    description: '<a route-type="halfScreen"> → data-route-type="halfScreen"（proteusNavigateTo 透传为 wx.navigateTo 的 routeType）',
    descriptionEn: '<a route-type="halfScreen"> → data-route-type="halfScreen" (proteusNavigateTo forwards it as the routeType of wx.navigateTo)',
    why: 'Skyline 自定义路由转场从导航链接发起时，需把 routeType 传到运行期（决策 #44：routeType 双端同 API）',
    whyEn: 'when a Skyline custom route transition is initiated from a navigation link, routeType must reach the runtime (decision #44: routeType shares the same API on both ends)',
    when: '导航链接元素上有 route-type 属性时',
    example: {
      before: '<a href="/pages/user/profile" route-type="halfScreen">资料</a>',
      after: '<view data-url="/pages/user/profile" data-route-type="halfScreen" bindtap="proteusNavigateTo">资料</view>',
    },
    verify: 'tests/mp-transform.test.ts 导航链接用例',
    source: 'src/compiler/template.ts → serializeElement（route-type 分支）',
    decision: '#28 / #44',
  },

  // ============ 通用节点 ============
  {
    id: 'node/interpolation',
    phase: 'template',
    status: 'implemented',
    title: '插值 {{ expr }} 保留',
    titleEn: 'interpolations {{ expr }} are preserved',
    description: '{{ title }} → {{ title }}（表达式原样透传，文本节点紧凑单行输出）',
    descriptionEn: '{{ title }} → {{ title }} (the expression is passed through as-is; text nodes are emitted compactly on a single line)',
    why: '小程序插值语法同为 {{expr}}，无需转换；纯文本子节点紧凑单行保证产物可读（决策 #15）',
    whyEn: 'the Mini Program interpolation syntax is also {{expr}}, so no conversion is needed; text-only child nodes are compacted onto a single line to keep the output readable (decision #15)',
    when: '模板出现 {{ }} 插值或纯文本子节点时',
    example: { before: '<p>tapped {{ count }} times</p>', after: '<text class="proteus-p">tapped {{ count }} times</text>' },
    verify: 'golden fixture basic.wxml',
    source: 'src/compiler/template.ts → serializeNode（TEXT / INTERPOLATION 分支）',
    decision: '#15',
  },
  {
    id: 'annotation/line-note',
    phase: 'template',
    status: 'implemented',
    title: 'PROTEUS_DEBUG 源码行号注释',
    titleEn: 'PROTEUS_DEBUG source-line comments',
    description: 'annotateLines=true 时 WXML 每个元素前注入 <!-- @行号 标签 -->，产物可反查源码位置',
    descriptionEn: 'when annotateLines=true, a <!-- @line tag --> comment is injected before every WXML element so the output can be traced back to a source location',
    why: '反编译黑盒机制（#17）：默认关闭，npm run debug:mp 开启——AI/人拿到产物即可定位到源码行',
    whyEn: 'anti-black-box mechanism (#17): off by default, turned on by npm run debug:mp — whoever gets the output (AI/human) can locate the source line',
    when: '编译选项 annotateLines=true（PROTEUS_DEBUG=1 构建）时',
    example: { before: '第 26 行 <h1>{{ title }}</h1>', after: '<!-- @26 h1 -->\n<text class="proteus-h1">{{ title }}</text>' },
    verify: 'tests/mp-transform.test.ts annotateLines 用例；PROJECT_MEMORY #17',
    source: 'src/compiler/template.ts → serializeElement（lineNote 分支）',
    decision: '#17',
  },
  {
    id: 'template/scope-attr',
    phase: 'template',
    status: 'implemented',
    title: 'scoped CSS：用户 class 与 scopeId 拼接为单一类（★2026-08 真机重构：类名后缀）',
    titleEn: 'scoped CSS: user class and scopeId merged into one class (★2026-08 real-device refactor: class-name suffix)',
    description: '<style scoped> 存在时，模板元素 class 值 token 追加 -scopeId（.box → box-data-v-xxx）；:class 字符串字面量/对象键同样后缀（动态变量类名编译期警告）；样式侧选择器 .box-data-v-xxx 匹配',
    descriptionEn: 'when <style scoped> is present, every class-value token on a template element gets -scopeId appended (.box → box-data-v-xxx); :class string literals and object keys are suffixed the same way (dynamic variable class names warn at compile time); the selector .box-data-v-xxx then matches on the style side',
    why: '小程序无 scoped CSS 原生机制，编译期类名后缀等价（v0.3，决策 #77）；★2026-08 真机重构：Skyline 不支持属性选择器/复合类选择器 → 类名拼接为唯一单类选择器路径；★#505 M5：禁用须与 style/scoped-css 配对（两相分别门控，单禁一侧 = 模板类与 wxss 选择器失配——模板侧禁用时显式配对警告）',
    whyEn: 'Mini Programs have no native scoped-CSS mechanism, so a compile-time class-name suffix is the equivalent (v0.3, decision #77); ★2026-08 real-device refactor: Skyline does not support attribute selectors/compound class selectors → the class is merged into a single unique single-class-selector path',
    when: 'SFC 含 <style scoped>（compileVueSfc 生成 scopeId 并注入）时',
    example: { before: '<div class="card">…</div>', after: '<view class="card-data-v-abc123">…</view>' },
    verify: 'tests/mp-transform.test.ts scoped CSS 用例',
    source: 'packages/compiler/src/template.ts → serializeElement（scopeSuffix 分支）',
    decision: '#77（v0.3 scoped CSS）+ 2026-08 Skyline 真机重构（类名后缀）',
    // ★分派层示范：输入 { tag, scopeId } → 输出作用域后缀片段（AI 覆盖可改后缀名）
    apply: (ctx: RuleContext) => {
      const input = ctx.input as { tag: string; scopeId: string }
      ctx.output = input.scopeId
    },
  },
  {
    id: 'component/root-class',
    phase: 'template',
    status: 'implemented',
    title: '组件标签 class 透传：root-class 属性 → 组件根节点 {{rootClass}}（Vue class 继承语义）',
    titleEn: 'component-tag class pass-through: root-class attribute → {{rootClass}} on the component root node (Vue class-inheritance semantics)',
    description: '自定义组件标签（非原生基础标签）的 class（scope class + 用户 class + :class 绑定）合并为单个 root-class 属性发射；组件模板根节点 class 追加 {{rootClass}}；script 侧组件注入 rootClass property（value: ""）',
    descriptionEn: 'the class of a custom component tag (a non-native base tag) — scope class + user class + :class binding — is merged and emitted as a single root-class attribute; {{rootClass}} is appended to the class of the component template root node; on the script side, the component is injected with a rootClass property (value: "")',
    why: 'Vue 的 class 继承语义（父组件 class 作用于子组件根节点）在微信无原生对等——组件 host 节点 class 合并后，页面 wxss 无法可靠作用（真机实测：p-view 外层容器 box 样式不生效，即使 styleIsolation: apply-shared）——编译期等价：class 经 root-class 属性传入组件，根节点绑定 {{rootClass}}，配合 apply-shared 让页面样式作用组件根节点',
    whyEn: 'Vue class-inheritance semantics (the parent class applies to the child root node) has no native equivalent in WeChat — once the class is merged onto the component host node, page wxss cannot reliably apply (real-device test: the box style on the p-view outer container does not take effect, even with styleIsolation: apply-shared) — the compile-time equivalent: the class enters the component via the root-class attribute, the root node binds {{rootClass}}, and together with apply-shared page styles reach the component root node',
    when: '模板出现非小程序原生标签（组件标签，如 p-view/counter）且规则未禁用时；组件模式根节点绑定',
    example: { before: '<p-view class="box">…</p-view>', after: '<p-view root-class="data-v-abc123 box" />（组件根节点 class="… {{rootClass}}"）' },
    verify: 'tests/mp-transform.test.ts 组件 class 透传用例',
    source: 'packages/compiler/src/template.ts → serializeElement（isComponentTag 分支）+ transformTemplateToWxml（isComponentRoot）；packages/compiler/src/script.ts → transformScriptToPage（properties.rootClass）',
    decision: '2026-08 真机实测（Skyline）',
  },
  {
    id: 'component/multi-slot',
    phase: 'template',
    status: 'implemented',
    title: '具名插槽开启 multipleSlots：Component options（微信默认单插槽）',
    titleEn: 'named slots enable multipleSlots in Component options (WeChat defaults to a single slot)',
    description: '微信自定义组件默认仅支持单个插槽（glass-easel 组件框架层，双渲染器一致）——不开启 multipleSlots 时 <slot name> 与内容 slot="name" 标记不按名路由，全部落入单一默认槽；编译器对所有 Component 产物注入 options: { multipleSlots: true }（单插槽组件不受影响）',
    descriptionEn: 'WeChat custom components support only a single slot by default (glass-easel component-framework layer, consistent across both renderers) — without multipleSlots, <slot name> and content slot="name" markers are not routed by name and everything falls into the single default slot; the compiler injects options: { multipleSlots: true } into every Component output (single-slot components are unaffected)',
    why: 'Vue 具名插槽语义（#498 fluid-system-demo 真机实证：p-zone 选槽错乱 / p-sidebar nav 泄漏进默认插槽）依赖微信 multipleSlots 机制——不开启则具名插槽内容错位，双渲染器一致',
    whyEn: 'Vue named-slot semantics (#498 real-device evidence on fluid-system-demo: p-zone picked the wrong slot / p-sidebar nav leaked into the default slot) rely on the WeChat multipleSlots mechanism — without it named content misroutes, identically on both renderers',
    when: '组件模式产物（Page 产物不注入）',
    example: { before: 'Component({ properties… })', after: 'Component({ options: { multipleSlots: true }, properties… })' },
    verify: 'tests/mp-transform.test.ts multipleSlots 用例',
    source: 'packages/compiler/src/script.ts → transformScriptToPage（Component 产物头）',
    decision: '#500',
  },
  {
    id: 'layout/auto-flex-row',
    phase: 'template',
    status: 'implemented',
    title: '行内场景自动 flex row（Skyline 无 inline 布局）',
    titleEn: 'inline scenarios automatically become flex row (Skyline has no inline layout)',
    description: '容器直接子元素同时含 text 与行内控件（switch/slider/icon/image/button/input/textarea/checkbox/radio/label/navigator/progress）→ 自动附加 proteus-flex-row 类（display:flex;row;align-items:center）；BASE 注入对应规则',
    descriptionEn: 'when the direct children of a container mix text with inline controls (switch/slider/icon/image/button/input/textarea/checkbox/radio/label/navigator/progress) → the proteus-flex-row class is appended automatically (display:flex;row;align-items:center); BASE injects the matching rule',
    why: 'Skyline 引擎不支持 inline 布局（官方 Inline × 开发中）——text 天生 block 占满一行，行内排布（text + switch 同行）唯一路径是 flex row（用户实测）；自动检测免开发者手动包 flex（双端一致）',
    whyEn: 'the Skyline engine does not support inline layout (officially Inline is under development) — text is block by nature and takes a full line, so the only way to arrange items inline (text + switch on one line) is flex row (verified by users); the automatic detection saves developers from manually wrapping in flex (consistent on both ends)',
    when: '容器子元素含 text 且含行内控件（rules.disabled 可关）',
    example: { before: '<view><switch/><text>开关</text></view>', after: '<view class="proteus-flex-row"><switch/><text>开关</text></view>' },
    verify: 'tests/mp-transform.test.ts 行内 flex 用例',
    source: 'packages/compiler/src/template.ts → serializeElement（autoFlexRow 判定）+ style.ts → BASE_SEMANTIC_WXSS',
    decision: '2026-08 用户决策（Skyline inline 限制）',
  },
  {
    id: 'component/progress-degrade',
    phase: 'template',
    status: 'implemented',
    title: 'progress 降级自定义 view 进度条（Skyline 官方不支持 progress）',
    titleEn: 'progress downgrades to a custom view progress bar (Skyline officially does not support progress)',
    description: '小程序语义 <progress> 编译为自定义 view 结构（track/inner/info 三节点）——percent→宽度、active-color/color→填充色、stroke-width→高度、show-info（无值=真）→百分比文字；静态属性直出、绑定插值；BASE 注入 .proteus-progress 样式',
    descriptionEn: 'the native Mini Program <progress> element is compiled into a custom view structure (three nodes: track/inner/info) — percent → width, active-color/color → fill color, stroke-width → height, show-info (no value means true) → the percentage text; static attributes are emitted directly and bindings become interpolations; BASE injects the .proteus-progress styles',
    why: 'Skyline 组件支持表 progress 暂不考虑（真机实测不渲染）——降级自定义结构双端一致 + Skyline 可用（16-progress-skyline-degrade）',
    whyEn: 'progress is not currently on the Skyline component-support list (real-device tests show it does not render) — the downgraded custom structure keeps both ends consistent and is usable on Skyline (16-progress-skyline-degrade)',
    when: '模板出现 <progress> 且规则未禁用时',
    example: { before: '<progress :percent="70" show-info />', after: '<view class="proteus-progress"><view class="proteus-progress-track"><view class="proteus-progress-inner" style="width:{{70}}%;background-color:#07c160"></view></view><text wx:if="{{true}}" class="proteus-progress-info">{{70}}%</text></view>' },
    verify: 'tests/mp-transform.test.ts progress 降级用例',
    source: 'packages/compiler/src/template.ts → serializeProgress + style.ts → BASE_SEMANTIC_WXSS',
    decision: '2026-08 真机实测（Skyline 不支持 progress）',
  },
  {
    id: 'fluid/semantic-grid',
    phase: 'template',
    status: 'implemented',
    title: 'p-grid 柔性语义编译（页面级 flex 档位容器）',
    titleEn: 'p-grid flexible semantic compilation (page-level flex column container)',
    description: '<p-grid>（页面内）编译为容器 view flex(row/wrap/gap) + 直接子元素逐包 p-grid-item 档位容器（v-for/v-if/key 迁移包装层；style 绑 {{pgridStyleN}} px 档，script 注入默认档 + onLoad/onReady SelectorQuery 实测重算）；动态 props/组件内 → 回退运行时组件；禁用 → 整体回退运行时组件（产物保留 <p-grid> 标签，gen-routes 同步注册 usingComponents）',
    descriptionEn: '<p-grid> (in pages) compiles to a container view flex(row/wrap/gap) plus per-child p-grid-item column wrappers (v-for/v-if/key migrate to the wrapper; style binds {{pgridStyleN}} px columns, the script injects defaults plus onLoad/onReady SelectorQuery measurement); dynamic props or in-component usage fall back to the runtime component; when disabled, it falls back entirely to the runtime component (the artifact keeps the <p-grid> tag and gen-routes registers usingComponents accordingly)',
    why: 'Skyline/WebView 无 CSS Grid——跨端网格只能编译器按端 codegen（#496 五轮实证：flex + px 档 + 实测容器宽才是 Skyline 可靠路径）；禁用须三侧一致（template 回退 + script 不注入 + gen-routes 注册），否则产物 wxml 引用 {{pgridStyleN}} 而 script 不注入默认档 = 半失效产物（★#505 M3 批 3 修复）',
    whyEn: 'Skyline/WebView have no CSS Grid — cross-end grids can only be code-generated per end by the compiler (#496, five rounds of verification: flex + px columns + measured container width is the only reliable Skyline path); disabling must be consistent across all three sides (template falls back + script injects nothing + gen-routes registers), otherwise the artifact references {{pgridStyleN}} in wxml while the script injects no defaults = a half-broken artifact (fixed in ★#505 M3 batch 3)',
    when: '页面模板出现 <p-grid>（min-col-width/gap 为静态数值）且规则未禁用时',
    example: {
      before: '<p-grid :min-col-width="160" :gap="12"><view class="cell" /></p-grid>',
      after: '<view class="p-grid" style="flex-direction:row;flex-wrap:wrap;gap:12px;..."><view class="p-grid-item" style="{{pgridStyle0}}">...</view></view>（script 注入档位）',
    },
    verify: 'tests/compiler-ir-m3.test.ts 门禁⑥（禁用整体回退）+ tests/gen-routes.test.ts（规则状态决定 p-grid 注册）+ fluid-system-demo 产物',
    source: 'packages/compiler/src/template.ts → serializeElement/serializeSemanticGrid + script.ts → semanticGridInit + plugin-vite gen-routes collectComponents',
    decision: '#496（#496a-f 五轮实证）/#505 M3 批 3',
  },
  {
    id: 'fluid/p-fluid',
    phase: 'template',
    status: 'implemented',
    title: 'p-fluid 属性 → calc 线性流式声明（Skyline 无 clamp）',
    titleEn: 'the p-fluid attribute becomes linear calc fluid declarations (Skyline has no clamp)',
    description: '元素上的 p-fluid="prop(min, max)" 属性编译期为 calc 线性长度声明（linearFluid：calc(px + vw)——Skyline/WebView 共用 wxml，Skyline 官方表无 clamp/min/max）；多组 ; 分隔；解析失败（FLD003 无 prop(min,max) 区间）→ 剥离 + 警告不生成样式',
    descriptionEn: 'a p-fluid="prop(min, max)" attribute on an element compiles to linear calc length declarations (linearFluid: calc(px + vw)) at compile time — Skyline/WebView share one wxml and Skyline officially has no clamp/min/max; multiple groups are separated by “;”; when parsing fails (FLD003, no prop(min,max) range) the attribute is stripped with a warning and no styles are generated',
    why: 'Skyline 无 clamp 长度函数（官方支持表）——Web 端可保留真实 CSS clamp，MP 端 calc 线性替代（vw 天然随窗流式零运行时；#496 M3 实测收敛）',
    whyEn: 'Skyline has no clamp length function (per the official support table) — the Web end keeps real CSS clamp while the MP end uses the linear calc alternative (vw is naturally viewport-fluid with zero runtime cost; converged through real-device testing in #496 M3)',
    when: '元素（text/view 等）带 p-fluid 属性时',
    example: { before: '<text p-fluid="font-size(14, 18)">x</text>', after: '<text style="font-size: calc(15.77px + 1.1268vw)">x</text>（示意——数值随 designWidth/viewport）' },
    verify: 'tests/compiler-ir-m3.test.ts 真实文件门禁 + fluid-system-demo 产物 font-size calc 实证（#496 M3）',
    source: 'packages/compiler/src/template.ts → serializeElement（p-fluid 分支）+ fluid-layout.ts → linearFluid/parseFluidExpr',
    decision: '#496 M3/#496a-e（Skyline 五轮实证）',
  },
]

// 追踪键（防漂移）：标签 → 规则 ID，由 tag/* 规则的 mapping 反推——实现侧 trace 引用同一份数据
// 只取 tag/ 前缀规则：semantic/base-class（mapping 含 h1-p/a）与 event/click-to-tap（mapping 含 input/click）
// 的键是另一维度的映射，不得混入标签追踪（后定义覆盖会污染）。
// tests/explain.test.ts 校验所有 trace 事件 ruleId 均可解析
export const TAG_RULE_BY_TAG: Record<string, string> = Object.fromEntries(
  TEMPLATE_RULES.filter((r) => r.id.startsWith('tag/')).flatMap((r) =>
    r.mapping ? Object.keys(r.mapping).map((t): [string, string] => [t, r.id]) : [],
  ),
)
