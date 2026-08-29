# M2/M4 Transform 插件系统

> "透明编译 + AI-native" 的核心落地：**每条编译规则一个文件，AI 能读、能改、能排查**。本章定义 transform 插件契约。

## 一、插件接口

```ts
// packages/compiler-core/src/transform.ts
export interface TransformPlugin {
  name: string;
  enforce?: 'pre' | 'post'; // 执行顺序
  transform(node: IRNode, ctx: TransformContext): IRNode | void;
}
```

- `transform` 是**纯函数**：输入节点 → 返回新节点（或原地修改）
- 不执行 IO、不依赖全局状态 → 便于单测 + AI 生成
- 多个插件按 `enforce` + 注册顺序 compose

## 二、Context 提供的能力

```ts
export interface TransformContext {
  warn(msg: string, loc?: SourceLocation): void;  // → --trace-transform
  error(msg: string, loc?: SourceLocation): never;
  helpers: HelperMap;       // 共享辅助函数
  options: ProteusConfig;   // 全局配置
  platform: Platform;       // 当前目标端
}
```

`warn`/`error` 自动带上源码位置 + 规则名，输出到 `--trace-transform` 链。

## 三、规则文件规范（AI 可读契约）

每个 transform 一个文件 + JSDoc：

```ts
// transforms/v-if.ts
/**
 * @id v-if
 * @source Vue template `v-if / v-else-if / v-else`
 * @target Skyline `<view wx:if / wx:elif / wx:else>`
 *          Web: 保留 Vue 原生 render（Web 后端透传）
 *
 * ## Input
 *   <view v-if="show" v-else-if="loading">...</view>
 *
 * ## Output (Skyline)
 *   <view wx:if="{{show}}" wx:elif="{{loading}}">...</view>
 *
 * ## Constraints
 * - Skyline: glass-easel 不支持 <template> 根节点多分支，
 *   编译器自动包裹 <block> 容器
 * - 必须配合 `wx:key`（v-for 场景），缺失则 warn
 *
 * ## Trace
 *   --trace-transform v-if
 */
export const vIfTransform: TransformPlugin = {
  name: 'v-if',
  transform(node, ctx) {
    if (node.type !== 'Element') return;
    // ...映射逻辑
    ctx.warn('v-if-on-root', node.loc); // 示例告警
    return node;
  },
};
```

**这是给 AI 的"编译器说明书"**：AI 读 `transforms/` 目录即可理解全部映射规则，并能安全新增规则。

## 四、内置规则目录（首批）

| 文件 | 规则 | Skyline 约束 |
|------|------|--------------|
| `v-if.ts` | v-if/else-if/else → wx:if/elif/else | 根节点多分支包裹 block |
| `v-for.ts` | v-for → wx:for + wx:key | 缺 key 强制报错 |
| `v-bind.ts` | :class/:style → mustache | class 合并语义 |
| `v-on.ts` | @click → bindtap | 事件名映射表 |
| `v-model.ts` | v-model → value+bindinput | — |
| `slot.ts` | slot → <slot> | 具名 slot |
| `scoped-style.ts` | scoped CSS 哈希 | data-v 属性 |
| `route-block.ts` | `<route>` → page meta | 路由层 M2 |
| `appbar-wrapper.ts` | rootComponents 包裹 | Component 层 appBar |
| `global-component.ts` | app.component → usingComponents | Component 层全局注册 |
| `worklet.ts` | `"worklet";` 函数标记 | Skyline Worklet 桥 |

## 五、配置驱动 + 规则可关

```ts
// proteus.config.ts
export default defineConfig({
  compiler: {
    transforms: {
      'v-for': { disabled: false, options: { requireKey: true } },
      'scoped-style': { disabled: false },
      // 业务可关掉某条规则回退原生写法
    },
  },
});
```

**透明原则**：每条规则独立可关，关闭后走原生 WXML 写法，不静默 polyfill。

## 六、插件注册顺序

```
[pre] 平台无关语法展开（v-if/v-for 解析）
 ↓
[default] 语义映射（DOM → 平台节点）
 ↓
[post] 平台特定优化（Skyline 包裹、wx:key 注入）
```

顺序错误会导致规则互相覆盖 → 必须有明确 enforce 约定 + 集成测试。

## 七、验收

- [ ] 每条规则有 JSDoc + Input/Output + 单测
- [ ] `--trace-transform <rule-id>` 能定位到源码行 + 产物位置
- [ ] 规则可独立 disabled 且不破坏其他规则
- [ ] AI 能基于 JSDoc 新增一条规则并通过测试
