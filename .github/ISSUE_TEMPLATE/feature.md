name: Feature 请求
description: 新能力 / 路线图任务推进
title: "[feat] "
labels: [enhancement]
body:
  - type: dropdown
    attributes:
      label: 类型
      options:
        - 编译规则（transforms 注册表）
        - 运行时（router / setData / 生命周期）
        - 工程化（CLI / 独立包 / CI）
        - 多端（新平台 / 降级）
        - 文档
  - type: textarea
    attributes:
      label: 能力描述
      description: 期望的行为 + 对应用户场景
  - type: textarea
    attributes:
      label: 涉及规则 / 模块
      description: 尽量精确到规则 ID 或文件（AI 说明书 source 字段可跳读）
  - type: textarea
    attributes:
      label: 验收标准
