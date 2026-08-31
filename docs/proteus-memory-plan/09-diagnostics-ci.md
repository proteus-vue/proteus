# 诊断工具与 CI 门禁

> 目标：**让泄漏从偶发现象 → 可阻断的回归**。

---

## `proteus memory` CLI

### 标准场景（基准脚本）

```
打开页面
  → 滚动列表至底部
  → 打开 WebView / Skyline 页面
  → 播放 30s 动画
  → 触发 HMR 热替换
  → 返回（页面销毁）
  → 重复 20 次
```

### 采集指标

| 指标 | 来源 |
|------|------|
| Java Heap | Android：`dumpsys meminfo` / Android Studio Profile |
| Native Heap | `malloc` 统计 / LeakCanary |
| JS Heap | V8 heap snapshot / Hermes snapshot |
| GPU / Graphics | `gfxinfo` / Xcode GPU 报告 / 鸿蒙 Graphics 工具 |
| PSS / RSS | `dumpsys meminfo` / `ps` / Xcode |
| 活跃资源计数 | LeakRegistry（cell / 页面 / WebView / Timer / Subscription / JSI peer / GPU 资源） |

### 输出

- 内存曲线图（前后基线对比）
- 峰值报告（帧峰值 / 页面峰值 / 全局峰值）
- **retainer 链报告**（对未回收对象，输出引用根 + 距离 + retained size）
- `afterDestroy` 断言结果

---

## `ProteusMemoryPanel`（运行时面板）

调试模式下挂载（DevTools / Website Playground）：

```
┌─ Proteus Memory Panel ─────────────────┐
│  Page:     2 active                    │
│  Cells:    15 (pool: 40)               │
│  Images:   128 / 256 MB (budget)       │
│  Timers:   7                           │
│  Subs:     23                          │
│  JSI Peer: 41 (epoch=12)              │
│  GPU:      shaders=8 textures=64       │
│  ── [ Take Heap Snapshot ] ──          │
│  ── [ Force GC ] ──                    │
│  ── [ Show Retainers ] ──              │
└────────────────────────────────────────┘
```

→ "退出页面后仍存活的对象"**可直接定位到代码位置**（配合 source map）。

---

## CI 门禁

在 `consistency.yml` 基础上新增 `memory` job：

```yaml
memory:
  runs-on: [self-hosted, ios, android, harmony]
  steps:
    - run: pnpm proteus memory --scenario repeat-nav --times 20
    - run: pnpm proteus audit memory
  # 失败条件（见下方验收门槛）
```

### 失败条件（阻断 PR）

1. **单调增长**：第 20 次稳定驻留 - 第 2 次稳定驻留 > 阈值（相对值，按设备 tier 缩放）
2. **残留对象**：`afterDestroy` 后存在强引用根（cell / 页面 / WebView / Timer / Subscription / JSI peer）
3. **预算超限**：峰值 > 设备分级预算
4. **构建期规则**：`V-FOR-NO-KEY` / `V-FOR-FULL-RENDER` / `LISTENER-NO-CLEANUP` / `GLOBAL-HOLD-VIEW`（详见 `05-recyclable-views.md`）

---

## 验收门槛（不虚构 MB 红线）

> 现有证据**不足以推导跨设备统一阈值**，故以**相对增长 + 残留对象**为主。

**在同一设备上、同一场景下**：

| 断言 | 标准 |
|------|------|
| 稳定驻留差值 | 第 20 次 - 第 2 次 ≈ 0（< 阈值） |
| 活跃计数归零 | cell / 页面 / WebView / Timer / Subscription / JSI peer = 0 或可解释 |
| GC 后基线回落 | 退出页面 + GC → 内存回到基线区间 |
| 峰值 | ≤ 设备分级预算 |

**"可解释"**指：确有跨页面共享资源（如 Shader 程序缓存、WebSocket 连接池），且已用引用计数管理——需在 PR 中显式说明。

---

## 分层真机矩阵

对齐 Performance plan（`proteus-performance-plan/07-benchmark-baseline.md`）扩展为**四堆**：

| 端 | 设备 tier | 采集 |
|----|----------|------|
| iOS | low / mid / high | Xcode Instruments (Allocations / Leaks / Memory Graph) |
| Android | low / mid / high | Android Studio + LeakCanary + `dumpsys meminfo` |
| 鸿蒙 | low / mid / high | DevEco Profiler + Graphics 工具 |
| Web | desktop / mobile | Chrome DevTools heap snapshot |
| Skyline（小程序） | - | 微信开发者工具 + `--trace-memory` |

**回归防护**：每次合并跑基准场景，内存曲线/活跃计数与**主干 baseline** diff，超阈值即阻断。

---

## 与 DevTools plan 对齐

- TraceBus 新增 `memory` 域：`resource:create` / `resource:dispose` / `page:teardown` / `epoch:revoke` / `budget:exceeded`
- 面板实时订阅，配合 `--trace-transform` 形成**编译期 + 运行时**双视角
