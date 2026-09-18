# G-49 小程序运行时进程级沙箱隔离

> 原则 #0 第 13 次泛化：**不绑定隔离强度**（IsolationLevel L1-L4）
> 状态：Draft v1 · 依赖 G-27 / G-39 / G-42 / G-43 / G-45 / G-46 / G-47 / G-48
> 后继：G-50（小程序开发者平台，**以 G-49 L3 落地为硬前置**）

## 一句话

G-48 把标准小程序跑起来了（AppID 级逻辑隔离）；**G-49 让"一个恶意小程序"无法拖垮宿主或其他小程序**——
通过分层隔离（L1 逻辑 / L2 存储权限 / L3 进程）+ 声明式权限网关（CapabilityBridge）。

## 文档结构

| 文件 | 作用 |
|------|------|
| `01-problem.md` | 定位、分层决策、与前序 plan 关系、诚实边界 |
| `03-spi.md` | IsolationLevel / SandboxBackend / CapabilityBridge / ResourceQuota + 后端矩阵 |
| `conformance.md` | SBX-01~08 不变量 + 负向自检 + 三平台矩阵 |
| `reference-impl.cjs` | 可运行参考实现（**30/30 PASS**） |
| `verify.sh` | 自包含验证（**14/14 PASS**，含负向自检） |
| `rules.md` | 铁律 G-49.1-6 + CMP-110~117 + 反模式 |
| `architecture-update.md` | 原则 #13.41-45 + L0-L6 + 与 G 表互校 |
| `README.md` | 本入口（快速开始 / 文件清单 / 诚实边界） |
| `MANIFEST` / `pack.sh` | 清单 + 安全打包（本包不产出 `CHECKSUM` 文件） |

> 注：本包**无独立 `02-architecture.md`**（文档结构从 01 直跳 03）——架构承接细节并入 `01-problem.md` 与 `architecture-update.md`。

## 三步验证

```bash
cd docs/proteus-sandbox-isolation-plan
node reference-impl.cjs   # → 30/30 PASS
bash verify.sh             # → 14/14 PASS（含负向自检）
```

## 诚实边界（先读）

- **G-49 = L1 + L2 + L3**。L4（V8 Isolate / microVM）**明确留给 G-50**
- **不承诺三平台机制一致，只承诺隔离语义等价**（iOS 进程隔离靠系统 WebContent，不由应用控制 — CMP-117）
- **WebBackend 仅用于 conformance 测试**，不可用于生产运行不可信代码
- 详见 `01-problem.md` §4 与 `03-spi.md` 后端矩阵

## 关键设计判断

**不用 `addJavascriptInterface` 暴露原生对象**（业界 9/10 审计踩坑点），
改用 **CapabilityBridge 声明式消息通道**：小程序只走序列化消息，XSS 无法拿到原生句柄。
