# Proteus 性能深度优化落地文档

> 版本：v1.0
> 状态：✅ 落地
> 对齐：全局规约 `proteus-architecture`、G-30 性能优化阶段
>
> ---
> ### ★本目录含**两批**内容（主题不同，按需查阅）
>
> | 批次 | 编号 | 主题 | 状态 |
> |---|---|---|---|
> | **A 批（2026-08）** | `01`–`08` | **启动性能**：AOT 预编译 / 静态首帧 IFR / Worklet / 三端启动差异化 | 计划（G-30，待 App Renderer 稳定后启动） |
> | **B 批（2026-09）** | `00`·`09`·`10` | **渲染路线与内存**：iOS 真机实测（假设验证 / 内存三层定位 / 拍平路线） | ✅ **已实测**（真机 iPhone 12，可复跑） |
> | **C 批（2026-10）** | `11`–`14` | **内核布局/编译/输入**：DCP-1 布局引擎 · 文本表达式 · C3 编译基线 · **★输入与桥延迟** | ◐ 进行中（**14 = 当前主攻**） |
>
> **★C 批 14（输入与桥延迟）是当前主攻方向**——渲染成本已全面优于原生（L1 ratio 0.344/0.111/0.100），
> 最大缺口在**输入链路**（`gfxinfo` 的 `High input latency` 计数 ≈ 帧数 2×）。它一通，`v-model` 回写等
> 一切"过桥"能力都水到渠成。入口：`14-input-bridge-latency.md`。
>
> B 批是**开工前验证**：把「App 端高性能渲染落地方案」（`docs/Proteus_App端高性能渲染落地方案.md`）
> 押在 iOS 侧的假设逐条实测，**推翻 2 条、修正 1 条、证实 2 条**。
>
> **入口**：先看 `00-baseline-and-roadmap.md`（总纲与优先级）→
> `09-ios-route-validation.md`（假设验证）→ `10-ios-memory.md`（内存专项）

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
| **`00-baseline-and-roadmap.md`** | **★B 批总纲**：iOS 实测基线（启动/运行时/跨界调用）+ 四家框架对照 + 优先级 |
| `01-research.md` | 性能深度调研：首屏成本拆解 + Lynx/RN 对标 + 四大机制 + 诚实边界 |
| `02-strategy.md` | 性能优化策略总纲：四大机制完整设计 + 性能预算 |
| `03-aot-codegen.md` | AOT 预编译：指令格式 + Compiler 集成 + 运行时消费 |
| `04-ifr-static-first-frame.md` | 静态首帧 (IFR)：三阶段协议 + 接管 (避免闪烁) |
| `05-worklet.md` | UI 线程 Worklet 隔离：原语 + 线程模型 + p-* 内置 |
| `06-per-end-startup.md` | 三端启动优化：Web / Skyline / App 差异化策略 |
| `07-benchmark-baseline.md` | 性能对标基线：Lynx/RN/uni-app + 真机基准方法 |
| `08-batches.md` | 分批策略 (B0-B5) + Prompt 模板 + 验收 |
| **`09-ios-route-validation.md`** | **★B 批：开工前假设验证**——H1–H5 逐条实测（H3/H4 被证伪）+ 四路线耗时×内存对比 |
| **`10-ios-memory.md`** | **★B 批：iOS 内存专项**——11 变体三层隔离（主因是 CATextLayer 非 CALayer）+ 修复排序 + 真/假拍平判据 |
| `11-dcp1-layout-engine.md` | C 批：DCP-1 布局引擎选型（taffy 0.14 定案） |
| `12-dcp-i4-text-expression.md` | C 批：文本表达式 I4 |
| `13-c3-compile-baseline.md` | C 批：C3 编译基线 |
| **`14-input-bridge-latency.md`** | **★C 批·主攻：输入与桥延迟**——9 段物理链路模型 + 六条腿（S1 输入旁路 / S2 零拷贝 / S3 编译期交互下沉 / S4 线程解耦 / S5 Harmony 专项 / S6 度量门禁）+ 对标六框架 |

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
  > ★**B 批已实测修正（2026-09-29）**：iOS 侧**渲染层**内存可通过**拍平**大幅优化
  > （4050 元素：186.7MB → **17.7MB，−91%**，且耗时同时降 32%）——即「不劣化」的目标已超额达成，
  > 详见 `10-ios-memory.md`。但**逻辑层**（Vue+V8）的内存基线未变，此条仍适用。
- **静态首帧**：强依赖异步数据的页面收益有限，需骨架屏 + 预取配合
- **Worklet 学习成本**：p-* 组件内置，业务默认零感知
