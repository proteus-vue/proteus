# Proteus CLI & 工程化

> 第 34 份 plan · 执行位 **G-33** · P0

## 定位

`proteus create` / `dev` / `build` —— 开发者入口，**配置即类型安全、构建即五端产物**。

## 文档清单

| 文件 | 内容 |
|------|------|
| `01-cli.md` | ★ 主文档：命令/配置/模板/流水线/对标 |
| `02-build-pipeline.md` | 多 target 并行编译 + 原生工程同步 |
| `03-strict-cli.md` | 严格规则 + 分批 + 架构更新 |

## 核心

```bash
proteus create my-app
proteus dev --targets web,skyline,ios,android,harmony
proteus build --targets all
proteus check --strict   # 聚合所有 strict
```

`proteus.config.ts`（defineProteus）→ 类型安全 + 单一事实源。

## 关联

Compiler、Router(G-32)、所有横切能力(G-07~G-16)
