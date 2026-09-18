# Proteus 编译器插件系统（G-21）

> 面向插件作者的官方 API 与落地方案。**完整规划体系 = 37 份 plan + 1 规约。**

## 一句话定位

把 Proteus 编译管线的**每一个阶段都暴露成稳定的插件钩子**，让开发者（和业务框架、组件库、工具链）以**官方 API**接入编译流程——而非 hack 内部、改源码、打 monkey patch。

## 核心概念

- **六阶段钩子**：`parse → buildIR → transform → codegen → emit → post`
- **旧 `TransformPlugin` = 新系统的 `transform` 钩子子集**（向后兼容）
- **插件操作统一 IR**，不直接拼各端产物（对齐原则 #10）
- **核心能力 = 官方插件**：Router / Glass / Safe Area / Memorial / Skeleton 自身实现为插件（dogfooding）

## 文档清单

| 文件 | 内容 |
|------|------|
| `01-compiler-plugin-system.md` | ★ 主文档：问题/概念/API 全景/排序隔离/场景/原则/验收 |
| `02-hooks-lifecycle.md` | 六阶段钩子 + Context 专属字段 + 执行序 + 增量/HMR |
| `03-plugin-api.md` | 官方稳定 API 参考（definePlugin / BaseContext / cache / helpers） |
| `04-compat-migration.md` | 升级旧 `04-transform-plugin.md` + 向后兼容 + codemod |
| `05-plugin-publish.md` | 命名规范 / package.json / 自动发现 / 沙箱 / 脚手架 |
| `06-ordering-isolation-budget.md` | 排序确定性 / 错误隔离 / 性能预算 |
| `07-integration.md` | 与 #10 / Style Safety / App Config / CSS / Router / DevTools / AOT 协同 |
| `08-cli-integration.md` | `proteus plugins` 子命令 + `--strict-plugin` |
| `09-strict-rules.md` | PLG001-012 规则 + 自动修复 + CI 门禁 |
| `10-benchmark-budgets.md` | 性能预算 + 可观测性 + 五端验收矩阵 |
| `11-batches.md` | B1-B5 分批 + 依赖图 + Prompt 模板 |
| `architecture-update.md` | 规约更新（G-21 + 原则 #11 + 铁律 G-21.1/2/3） |

## 快速示例

```ts
// 自定义指令 v-permission（parse + transform）
import { definePlugin } from '@proteus-vue/compiler-core';

export default definePlugin({
  name: 'proteus-plugin-permission',
  version: '1.0.0',
  hooks: {
    transform(node, ctx) {
      if (node.type === 'Element' && node.directives?.permission) {
        return ctx.helpers.wrapWith(node, 'p-auth-guard', {
          action: node.directives.permission,
        });
      }
    },
  },
});
```

```ts
// proteus.config.ts
export default defineProteus({
  compiler: {
    plugins: ['proteus-plugin-permission'],
  },
});
```

## 设计原则（继承 Architecture）

- **#10 统一语义 + 原生实现**：插件操作 IR，codegen 按 platform 映射原生
- **编译透明**：每条规则 JSDoc 化，`--trace-transform <plugin>` 可追踪
- **AI-native**：插件契约 = AI 可读写的"编译器说明书"
- **向后兼容**：旧 TransformPlugin 永久可用

## 状态

- [x] 方案设计（12 份文档）
- [ ] B1 实现：类型 + 排序逻辑 + 旧 API 适配 + 单测
- [ ] B2 实现：六钩子管线接入
- [ ] B3 实现：`--strict-plugin` + configSchema
- [ ] B4 实现：自动发现 + 脚手架
- [ ] B5 实现：核心能力重写为官方插件范例

详见 `11-batches.md`。
