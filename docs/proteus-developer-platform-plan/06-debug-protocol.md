# 06 调试协议（A3）

> 接续 `05-project-scaffold.md`。**复用 devtools 系列（`proteus-devtools-plan` 的 TraceBus +
> `proteus-devtools-plus-plan`（官方 G-34）的 HMR & DevTools 协议）**，扩展为平台化调试协议——
> 并**桥接 G-49 Sandbox 的诊断能力**（隔离/配额/崩溃）。

---

## 1. 复用 devtools-plan 的 TraceBus

devtools-plan 已定义：
- **TraceBus**：进程内事件总线，六层通过 `useTrace()` 上报，UI 只订阅，零耦合
- **事件协议**：`{ source, phase, name, payload, timestamp, traceId, spanId }`
- **采样**：默认全量，生产按 `sampleRate` 降采样，异常自动全量

G-50 **直接复用**，不重新定义——只扩展事件源。

---

## 2. 新增事件源（平台侧）

| 事件源 | 事件 | 用途 |
|--------|------|------|
| `platform.runtime` | AppPackage 加载/卸载 | 调试多租户生命周期 |
| `platform.sandbox` | **隔离创建/配额超限/ISOLATION_BREACH** | ★ 桥接 G-49 诊断 |
| `platform.capability` | capability 调用/拒绝 | 调试权限策略 |
| `platform.publish` | 构建/审计/发布流程 | 调试 CI/CD |

**G-49 的诊断能力通过 `platform.sandbox` 暴露**：开发者可在 DevTools 里看到
"为什么我的小程序被配额限制了"、"隔离边界在哪"。

---

## 3. 调试通道（复用 devtools-plus（G-34）协议层）

```
小程序 (AppService) ──postMessage──▶ HostRuntime ──WebSocket──▶ DevTools UI
                                          │
                                     (G-49 Sandbox 诊断注入)
```

**复用 devtools 系列（G-34）的 JSI 调试架构** + **G-48 的双线程通信（setData）**——调试协议与运行时**共用消息通道**。

---

## 4. DevTools UI 扩展（devtools-plan M3-M7 + 平台面板）

| 面板 | devtools 已有 | G-50 新增 |
|------|:---------:|:---------:|
| 时间轴/泳道 | ✅ | — |
| 状态快照/时间旅行 | ✅ | — |
| 路由回溯 | ✅ | — |
| 性能火焰图 | ✅ | — |
| 异常根因 | ✅ | — |
| **隔离/配额面板** | ❌ | ★ G-49 |
| **能力/权限面板** | ❌ | ★ Capability IR |
| **发布流水线面板** | ❌ | ★ publish 状态 |

---

## 5. 隐私与脱敏（沿用 devtools-plan 隐私脱敏铁律）

> payload 自动剔除 `password/token/Authorization/idCard/phone`；
> **G-50 扩展**：剔除**应用密钥 / 签名私钥**（开发者门户相关，见 09）。

---

## 6. conformance 断言

- `DBG-01`：TraceBus 事件可被 DevTools 完整订阅（六源 + 平台源）
- `DBG-02`：G-49 ISOLATION_BREACH 事件可追溯到具体 packageId
- `DBG-03`：生产模式（`NODE_ENV=production`）下调试通道默认关闭（沿用 devtools-plan 铁律：生产态关闭调试通道）

---

*下一份：`07-component-toolkit.md`（A4：组件/能力脚手架，基于 G-48 Capability IR 生成）。*
