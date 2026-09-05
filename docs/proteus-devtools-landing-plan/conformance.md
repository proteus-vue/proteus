# G-55 Conformance

## 不变量

| ID | 命题 | CMP |
|----|------|-----|
| **INV-PF-01** | 宿主适配器只做翻译，零业务逻辑 | CMP-163 |
| **INV-PF-02** | 无宿主支持某能力 → SKIP，不崩溃、不判 FAIL | CMP-164 |
| **INV-PF-03** | 增量索引复杂度 O(affected)，非 O(N) | CMP-165 |
| **INV-PF-04** | 缓存命中后不再重算（recompute = 0） | CMP-166 |
| **INV-PF-05** | 缓存失效精确到 deps，不全量清空 | CMP-167 |
| **INV-PF-06** | 新增宿主适配器不改内核 API（架构试金石） | CMP-168 |
| **INV-PF-07** | 性能判定确定性：计数阻断，墙钟仅 warn | CMP-169 |
| **INV-PF-08** | LRU 淘汰只降性能，不丢正确性 | CMP-170 |

## 用例覆盖

| 组 | 内容 | 条数 |
|----|------|------|
| MODEL | 项目模型与反向依赖 | 3 |
| KERNEL | 索引 / 语义跳转 / 分层 / 依赖图 | 12 |
| INCREMENTAL | 增量索引与精确失效 | 5 |
| CACHE | LRU 与命中率 | 5 |
| ADAPTER | 宿主选择与协议一致性 | 5 |
| TOUCHSTONE | 内核 API 冻结 | 3 |
| BUDGET | 六项预算判定 | 5 |
| TIMING | 墙钟仅观测不阻断 | 2 |
| NEGATIVE | 负向用例 | 9 |
| JOINT | 与 G-51 / G-54 接缝 | 2 |

**合计：58/58 条**（实测值，由 `node reference-impl.cjs` 输出，非估算）

## 负向用例

- **NEG-01** 无宿主支持 → SKIP 不抛异常
- **NEG-02** L0 直连 L2 → SKIP_LAYER 违规被检出
- **NEG-03** 循环依赖被检出
- **NEG-04** 空项目模型不崩溃
- **NEG-05** 高层依赖低层合法，不误报
- **NEG-06** LRU 淘汰后重算结果一致
- **NEG-07** 未知 symbol → 空 targets 不崩溃
- **NEG-08** deviceImpact 无等价类数据 → mock 标记，不崩溃
- **NEG-09** renderPreview 空入参 → 空对象

## 接缝命题

- **G-55 INV-PF-02 ∧ G-51 Result 语义**：能力缺失 → SKIP，与 G-51 一致
- **G-55 INV-PF-06 ∧ G-54 三层分层**：内核 API 冻结是可机器验证的分层证明
