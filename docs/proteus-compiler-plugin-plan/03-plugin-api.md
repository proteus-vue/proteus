# Plugin API 参考（G-21）

> 面向插件作者的**官方稳定 API**。遵循 semver：公开 API 不破改（minor 新增钩子，major 才移除）。

## 一、创建插件：`definePlugin`

```ts
import { definePlugin, type CompilerPlugin } from '@proteus-vue/compiler-core';

export default definePlugin({
  name: 'proteus-plugin-demo',
  version: '1.0.0',
  enforce: 'default',
  hooks: { /* ... */ },
  configSchema: { /* JSONSchema */ },
});
```

`definePlugin` 作用：
- 类型推断（`PluginHooks` 自动补全）
- 校验必填字段
- 标记插件身份（运行时识别，避免普通对象混入）

## 二、BaseContext API

```ts
interface BaseContext {
  file: SourceFile;            // path, ext, source, ast?（若有）
  platform: Platform;          // 'web'|'skyline'|'ios'|'android'|'harmony'
  options: Readonly<ProteusConfig>;   // 构建期配置（只读）
  appConfig: Readonly<AppConfig>;     // 运行时配置快照（G-20）
  helpers: HelperRegistry;      // 共享辅助函数
  cache: PluginCache;           // 持久缓存
  warn(code: string, msg: string, loc?: SourceLocation): void;
  error(code: string, msg: string, loc?: SourceLocation): never;
  addDependency(file: string): void;
  emitFile(file: OutputFile): void;
}
```

### `cache` 缓存 API

```ts
interface PluginCache {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T): void;
  has(key: string): boolean;
  delete(key: string): boolean;
  /** 自动按 (pluginName, platform, fileHash) 命名空间，无需手动前缀 */
}
```

### `helpers` 注册表

```ts
interface HelperRegistry {
  register(name: string, fn: (...args: any[]) => any): void;
  get(name: string): Function | undefined;
  /** 内置：节点包装/替换（transform 常用） */
  wrapWith(node: IRNode, tag: string, props?: Record<string, unknown>): IRNode;
}
```

## 三、各阶段专用 API

| 阶段 | 关键 API |
|------|---------|
| `parse` | `parseTemplate(s)` / `parseScript(s)` / `skipDefaultParse()` |
| `buildIR` | `createNode(type, props)` / `visit(visitor)` / `registerComponent(name, def)` |
| `transform` | `replaceNode(n)`（沿用旧 `TransformPlugin`，纯函数） |
| `codegen` | `backend` / `overrideBackend(b)` / `registerNativeComponent(name)` / `addHelper(name, code)` |
| `emit` | `outputs`(Map) / `patchOutput(path, mutator)` / `emitFile(f)` |
| `post` | `report` / `generateDts(decls)` / `writeReport(name, data)` |

## 四、插件配置：`configSchema`

```ts
// 插件定义侧
export default definePlugin({
  name: 'proteus-plugin-analytics',
  configSchema: {
    type: 'object',
    properties: {
      trackClicks: { type: 'boolean', default: true },
      endpoint: { type: 'string', format: 'uri' },
    },
    required: ['endpoint'],
  },
  hooks: { /* ... */ },
});
```

```ts
// 用户侧（proteus.config.ts）
export default defineProteus({
  compiler: {
    plugins: [
      ['proteus-plugin-analytics', { endpoint: 'https://a.example.com' }],
    ],
  },
});
```

Compiler 在启动期：
1. 用 `configSchema` 校验用户传入配置 → 非法 → error（fail-fast）
2. 自动补全默认值
3. 将合并后 config 注入 `ctx.options.plugins[name]`

## 五、向后兼容：旧 `TransformPlugin` 适配

```ts
// 旧 API（仍可用）
interface TransformPlugin {
  name: string;
  enforce?: 'pre' | 'post';
  transform(node: IRNode, ctx: TransformContext): IRNode | void;
}

// 自动适配：Compiler 把 TransformPlugin 包装为 CompilerPlugin
function toCompilerPlugin(p: TransformPlugin): CompilerPlugin {
  return {
    name: p.name,
    version: '0.0.0-legacy',
    enforce: p.enforce,
    hooks: { transform: p.transform }, // ← 仅挂 transform 钩子
  };
}
```

> 旧规则文件（如 `transforms/v-if.ts`）**无需修改**，直接注册到 `compiler.plugins` 即可。

## 六、插件间通信

- **推荐**：通过共享 `helpers` 注册表（显式、可追踪）
- **不推荐**：全局变量 / 闭包（破坏隔离、难调试）
- **事件**（高级，可选）：`ctx.on('ir:built', listener)` / `ctx.emit('my-event', data)`

## 七、API 稳定性等级

| 等级 | 标记 | 承诺 |
|------|------|------|
| Stable | 无标记 | semver 稳定 |
| Experimental | `@experimental` | 可能变更，需显式 opt-in |
| Internal | `_` 前缀 | 不对外，随时改 |

---

> 完整类型见 `packages/compiler-core/src/plugin.ts`（实现阶段生成）。
