# M8 — audit 门禁 + CI

## 1. `proteus audit` 规则
- `audit route`：路由表循环 / 死链
- `audit module`：模块循环依赖
- `audit api`：硬编码 wx.* / fetch
- `audit capability`：未注册能力调用
- `audit config`：config 字段校验 (Types M2)

## 2. --fix 自动修复
- 可修复项（import 路径、config 默认值）自动改写
- 不可修复项 → 报错 + 文档链接

## 3. CI 门禁
- pre-commit：lint + 受影响单测
- PR：全量 L1+L2+L3 + audit
- merge：E2E + 性能预算

## 4. 阻断规则
- 快照漂移 + 无审批 → 红
- audit 红 → 不允许 merge
- coverage 下降 > 2% → 告警

## 5. 验收
- [ ] `proteus audit` 在 Cli M3 落地
- [ ] CI 矩阵全绿
- [ ] 违规代码被 ESLint + audit 双重阻断
