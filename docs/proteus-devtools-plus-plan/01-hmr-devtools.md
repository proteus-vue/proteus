# HMR & DevTools —— JSI 架构下的热更新与调试

> 执行位：**G-19**（P0）· 第 35 份 plan
> 依赖：`proteus-compiler-plan`（增量编译）、`proteus-cli`（G-18）、`proteus-style-safety`（G-16）、Architecture 原则 #10
> 目标：**JSI 直调架构下实现毫秒级 HMR + 透明调试**，让"编译透明"原则（原则 #3）落到开发体验。

---

## 1. 问题定义

### 1.1 HMR 在 JSI 架构的特殊性

传统 Web HMR：替换 JS 模块 → 局部重新渲染（DOM）。
**JSI 直调**：业务是 JS/Vue，但**原生侧有状态**（UIView 树、JSI HostObject、原生缓存）。

挑战：
- HMR 不能重建整个原生页面（会闪屏、丢状态）
- 只更新变化的组件 → 增量 patch 到原生 View
- 原生模块（JSI binding）变更需安全 reload

### 1.2 竞品现状

| 方案 | HMR | DevTools | 缺陷 |
|------|-----|----------|------|
| uni-app | HBuilderX 真机同步 | 内置 | 黑盒，仅 WebView |
| RN | Fast Refresh | Flipper (已弃) / React DevTools | JS 层为主，原生桥 reload 慢 |
| Flutter | Hot Reload / Hot Restart | DevTools | 自绘，状态保留好但重启慢 |
| Vite | HMR (毫秒级) | 浏览器 | ✅ 标杆 |

**Proteus 目标**：Vite 的 HMR 速度 + Flutter 的状态保留 + 原生层可见。

---

## 2. HMR 设计（三层）

### 2.1 层 1：Compiler 增量编译

- SFC 改动 → 只编译受影响模块 → 产出增量 IR chunk
- 联动 Compiler B1 的 `--watch` + TraceBus

### 2.2 层 2：Runtime 模块热替换

```
开发者保存文件
    ↓ Compiler 增量编译（毫秒）
增量 IR chunk + HMR payload
    ↓ WebSocket 推送到客户端
Runtime HMR Runtime
    ↓ Vue Reconciler 计算最小 patch
    ↓ Custom Renderer patch（复用 Style Safety Validator）
原生 View 增量更新（不重建整树）
```

**关键**：走 Vue 的 HMR API（`import.meta.hot`），**组件替换保持状态**（Flutter Hot Reload 同款体验）。

### 2.3 层 3：原生侧安全 reload

- **JSI binding 变更**（如新增原生方法）：无法热替换 → 触发**安全 reload**
  - 保存当前路由栈 + 页面状态 → reload → 恢复（联动 Router G-17 栈序列化）
- **原生资源变更**（图片/字体）：热替换资源缓存

---

## 3. DevTools 协议

### 3.1 复用 Chrome DevTools Protocol (CDP)

- 桥接层：Runtime ↔ CDP
- Vue DevTools：**适配 Custom Renderer** —— 组件树 = 原生 View 树的可视化（这是差异化）

### 3.2 Style Safety 可视化（差异化）

DevTools 面板实时显示：
- 每条样式经哪个闸门放行（语义层/编译推导/运行时/原生闸门）
- 被拒绝/降级的样式（联动 G-16）
- 各端原生值映射

> **这是"编译透明"原则的直接体验** —— 开发者能看到框架在背后做了什么。

### 3.3 原生视图检查器

- 选中组件 → 高亮对应原生 View（iOS View Debugging / Layout Inspector 风格）
- 查看 JSI HostObject 引用关系（联动 Memory Plan G-06 LeakRegistry）

---

## 4. 调试协议

```
DevTools (Chrome)  ←CDP→  Debug Bridge (Node)  ←WS→  App Runtime
                                              ↓
                                         JSI ↔ Native
```

- Web/Skyline：直接 CDP
- iOS/Android/鸿蒙：通过 WebSocket Debug Bridge 转发

---

## 5. 严格规则（--strict-hmr）

| 编号 | 规则 | 处理 |
|------|------|------|
| HMR001 | HMR 期间不允许副作用未清理 | warn + 建议 disposer |
| HMR002 | 原生 binding 变更必须安全 reload | 自动 |
| HMR003 | 状态丢失检测（对比 reload 前后） | warn |

---

## 6. 性能预算

| 指标 | 预算 |
|------|------|
| HMR 编译耗时 | < 50ms |
| HMR 推送到渲染 | < 100ms |
| 安全 reload | < 2s |
| DevTools 开销 | < 5% CPU |

---

## 7. 分批策略

| 批次 | 内容 | 依赖 | 可单测 |
|------|------|------|--------|
| **M1** | HMR Runtime + WebSocket + Vue HMR 适配 | Compiler B1, CLI M1 | ✅（Web 端） |
| **M2** | DevTools 桥接（CDP + Style Safety 可视化） | CLI M2 | ✅ |
| **M3** | 原生侧安全 reload（iOS/Android/鸿蒙） | App Renderer M2/M3 | 🔶 |
| **M4** | 原生视图检查器 + LeakRegistry 集成 | Memory M4 | 🔶 |

**M1 零依赖可单测** —— Web 端 HMR 纯逻辑，可用 jsdom 验证 patch 正确性。

---

## 8. 对标

| 能力 | uni-app | RN | Flutter | Vite | **Proteus** |
|------|---------|----|---------|----|----|------|
| 毫秒级 HMR | ⚠️ | ✅ Fast Refresh | ✅ | ✅ | ✅ |
| 状态保留 | ⚠️ | ✅ | ✅ | ✅ | ✅ |
| 原生层可见 | ❌ | ❌ | ⚠️ | — | ✅ |
| Style 可视化 | ❌ | ❌ | ❌ | ❌ | ✅ |
| 原生安全检查 | ❌ | ⚠️ | ❌ | — | ✅ |

**Proteus = 唯一在 JSI 原生架构下提供"透明调试 + Style Safety 可视化"的框架。**

---

## 9. 关联

- Compiler（增量）、CLI（dev server）、Style Safety（G-16 可视化）
- Memory（LeakRegistry 集成 DevTools）
- Router（栈序列化用于安全 reload）
- Architecture 原则 #3（编译透明）、#10
