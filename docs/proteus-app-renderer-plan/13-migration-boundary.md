# 13 明确不做项、迁移与 Roadmap

## 1. 明确不做（边界，诚实声明）

| 项目 | 原因 | 替代 |
|------|------|------|
| 国内 ROM 私有玻璃 API | 系统特权，App 调不到，不稳定 | L1 backdrop-filter |
| 放弃 SFC 模板改 JS 建 View | 破坏 Web/小程序一致性 | 保留 p-* + Renderer |
| 放弃 Web 优先战略 | App 是补充，双端是核心 | App 锦上添花 |
| 跨版本像素级一致 | 系统实现差异 | 语义一致 |
| 热更新 / 动态化 | 搁置（与 Testing plan 一致） | 后续 M9 |
| 多进程架构 | 搁置 | 后续评估 |

## 2. 与竞品的关键差异

| 维度 | uni-app App 端 | React Native | **Proteus App** |
|------|---------------|-------------|----------------|
| 编译透明度 | 黑盒 | 较透明 | ✅ `--trace-app` 全链路 |
| 类型系统 | 割裂 | Flow/TS | ✅ 全局 Registry + 自动生成 |
| 系统级玻璃 | CSS 层 | 需原生模块 | ✅ L3 JSI 直调 |
| Web 一致性 | 一般 | 两套 UI | ✅ 同一 SFC |
| 审计可观测 | 弱 | Flipper | ✅ audit + TraceBus |
| 测试基建 | 弱 | Detox | ✅ Vitest + automator + 真机 |

## 3. 迁移路径（从 uni-app / RN）

### 3.1 从 uni-app

```
1. 保留 SFC（.vue 文件 100% 复用）
2. 把 nvue / 原生插件 → Proteus App Renderer 扩展
3. 玻璃效果：<view style="backdrop-filter"> → <pg-glass>
4. 原生能力：plus.* → assertPlatform('app') + ProteusNative
```

### 3.2 从 React Native

```
1. JS 逻辑层可复用（Vue ↔ React 适配层可选）
2. Native Modules → invokeCapability
3. Bridge 调用 → JSI 同步调用（性能提升）
4. UI 组件 → p-* 映射
```

## 4. Roadmap

| 阶段 | 版本 | 内容 |
|------|------|------|
| v0.1 | M1-M2 | JSI + Renderer 骨架（可跑 demo） |
| v0.5 | M3-M5 | 基础组件 + 手势 + 动画 |
| v1.0 | M6-M8 | Glass L3 + 审计 + 稳定 |
| v1.x | — | 热更新 / 多进程 / 更多平台 |

## 5. 与全局的关系

- 依赖：Component（p-*）、Platform、Types、Compiler、Glass、DevTools
- 被依赖：Blueprint（App 端 150 页验证路径）、Website（App 展示）
- CI：纳入 `proteus-architecture` 的 consistency 校验

## 6. 参考实现论证（附录 A）

> **核心参照：NativeScript-Vue（开源，Apache 2.0 / MIT 系宽松协议）**
> 详见 [`14-reference-nativescript-vue.md`](./14-reference-nativescript-vue.md) —— 十项代码级借鉴点 + 开源合规边界 + 可行性论证（P1/P2 已被开源实现证真）。

**可行性结论（评审要点）**：

- ✅ **已被证真**：① Vue 自定义渲染器可输出到 Native View；② JS 可直调 100% Native API（无 bridge 序列化）
- 🔶 **待 M1 验证**：③ IR 骨架统一 Web/Skyline/App（设计无阻塞项）
- 🔶 **待 Performance plan**：④ AOT + IFR 首帧直出
- 🔶 **待 M3 + Glass plan**：⑤ `<pg-glass>` L3 系统级质感

> P1/P2 不承担探索风险 → App 端可先做 M1-M2 交付"可弹 Native View"demo，再增量叠加 P3-P5（最小验证优先）。

至此，App 渲染器方案完整闭环。
