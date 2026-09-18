name: Bug 报告
description: 编译产物 / 构建 / 运行期问题
title: "[bug] "
labels: [bug]
body:
  - type: markdown
    attributes:
      value: |
        ## 先做两件事（反黑盒原则）
        1. `npm run debug:mp` 后贴出 `dist/mp-weixin/.transform-debug/<file>.json` 中的 **trace 决策链**
        2. 用 `getTransformRule('<ruleId>')`（或 `packages/compiler` 的 `formatTransformRule`）确认涉及哪条规则
  - type: textarea
    attributes:
      label: 现象
      description: 期望 vs 实际（含产物片段）
  - type: input
    attributes:
      label: 涉及规则 ID（可多填，逗号分隔）
  - type: textarea
    attributes:
      label: 复现步骤
  - type: textarea
    attributes:
      label: 环境
      description: Node 版本 / 微信基础库 / 真机 or 开发者工具 / Web or 小程序
