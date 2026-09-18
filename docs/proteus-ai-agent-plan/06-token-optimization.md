# Token 优化

> G-36.5：Agent 上下文**必须**走 MCP 按需查询，禁止全量塞入 system prompt。

## 1. 问题

把 128 原语 + design-tokens + 能力矩阵 + 示例全部塞进 system prompt：
- 单次 ~50K tokens，成本高
- 99% 用不到（单个页面只用 5-10 个原语）
- 上下文越长，LLM 遵循约束越差

## 2. 策略

### 2.1 增量加载（MCP 按需）

```
system prompt 只放：角色 + 铁律摘要（~2K tokens）
   ↓ 需要原语时
LLM 调 search_primitives(query) → 返回匹配的 3-5 个（~1K）
   ↓ 需要取色时
get_design_token(group: 'color') → 仅颜色部分
```

**每次实际消耗 ~5-10K tokens，而非 50K。**

### 2.2 上下文分层

| 层 | 内容 | 生命周期 |
|----|------|---------|
| System | 铁律、角色 | 常驻（小） |
| Session | 当前意图、已选原语 | 一次生成 |
| Cache | Skill 模板、IR 范例 | 跨会话复用 |
| MCP | 全量知识 | 按需拉取 |

### 2.3 缓存

- Skill 模板（intent-to-flex 的 prompt）固定 → **前缀缓存**
- 相同意图的 IR 骨架 → 复用 + 微调
- design-tokens 稳定 → 本地快照

### 2.4 IR 优先（减少自由生成）

能用 `IRBuilder` 规则构造的部分**不走 LLM**（布局骨架确定性高），只让 LLM 处理真正需要语义理解的部分（文案、业务逻辑）。

## 3. 成本模型（实测目标）

| 场景 | 策略 | tokens | 成本（Claude Sonnet） |
|------|------|--------|---------------------|
| 简单页面 | IRBuilder + 少量补全 | ~5K | ~$0.03 |
| 标准页面 | intent-to-flex | ~12K | ~$0.07 |
| 复杂迁移 | migrate-miniprogram | ~30K | ~$0.18 |
| 全量生成（反例） | 塞满 prompt | ~50K | ~$0.30 |

## 4. 缓存命中率目标

| 指标 | 目标 |
|------|------|
| Skill 模板缓存命中 | ≥ 90% |
| 相同意图 IR 复用 | ≥ 60% |
| MCP 查询替代全量注入 | ≥ 80% token 节省 |
