# 占位项与后续 TODO

> 本文汇总所有**本期不实现**的项，作为后续启动的 checklist。

## CI 环境（§08）

| TODO | 阻塞项 | 优先级 |
|---|---|---|
| 决策：官方云测 vs 自建 Mac runner | 成本 / 维护人力 | P0 |
| Mac runner 镜像标准化 | IDE + Node 版本锁定 | P1 |
| 云测 API 接入 | 账号 / 凭证 | P1 |
| E2E 制品归档 | DevTools dump 格式 | P2 |
| 150 页并行策略 | CI 时长预算 | P2 |

**接口已预留**：`CiDriver { runUnit, runWebE2E, runMpE2E }`

## App 端（§09）

| TODO | 阻塞项 | 优先级 |
|---|---|---|
| 选型：Detox / Appium / 云测 | uni-app App 端适配验证 | P0 |
| App Driver 对齐 automator API | 接口稳定 | P1 |
| 真机矩阵 | 设备采购 / 云测额度 | P2 |

**接口已预留**：`AppDriver { launch, tap, screenshot }`

## 与统一测试命令的衔接

框架对外命令（对齐 CLI plan）：
```
proteus test          # 跑 L1-L3 + 快照（全节点可跑）
proteus test e2e:web  # Playwright
proteus test e2e:mp   # automator（需 Mac / 云测）
proteus test e2e:app  # 占位，未实现
```

## 完成标准
- [ ] CI 策略文档从"占位"升级为"可执行"
- [ ] App Driver 有至少一种后端实现 + 一条跑通的用例
- [ ] 150 页 Blueprint 全量 L1-L3 + 关键路径 E2E 绿

---
