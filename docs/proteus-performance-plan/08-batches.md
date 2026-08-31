# 分批策略与 Prompt 模板

> 对齐：`proteus-architecture` G-30、全局铁律
> 执行位：**G-30（性能优化阶段，App Renderer G-22 稳定后启动）**

---

## 1. 分批总览

| 批次 | 内容 | 依赖 | 交付 |
|------|------|------|------|
| **B0** | 性能基线与测量基建 | - | `proteus bench` + 真机矩阵 |
| **B1** | AOT 预编译 + JSI 预热 | B0 | codegen + 预热脚本 |
| **B2** | 静态首帧 (IFR) + 接管协议 | B1, App Renderer M3 | 首帧 <200ms |
| **B3** | UI Worklet 隔离 | B1 | worklet runtime + p-* 内置 |
| **B4** | 三端启动优化 + 审计集成 | B1-B3 | `proteus audit performance` |
| **B5** | 基准回归 + CI 门禁 | B4 | 自动化防护 |

**并行空间**：B1/B0 串行；B3 可与 B2 并行；B4/B5 在 B1-B3 后。

---

## 2. 里程碑

```
G-30.1  B0+B1 完成 → AOT 产物正确, T5<5ms
G-30.2  B2 完成   → 静态首帧 <200ms, 接管无闪烁
G-30.3  B3 完成   → Worklet 手势 60fps
G-30.4  B4+B5 完成 → 三端审计 + CI 门禁
         ↓
      性能上限拔高完成, 对标 Lynx IFR
```

---

## 3. Prompt 模板

### B1: AOT 预编译

```
你是 Proteus Compiler 工程师。基于以下 IR 设计：
- 输入: SFC (.vue) → 已有 compileToIR()
- 输出: NativeInstruction[] 二进制 (opcode u8 + type u16 + props)

实现 packages/compiler/src/codegen/aot.ts:
1. generateAOT(ir): Uint8Array — 编码 CreateView/SetProp/AppendChild
2. 属性字典编码 (复用 prop schema)
3. 对齐 --trace-transform (输出 IR→指令映射)
4. 单测: SFC → AOT → 反序列化 → 与 Vue 运行时渲染结果 diff 一致

铁律: AOT 指令执行结果必须 == Vue 运行时渲染结果。
```

### B2: 静态首帧

```
你是 App Renderer 工程师。实现 IFR 三阶段协议:
1. 阶段 A: mountAOT(aot, root, jsi) — 绕过 Vue, 直接建 Native View
2. 阶段 B: bootstrapVue() — 后台并行
3. 阶段 C: reconcile(vueTree, nativeTree) — key 一致, >90% noop

约束: AOT 与 Vue 节点 key 必须一致 (同份 SFC 编译)。
验收: 真机首帧 <200ms, 接管无闪烁 (录屏对比)。
```

### B3: Worklet

```
你是 Runtime 工程师。实现 UI 线程 worklet:
1. worklet() 原语 + 'use worklet' 指令识别
2. Compiler 提取 worklet 函数体 → 注册到 UI runtime
3. runOnJS() 回 JS 线程
4. p-* 组件默认事件 (scroll/pan) 自动走 worklet

约束: worklet 内不可访问 Vue 响应式; 参数可序列化。
验收: 长列表 ≥58fps, 手势 120fps, TraceBus 可视化。
```

### B0: 基准基建

```
你是 DevTools 工程师。实现性能基准:
1. PerfMetrics 采集 (startup/tti/fps/jsi/memory/bundle)
2. 真机矩阵 (iOS/Android/鸿蒙, 高/中/低)
3. `proteus bench --scenario=...` CLI
4. 结果对比基线, 回归 >5% 阻断

对齐 app-renderer/10-audit-performance.md。
```

---

## 4. 验收（G-30 完成标准）

- [ ] AOT 产物正确 + T5 <5ms
- [ ] 静态首帧 <200ms（3 端真机）
- [ ] 接管无闪烁
- [ ] Worklet 手势 60fps
- [ ] 三端启动性能达标（Web/Skyline/App）
- [ ] `proteus audit performance` + CI 门禁
- [ ] 对标矩阵更新（追平 Lynx 首帧）

---

## 5. 风险与降级

| 风险 | 降级 |
|------|------|
| AOT 产物体积膨胀 | 按需加载 + gzip |
| 静态首帧数据依赖 | 骨架屏 + 预取 |
| Worklet 复杂度 | p-* 内置, 业务零感知 |
| 接管闪烁 | key 一致性 + 保底重建 |

详见 `01-research.md` §6。
