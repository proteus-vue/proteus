# Proteus API 层抽象 — LLM 落地执行文档

> 配套：`proteus-pinia-plan/`（状态层）、`proteus-router-plan/`（路由层）
> 设计哲学：**透明编译 + AI-native + 产物可审计 + 分批可执行**

## 文档结构

```
proteus-api-plan/
├── README.md                          ← 本文件
├── 00-overview.md                     ← 分层模型 + 三端矩阵 + 里程碑 + 铁律
├── 01-a1-request.md                   ← A1 网络请求（P0·B1）
├── 02-a3-a4-storage-auth.md           ← A3 Storage + A4 Auth（P0·B2/B3）
├── 03-a8-navigator-device.md          ← A8 Navigator + A6 Device（P0/B5）
├── 04-p1-file-payment-ui.md           ← A2/A5/A9（P1·B5）
├── 05-p2-media-messaging-share.md     ← A7/A10/A11（P2·B6）
├── 06-m7-m8-reliability-observability.md ← 超级应用加固
└── 07-testing-migration-batches.md    ← 测试 + 迁移 + 分批 Prompt
```

## 快速理解

**核心思想**：业务代码只写 `api.xxx`，平台差异收敛在 `platforms/*/api/*.adapter.ts`。

**4 层架构**：
```
L4 业务  →  L3 标准 API（api.request/...）→  L2 适配器（wx/fetch/Native）
                                              ↓
                                        L1 平台原生（唯一允许 wx. 的位置）
```

**11 个能力域**：
- P0：`api.request` `api.storage` `api.auth` `api.navigator`
- P1：`api.file` `api.payment` `api.device` `api.ui`
- P2：`api.media` `api.messaging` `api.share`

**超级应用加固**（M7 + M8）：
- M7：CI 审计门禁 / 弱网韧性 / 并发控制 / 脱敏 / 降级 / 资源清理
- M8：调用链 Trace（关联 Pinia/Router）/ 监控 / DevTools / 灰度 / 录制回放

## 执行顺序

```
B1(Request) → B2(Storage) → B3(Auth) → B4(Navigator)
  → B5(P1 并行) → B6(P2) → B7(测试/迁移)
  → B8(M7 可靠性) → B9(M8 可观测)
```

**建议**：先只走 B1-B4（P0 骨架），与 Pinia M1-M6、Router B1-B7 同步推进。

## 与 Pinia / Router 的关系

| 层 | 职责 | 关键依赖 |
|----|------|---------|
| Pinia | 状态管理 + Storage 抽象 | — |
| Router | 路由配置 + 运行时导航 | Pinia（守卫读 auth）|
| API | 平台能力调用 | Pinia(M1 Storage) / Router(M5 Navigator) |

三者共享：`traceId` 链路、`--trace-*` 开关、`proteus audit` CI 门禁。

## 使用方式（防上下文撑爆）

每个 `.md` 是独立上下文单元。**喂 LLM 时一次只给**：
`README + 00-overview + 当前模块 + 直接依赖`

例如 B1 执行：`README.md` + `00-overview.md` + `01-a1-request.md`
（每份 ≤ 适度 token，绝不一次塞入全部 8 份）

详见 `07-testing-migration-batches.md` 的 Prompt 模板与批次依赖图。

## 验收标准（超级应用档）

- [ ] 业务层 grep 无 `wx.` `fetch(` `localStorage.`
- [ ] 任一能力可一键切换 mock / real / replay
- [ ] 单测可在 Node 环境跑（不依赖 `wx` 全局）
- [ ] `--trace-api` 输出 适配器/参数/耗时/脱敏结果
- [ ] A1 弱网混沌测试通过（重试/取消/去重/竞态 401）
- [ ] M7.1 CI 审计门禁阻断平台 API 泄漏
