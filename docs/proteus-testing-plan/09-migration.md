# 迁移指南

## 1. 从现有测试迁移
- jest → vitest：配置文件自动转换 (codemod)
- @vue/test-utils v1 → v2：API 差异 (find → findComponent)
- jsdom → happy-dom：环境变量切换

## 2. 渐进式
- 旧测试保留，新代码走新规范
- 双轨期：`legacy/` vs `__tests__/`
- 目标：6 个月内旧目录清空

## 3. codemod 脚本
- `proteus migrate test`：重写 import + 断言
- 自动加 `data-testid`（可选）

## 4. 快照迁移
- 旧快照 → 新格式转换器
- `snapshotVersion` 字段控制分批

## 5. 验收
- [ ] 现有测试 90% 可自动迁移
- [ ] 双轨期无功能退化
- [ ] 文档 + 迁移 PR 模板
