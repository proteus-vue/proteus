# 编译器插件系统落地方案（G-21）

> **执行位**：G-21 ｜ **层级**：基础设施（Compiler） ｜ **优先级**：P1 ｜ **依赖**：Compiler B1(M1)、Types v2、Architecture 原则 #10、Style Safety(G-16)、App Config(G-20)
>
> **一句话定位**：把 Proteus 编译管线的**每一个阶段都暴露成稳定的插件钩子**，让开发者（和业务框架、组件库、工具链）以**官方 API**接入编译流程——而非 hack 内部、改源码、打 monkey patch。

---

## 一、问题：为什么需要正式的插件系统

### 1.1 现状痛点

Proteus 已有 `04-transform-plugin.md`（IR Transform 雏形），但它**只覆盖 IR 阶段的 `transform`**，现实诉求远超于此：

| 诉求方 | 想要做什么 | 现有 IR-only 能否满足 |
|--------|-----------|:---:|
| **组件库作者** | 注册自定义 `<p-xxx>` → 各端原生映射 | ⚠️ 部分（需改 codegen 后端） |
| **业务方** | 自定义指令 `v-permission`、宏 `import.meta.env` | ❌ |
| **UI 库** | 注入全局组件 `usingComponents`、样式预设 | ⚠️ |
| **工具链** | 生成类型声明 `.d.ts`、路由元信息、API 文档 | ❌ |
| **性能工具** | 注入 AOT 预取标记、骨架屏 IR、性能埋点 | ⚠️ |
| **安全合规** | 禁用危险 API、审计依赖、源码扫描 | ❌ |
| **第三方框架** | 新增一个 target 后端（如新 OS、新小程序） | ❌ |

> **没有正式插件 API 的结果**：开发者去读 Compiler 源码、直接改 IR、monkey patch 内部函数——**一旦 Compiler 重构，全部失效，且破坏"编译透明"原则**。

### 1.2 设计目标

1. **全生命周期覆盖**：parse → IR 构建 → transform → codegen → emit → post，每个阶段都有钩子
2. **稳定性契约**：公开 API 遵循 semver，内部重构不破坏插件
3. **多语言插件**：支持 JS/TS 插件，未来可支持 WASM（Rust/Go 写的编译期逻辑）
4. **组合与隔离**：插件可组合、可禁用、可排序；错误隔离不拖垮整条管线
5. **AI-native**：每条插件规则/钩子都有 JSDoc 契约，AI 可读写（继承原则）
6. **对齐原则 #10**：插件操作的是**统一 IR / 语义**，而非直接操作各端产物（保证"语义统一、各端原生实现"）

### 1.3 与现有 `04-transform-plugin.md` 的关系

> **本方案是 `04-transform-plugin.md` 的全面升级与扩展，不是替代**。
>
> - `04-transform-plugin` 定义的 `TransformPlugin`（IR `transform`）→ **保留**，作为本方案中 **`transform` 阶段钩子** 的"规则级"子集
> - 本方案在其上新增：**parse / IR 构建 / codegen / emit / post** 阶段钩子 + **Plugin API 运行时** + **插件注册/排序/隔离** + **发布规范**
>
> 迁移：旧 `TransformPlugin` 自动适配为新 `CompilerPlugin` 的 `transform` 钩子，向后兼容。

---

## 二、核心概念

### 2.1 插件是"钩子集合 + 元数据"

```ts
// packages/compiler-core/src/plugin.ts
export interface CompilerPlugin {
  /** 插件唯一名（命名空间推荐：org/plugin-name） */
  name: string;
  /** 语义化版本，用于兼容性校验 */
  version: string;
  /** 执行阶段（默认 default） */
  enforce?: 'pre' | 'default' | 'post';
  /** 适用的编译阶段（按需实现，未实现=不参与） */
  hooks?: PluginHooks;
  /** 插件自身配置 schema（用于校验 + 自动补全） */
  configSchema?: JSONSchema;
}
```

### 2.2 钩子全景（全生命周期）

```
┌──────────────────────────────────────────────────────────────┐
│                     Compiler Pipeline                       │
│                                                              │
│  [pre]  ① parse       (SFC → AST)                           │
│            ↓                                                 │
│  [default] ② buildIR   (AST → IR)                           │
│            ↓                                                 │
│  [default] ③ transform (IR → IR)   ← 旧 TransformPlugin    │
│            ↓                                                 │
│  [post]  ④ codegen    (IR → 各端产物)                       │
│            ↓                                                 │
│  [post]  ⑤ emit       (产物写入磁盘 / 内存)                  │
│            ↓                                                 │
│  [post]  ⑥ post       (后处理：sourcemap / 报告 / 类型生成)  │
└──────────────────────────────────────────────────────────────┘
```

对应 `PluginHooks`：

```ts
export interface PluginHooks {
  // ① 解析阶段：操作 AST（SFC template/script/style）
  parse?(ctx: ParseContext): void | TransformResult;
  // ② IR 构建：操作 IR 节点树（增删改语义节点）
  buildIR?(ctx: BuildIRContext): void;
  // ③ IR 变换：旧 TransformPlugin.transform（规则级，纯函数）
  transform?(node: IRNode, ctx: TransformContext): IRNode | void;
  // ④ 代码生成：操作各端 codegen backend
  codegen?(ctx: CodegenContext): void;
  // ⑤ 产物发射：操作产物（可新增/修改文件）
  emit?(ctx: EmitContext): void;
  // ⑥ 后处理：sourcemap、报告、类型声明生成
  post?(ctx: PostContext): void;
}
```

> **关键**：`transform` 只是六个钩子之一——**这是与旧方案的本质区别**。

---

## 三、Plugin Context（插件能做什么）

每个钩子收到强类型的 `Context`，能力受控、可审计：

```ts
interface BaseContext {
  /** 当前处理的文件 */
  file: SourceFile;
  /** 当前目标端（web | skyline | ios | android | harmony） */
  platform: Platform;
  /** 全局配置（只读快照） */
  options: Readonly<ProteusConfig>;
  /** 应用配置（G-20，只读） */
  appConfig: Readonly<AppConfig>;
  /** 报告警告（自动带插件名+位置 → --trace-transform 链） */
  warn(code: string, msg: string, loc?: SourceLocation): void;
  /** 报告错误（阻断编译，带位置） */
  error(code: string, msg: string, loc?: SourceLocation): never;
  /** 共享辅助函数注册表 */
  helpers: HelperRegistry;
  /** 缓存（跨增量编译持久化，键自动含插件名） */
  cache: PluginCache;
  /** 添加依赖（触发 HMR 依赖追踪） */
  addDependency(file: string): void;
  /** 生成产物文件（emit 阶段常用） */
  emitFile(file: OutputFile): void;
}
```

**每个阶段 Context 专属扩展**：

| 钩子 | Context 额外能力 |
|------|-----------------|
| `parse` | `ast`(可改)、`parseTemplate()`、`parseScript()` |
| `buildIR` | `ir`(根节点)、`createNode()`、`visit()` |
| `transform` | `helpers`、`options`、`platform`（沿用旧 API，向后兼容） |
| `codegen` | `backend`(当前端后端)、`overrideBackend()` |
| `emit` | `outputs`(产物 map)、`sourcemap` |
| `post` | `report`(构建报告)、`generateDts()` |

---

## 四、插件注册、排序与隔离

### 4.1 注册方式

```ts
// proteus.config.ts（构建期配置，区别于 app.config 运行时）
export default defineProteus({
  compiler: {
    plugins: [
      // 1. 直接内联
      myPlugin({ option: true }),
      // 2. 命名引用（自动 resolve）
      'proteus-plugin-i18n',
      // 3. 带配置
      ['proteus-plugin-analytics', { trackClicks: true }],
    ],
  },
});
```

> 与 G-20 边界一致：`proteus.config` = 构建期；插件声明在此。

### 4.2 排序规则（确定性）

```
pre (按注册序) → default (按注册序) → post (按注册序)
同名插件按注册序；`enforce` 改变分组
```

- **确定性**：同一输入 → 同一输出，与插件加载顺序无关（除显式 `enforce`）
- **依赖声明**：插件可声明 `dependsOn: ['other-plugin']`，Compiler 校验并拓扑排序

### 4.3 隔离与容错

- **错误隔离**：单个插件 `throw` → 默认阻断（fail-fast，对齐 Style Safety 哲学）；可选 `soft: true` 降级 + warn
- **作用域**：插件只能访问自己的 `cache` key，禁止读全局
- **性能预算**：插件钩子有超时（默认 500ms/文件），超时 warn + 跳过（对齐性能预算原则）

---

## 五、典型场景示例

### 5.1 自定义指令 `v-permission`（parse + transform）

```ts
// proteus-plugin-permission/index.ts
import { definePlugin } from '@proteus-vue/compiler-core';

export default definePlugin({
  name: 'proteus-plugin-permission',
  version: '1.0.0',
  hooks: {
    // parse 阶段：识别 v-permission 语法
    parse(ctx) {
      if (ctx.file.ext !== '.vue') return;
      // ...AST 中标记 v-permission 节点
    },
    // transform 阶段：展开为权限检查 IR
    transform(node, ctx) {
      if (node.type === 'Element' && node.directives?.permission) {
        const { action } = node.directives.permission;
        // 展开为 <p-auth-guard :action="action">...</p-auth-guard>
        return ctx.helpers.wrapWith(node, 'p-auth-guard', { action });
      }
    },
  },
  configSchema: { /* ... */ },
});
```

### 5.2 组件库：注册 `<p-xxx>` 原生映射（buildIR + codegen）

```ts
export default definePlugin({
  name: 'my-ui-lib',
  hooks: {
    buildIR(ctx) {
      // 注册自定义组件 → IR 语义节点
      ctx.helpers.registerComponent('p-calendar', {
        platform: { ios: 'CalendarView', android: 'MaterialCalendar', harmony: 'Calendar' },
      });
    },
    codegen(ctx) {
      // 各端后端自动注入 usingComponents / import
      ctx.backend.registerNativeComponent('p-calendar');
    },
  },
});
```

### 5.3 安全审计插件（post）

```ts
export default definePlugin({
  name: 'proteus-plugin-security-audit',
  enforce: 'post',
  hooks: {
    post(ctx) {
      const findings = scanForDangerousAPIs(ctx.report.ir);
      if (findings.length) ctx.warn('SEC001', `发现 ${findings.length} 处危险 API`);
      ctx.report.writeJson('security-report.json', findings);
    },
  },
});
```

---

## 六、对齐 Architecture 原则

| 原则 | 本方案如何对齐 |
|------|--------------|
| **#10 统一语义 + 原生实现** | 插件操作**统一 IR**，不直接操作各端产物；codegen 钩子按 `platform` 分支映射原生 |
| **编译透明** | 每条插件规则 JSDoc 化，`--trace-transform <plugin>` 可追踪 |
| **AI-native** | 插件契约 = AI 可读写的"编译器说明书" |
| **Style Safety(G-16)** | `transform` 钩子经过 Validator，非法样式值在插件阶段即被拦截 |
| **App Config(G-20)** | 插件 `configSchema` 校验，配置走 `proteus.config`（构建期） |

---

## 七、验收标准

- [ ] 六个阶段钩子全部有类型定义 + 单测 + 集成测试
- [ ] 旧 `TransformPlugin` 自动适配为 `transform` 钩子，回归测试通过
- [ ] 插件可独立 disabled / 排序 / dependsOn，不破坏其他插件
- [ ] `--trace-transform <plugin>` 定位到源码行 + 产物位置
- [ ] 插件超时/错误隔离 + 降级行为符合预算
- [ ] 插件发布规范（命名 `proteus-plugin-*`、package.json `proteusPlugin` 字段、types）
- [ ] AI 能基于 JSDoc 新增一个插件并通过测试

---

## 八、依赖与影响

- **依赖**：Compiler B1、Types v2、Architecture 原则 #10、Style Safety(G-16)、App Config(G-20)
- **被依赖**：所有业务插件、组件库、未来 target 后端
- **影响**：升级现有 `04-transform-plugin.md`（保留 transform 子集，向后兼容）

> 详见 `02-hooks-lifecycle.md`、`03-plugin-api.md`、`04-compat-migration.md`、`05-plugin-publish.md` 等配套文档。
