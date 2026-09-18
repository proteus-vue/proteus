# Proteus 性能深度优化落地文档

> 版本：v1.0
> 状态：✅ 落地
> 对齐：全局规约 `proteus-architecture`、G-30 性能优化阶段

---

## 目标

**把首屏启动从"约等于 RN 新架构"（~400ms）拔高到"逼近 Lynx IFR"（<200ms）**，同时对齐 RN/Lynx 的手势动画性能上限，保持 Proteus 在**三端同源 + 编译透明 + Glass L3** 维度的领先。

---

## 核心结论

1. **JSI 直调通道已与 RN Fabric 同档**（亚毫秒同步调用），高于 uni-app Bridge 一个数量级
2. **首屏慢的根因是串行链路**（Vue 启动 + Renderer mount + JSI 绑定），非 JSI 本身
3. **四大机制拔高上限**：
   - **AOT 预编译**（T5 → <5ms）
   - **静态首帧 IFR**（首帧 <200ms）
   - **JSI 预热 + 懒注册**（启动 60-120ms → ~20ms）
   - **UI Worklet 隔离**（手势/动画 60fps）
4. **三端各走平台最强路径**：Web(SSR+懒加载) / Skyline(分包+静态WXML) / App(AOT+IFR)

---

## 文件索引

| 文件 | 内容 |
|------|------|
| `01-research.md` | 性能深度调研：首屏成本拆解 + Lynx/RN 对标 + 四大机制 + 诚实边界 |
| `02-strategy.md` | 性能优化策略总纲：四大机制完整设计 + 性能预算 |
| `03-aot-codegen.md` | AOT 预编译：指令格式 + Compiler 集成 + 运行时消费 |
| `04-ifr-static-first-frame.md` | 静态首帧 (IFR)：三阶段协议 + 接管 (避免闪烁) |
| `05-worklet.md` | UI 线程 Worklet 隔离：原语 + 线程模型 + p-* 内置 |
| `06-per-end-startup.md` | 三端启动优化：Web / Skyline / App 差异化策略 |
| `07-benchmark-baseline.md` | 性能对标基线：Lynx/RN/uni-app + 真机基准方法 |
| `08-batches.md` | 分批策略 (B0-B5) + Prompt 模板 + 验收 |

---

## 快速理解（一页）

```
启动链路 (当前, 串行 ~400ms):
  T1引擎 → T2 Vue → T3 JSI → T4 bundle → T5 render → T6 mount → T7 显示

优化后 (并行 + AOT + IFR, <200ms):
  ┌─ AOT 指令 ──────────▶ JSI ▶ Native View (首帧, 绕过 Vue)  ~120ms
  └─ Vue 启动 (后台并行) ─────────────────────────────────────
  接管: Vue diff → 增量 JSI 更新 (key 一致, 无闪烁)

高频操作:
  JS 线程 ──▶ worklet ──▶ UI 线程 ──▶ JSI 同步调 Native  (60fps)
```

---

## 与现有体系对齐

- **App Renderer** (`proteus-app-renderer-plan`)：AOT/IFR/Worklet 是其性能子模块
- **Compiler**：AOT codegen 集成 `--trace-transform`
- **Glass**：Worklet 用于 Glass 动态形变（L3 系统级）
- **DevTools**：TraceBus 可视化 JSI/Worklet 调用链
- **Architecture 铁律**：跨层一致性、分层锁定、契约先行

---

## 执行位

**G-30（性能优化阶段）**，在 G-22 App Renderer 稳定后启动。

优先级：B1(AOT) → B2(IFR) → B3(Worklet) → B4/B5(审计+CI)

---

## 诚实边界

- **内存基线**：Vue+V8 大于 Lynx(PrimJS)，明确不做内存追平，只保证不劣化
- **静态首帧**：强依赖异步数据的页面收益有限，需骨架屏 + 预取配合
- **Worklet 学习成本**：p-* 组件内置，业务默认零感知
