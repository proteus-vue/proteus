# Proteus Blueprint — 超级应用全能力验证

> 一份真实大型应用（**Proteus Music，150 页**）落地验证，把前面 **15 份 plan** 从"纸面设计"变成"可运行、可验收的工程"

---

## 这份文档解决什么

15 份 plan 各自定义了接口，但**没人跑过，就不知道能不能对上**。这份蓝图是**验收规范**——让所有层的承诺在一次真实集成中被验证。

## 快速导航

| 文档 | 内容 |
|------|------|
| [00-overview](./00-overview.md) | 总览 + 铁律 + 与 15 份 plan 的关系 |
| [01-app-spec](./01-app-spec.md) | Proteus Music 150 页 PRD + 模块分布 |
| [02-monorepo-structure](./02-monorepo-structure.md) | packages/* 对应 15 份 plan |
| [03-feature-music-player](./03-feature-music-player.md) | 全局播放器（5 层联动） |
| [04-features-trade-order](./04-features-trade-order.md) | 交易闭环（5 层联动） |
| [05-features-social-realtime](./05-features-social-realtime.md) | IM 长列表 + 内容发现 |
| [07-cross-layer-integration](./07-cross-layer-integration.md) | C1-C10 契约验证 |
| [08-build-verify](./08-build-verify.md) | 三端 build + 分包 + 审计 |
| [09-e2e-verification](./09-e2e-verification.md) | 真机 E2E + 性能基线 |
| [10-migration-from-legacy](./10-migration-from-legacy.md) | uni-app/Taro 迁移对比 |
| [11-llm-execution-batches](./11-llm-execution-batches.md) | 分批执行 + Prompt 模板 |
| [12-acceptance-criteria](./12-acceptance-criteria.md) | 最终验收清单 |

## 核心数据

- **150 页**（6 大模块，非复制）
- **10 条跨层契约**（C1-C10）
- **4 个功能域**（播放器/交易/社交/内容）
- **7 个里程碑**（M1-M7）
- **15 份 plan 铁律对账**

## 防撑爆规则

每份文档独立（< 200 行），LLM 单次只喂：overview + 当前文件 + 直接依赖 plan。

---
