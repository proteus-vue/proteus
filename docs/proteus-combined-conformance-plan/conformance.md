# G-47 Conformance 清单

> 全部断言在 `reference-impl.cjs` 中实现，可运行验证。

## 1. 不变量（Invariants）

| ID | 描述 | 级别 | 承载测试 |
|----|------|------|---------|
| INV-01 | 切后端后登录态不丢 | error | INT-A1~A6 |
| INV-02 | 切后端后缓存不丢 | error | INT-B1~B3 |
| INV-03 | 登出 × 切后端交换律 | error | INT-C1~C5 |
| INV-04 | 并发不崩溃 + 最终一致 | error | INT-D1~D2 |
| INV-05 | 同 IR 同资源视图 | error | INT-A7/A8 |
| INV-06 | 降级不崩溃 | error | INT-E1~E2 |

## 2. 测试套件（23 项，reference-impl.cjs）

### INT-A：切后端登录态不丢（8 项）
| 测试 | 断言 |
|------|------|
| INT-A1 | VueDom 读 Cookie 轨 kind=cookie |
| INT-A2 | Flutter 读同一 Cookie 值相等 |
| INT-A3 | VueDom 跨域无 Cookie → kind=token |
| INT-A4 | Flutter Token 轨值相等 |
| INT-A5 | Native 接管后 Cookie 轨仍在 |
| INT-A6 | Native 接管后 Token 轨仍在 |
| INT-A7 | 三后端 `.kind` 全等 |
| INT-A8 | 三后端 `.value` 全等 |

### INT-B：切后端缓存不丢（3 项）
| 测试 | 断言 |
|------|------|
| INT-B1 | VueDom 读缓存 |
| INT-B2 | Flutter 读同一缓存 |
| INT-B3 | Native 重挂载后缓存仍在 |

### INT-C：登出 × 切后端交换律（5 项）
| 测试 | 断言 |
|------|------|
| INT-C1 | 先登出后切：VueDom 读不到 |
| INT-C2 | 先登出后切：Flutter 读不到 |
| INT-C3 | 先登出后切：缓存清空 |
| INT-C4 | 先切后登出：登录态清空 |
| INT-C5 | 先切后登出：缓存清空 |

### INT-D：并发（2 项）
| 测试 | 断言 |
|------|------|
| INT-D1 | 600 次并发不崩溃 |
| INT-D2 | 并发后最终态可预测 |

### INT-E：降级（2 项）
| 测试 | 断言 |
|------|------|
| INT-E1 | 不可用后端装载抛 `BACKEND_UNAVAILABLE` |
| INT-E2 | 降级到回退后端后登录态可用 |

### NEG：负向判别力（3 项）
| 测试 | 断言 |
|------|------|
| NEG-01 | 未登录时所有后端读不到 |
| NEG-02 | ★ unmount 后共享池存活（OWN-06） |
| NEG-03 | 重挂载读到同一登录态 |

## 3. 编号延续

- 承接 G-46 的 `CMP089-096` / `OWN-01-10`
- G-47 使用 **`INV-01-06`** + **`INT-A~E`** + **`CCI-01-06`**（INT-A~E 为本包局部套件标签，与 G-44 全局 INT-01~05 语义不同，见 `rules.md` §6）
- 全局 CMP 编号延续至 **CMP097-102**（G-46 止步 CMP096，见 `architecture-update.md`）

## 4. 通过标准

| 场景 | 要求 |
|------|------|
| 合并 PR | 23/23 PASS，0 FAIL |
| 新增 Backend | 须过 INV-01~06（G-45 装载即验证） |
| 性能回归 | 切换耗时 < 16ms（B4 阶段，非本套件） |
