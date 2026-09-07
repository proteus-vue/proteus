# M3 三端 Codegen 后端

> 状态层、路由层、组件层最终都收敛到"同一套 IR → 不同后端产出"。本章定义三个 codegen 后端的契约。

## 一、后端接口统一

```ts
// packages/compiler-core/src/codegen/backend.ts
export interface CodegenBackend {
  readonly platform: Platform; // 'web' | 'skyline' | 'app'
  generate(ir: IRProgram, ctx: CodegenContext): CodegenResult;
}

export interface CodegenResult {
  files: Array<{ path: string; content: string; sourceMap?: RawSourceMap }>;
  warnings: CompileWarning[];
}
```

每个后端只关心"把 IR 节点印成目标代码"，**不关心 SFC 解析、不关心 transform 插件**——这两层已在 M1/M2 完成。

## 二、Web 后端（DOM / HTML）

- 产物：`.js` (render function) + `.html` + `.css`
- template IR → Vue `render` 函数（复用 `@vue/compiler-dom` 的 codegen）
- 样式 IR → CSS / CSS Modules / scoped CSS
- 路由 IR → `vue-router` 路由表（对齐 Router M3）
- 组件 IR → 标准 Vue 组件定义

关键：**Web 后端几乎是透传**，因为 Vue 原生就是 Web。Compiler 的核心工作量不在这一端。

## 三、Skyline 后端（WXML/WXSS/JS/JSON 四件套）

这是**工作量最大**的后端，因为 Skyline 语义 ≠ DOM 语义。

### 3.1 文件映射

```
IRProgram(page: Home) →
  pages/home/home.wxml    ← template IR
  pages/home/home.wxss    ← style IR
  pages/home/home.js      ← script IR (Page/createPage)
  pages/home/home.json    ← page meta (componentFramework, renderer, usingComponents)
```

### 3.2 模板转换规则（对齐 Component 层约定）

| IR 节点 | WXML 输出 | 备注 |
|---------|-----------|------|
| `Element(tag)` | `<tag>` | tag 名保持（view/text 直出） |
| `VIf` | `wx:if` / `wx:elif` / `wx:else` | — |
| `VFor` | `wx:for` + `wx:key` | 必须带 key |
| `VBind(class)` | `class="{{...}}"` | 表达式编译为小程序表达式 |
| `VOn(click)` | `bindtap` | 事件名映射表 |
| `VModel` | `value` + `bindinput` | 双向绑定展开 |
| `Slot` | `<slot name>` | — |
| `Component(p-button)` | `<p-button>` | 全局组件直出 |

### 3.3 样式转换规则

| IR 样式 | WXSS | 注意 |
|---------|------|------|
| `scoped` | 属性哈希 `.home__btn[data-v-xxx]` | — |
| `position: fixed` | ⚠️ 转 `absolute` + 警告 | Skyline 默认行为 |
| `:hover` / `::after` | ⚠️ 不支持，降级或 warn | Skyline 局限 |
| `display: flex` | 直出 | Skyline 完整支持 |
| CSS 变量 `--xxx` | 直出（需 `styleIsolation: shared`） | — |

每条规则对应 `transforms/` 一个文件 + JSDoc，**产物可审计**。

### 3.4 脚本转换

- `<script setup>` IR → `Page({ data, methods, onLoad... })` 或 `Component({...})`
- Vue 响应式 → `@vue/reactivity`（小程序逻辑层运行）
- `defineApp` / `definePage` 生命周期 → 映射为 `App()` / `Page()` 钩子（对齐 Lifecycle 层）
- `<route>` meta → 注入 `page.json` + 路由表（对齐 Router M2/M4）

## 四、App 后端（Custom Renderer / 原生代码）

- 产物：IR → **Native 调用指令流**，经 Bridge 到 iOS/Android
- 不产出 WXML，产出**渲染指令**（createNode / updateProp / appendChild）
- Vue runtime（@vue/runtime-core）+ 自定义 Renderer（对齐前面 App 端规划）
- 样式 IR → 原生布局描述（Flex 映射 UIView/ViewGroup）

关键约束：**App 后端复用同一套 IR**，差别只在 codegen。这保证"一份源码三端一致"。

## 五、共享与差异策略

```
compiler-core/        ← IR 定义 + 后端接口（三端共享）
compiler-backend-web/ ← Web codegen
compiler-backend-skyline/ ← Skyline codegen
compiler-backend-app/ ← App codegen
```

公共逻辑（表达式编译、标识符生成、source map）提到 `compiler-core`，避免三端重复。

## 六、验收

- [ ] 同一份 `Home.vue` 三端 codegen 产物均能运行
- [ ] Skyline 后端覆盖 Router/Component/Platform 已定义的全部映射
- [ ] 每个 codegen 规则有对应单测 + snapshot
- [ ] 产物体积：Skyline 四件套总大小符合预算（见 build-pipeline）
