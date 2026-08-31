# 静态首帧 (IFR) 与运行时接管

> 对齐：`02-strategy.md` 机制 (2)、`03-aot-codegen.md`
> 批次：G-30 B2

---

## 1. 核心思想

**首屏绕过 Vue 响应式，用 AOT 预编译的静态 UI 描述直接建 Native View；等业务 JS 就绪后，Vue 增量接管。**

借鉴 Lynx IFR，但不照搬（Proteus 保留 Vue 生态）。

---

## 2. 三阶段协议

### 阶段 A：首帧直出（主线程, ~80-120ms）

```ts
// App 启动入口
function boot() {
  const aot = loadAOT('home')        // 预下载/内置
  mountAOT(aot, root, jsi)          // 直接 JSI 建 Native View
  // ✅ 此时首帧已显示, 不经过 Vue
}
```

**约束**：
- A 阶段**不能依赖响应式数据**（数据未就绪）
- 用**骨架屏 / 占位内容**，数据到位后接管填充

### 阶段 B：运行时初始化（后台线程, 与 A 并行）

```ts
// 并行执行 (Worker 或后台线程)
spawn(() => {
  bootstrapVue()        // Vue 启动 + 响应式
  loadBusinessJS()      // 业务 bundle
  hydrate(data)         // 注入数据
})
```

### 阶段 C：接管（A/B 都完成后）

```ts
// Vue 首屏渲染完成, 与 A 的静态 View 树 reconcile
function takeover() {
  const vueTree = renderVueApp()           // Vue 产出 VNode 树
  const nativeTree = getCurrentNativeTree() // A 阶段建的 View 树
  const patches = reconcile(vueTree, nativeTree)
  applyPatches(patches)                    // 仅差异走 JSI
}
```

---

## 3. 接管协议（关键：避免闪烁）

### 3.1 key 一致性

**AOT 与 Vue 必须用同一套节点标识**，否则 reconcile 时结构不匹配 → 闪烁。

```ts
// Compiler 保证: AOT 指令与 Vue 模板产物结构一致
// 因为两者都从同一份 SFC 编译, 天然 key 一致

// 例: <p-view key="header">...</p-view>
//   AOT: CreateView(type='p-view', key='header')
//   Vue: VNode(type='p-view', key='header')
//   → reconcile 匹配成功, 不重建
```

### 3.2 Patch 策略

```ts
type Patch =
  | { type: 'updateProp'; key: string; value: any }
  | { type: 'insertChild'; index: number; node: VNode }
  | { type: 'removeChild'; index: number }
  | { type: 'noop' }  // 结构一致, 跳过

function reconcile(vue: VNode, native: NativeView): Patch[] {
  if (vue.key === native.key && vue.type === native.type) {
    // 结构一致 → 只更新变化的属性
    return diffProps(vue.props, native.props)
  }
  // 结构不一致 → 重建 (罕见, 仅在动态 v-if 导致)
  return [{ type: 'replace', node: vue }]
}
```

**目标**：接管时 **>90% 节点 noop**，仅数据绑定属性更新 → 无闪烁。

---

## 4. 适用场景与限制

| 场景 | IFR 收益 | 说明 |
|------|---------|------|
| 静态首页/列表 | ✅ 极大 | 骨架屏直出, 数据后填 |
| 强依赖异步数据的页面 | ⚠️ 有限 | 首帧只能是骨架, 需 SSR/预取配合 |
| 登录态敏感的页面 | ⚠️ 需处理 | 接管前判断登录态 |
| 首屏动画 | ✅ | A 阶段可播预设动画 |

**最佳实践**：首屏用 `<pg-skeleton>` 占位 + IFR 直出，数据通过 `useFetch` 预取，接管时填充。

---

## 5. 与 Web / 小程序端的对照

| 端 | 首屏优化 (G-30 并行工作) |
|----|------------------------|
| **App** | **IFR 静态首帧 (本节)** |
| **Web** | 流式 SSR + 组件级懒加载 (`<Suspense>`) |
| **小程序 Skyline** | 分包预下载 + 首屏静态 WXML + 按需注入 |

三端**共享 SFC**，但首屏策略各走平台最强路径 → 差异化拔高。

---

## 6. 验收

- [ ] 阶段 A 首帧 <200ms（真机 3 端）
- [ ] 阶段 C 接管无视觉闪烁（录屏对比）
- [ ] key 一致性 100%（自动化 diff 测试）
- [ ] 异常降级：A 失败 → 直接走 B+C（保底可用）
- [ ] 对齐 `app-renderer/10-audit-performance` 的启动指标
