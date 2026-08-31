# --strict-cli & 分批策略

## 1. 严格规则

| 编号 | 规则 | 处理 |
|------|------|------|
| CLI001 | `proteus.config.ts` 校验失败 | error |
| CLI002 | 缺失必要 target 配置 | error |
| CLI003 | 能力开关冲突 | warn |
| CLI004 | `.proteus/` 被手动修改（检测到差异） | warn + 提示重新生成 |

`proteus check` 聚合：`--strict-css` + `--strict-style` + `--strict-router` + `--strict-cli` → 一键全量。

## 2. 分批（G-18 / M1-M4）

| 批次 | 内容 | 依赖 | 可单测 |
|------|------|------|--------|
| M1 | CLI Core：`create`/`dev`/`build` 骨架 + `defineProteus` 类型 | Compiler B1 | ✅ |
| M2 | Web + Skyline 构建 | Compiler M1 | ✅ |
| M3 | 原生工程自动同步（iOS/Android/鸿蒙） | App Renderer M2/M3 | 🔶 |
| M4 | CI/CD 模板 + 发布流水线 | all | 🔶 |

## 3. M1 Prompt 模板

```
实现 @proteus-vue/cli 的 Core（纯 Node.js，零原生依赖）：

【目标】
1. `proteus create <name>`：从模板拷贝 + 依赖安装
2. `defineProteus(config)`：Zod 校验 + TS 类型推导
3. `proteus dev --targets`：启动多 target dev server（复用 Vite）
4. `proteus build --target`：调用 Compiler per target
5. `proteus check`：聚合所有 --strict-* 开关

【验收】
- 单元测试：create 模板、配置校验、命令分发
- 集成测试：e2e（临时目录跑 create+dev+build）
- 遵循原则 #10（配置语义 → 各端产物）
```

## 4. 架构更新

- 新增执行位 **G-18**（P0）
- 原则 #12：配置即类型安全（单一事实源）
- 全景图 Layer 0 下方新增「工具链层：CLI / Compiler / DevTools」
