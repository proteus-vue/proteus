# G-47 SPI：组合一致性测试接口

## 1. 组合测试三要素

```typescript
interface CombinedTest {
  /** 渲染后端（G-27 SPI 实现） */
  backend: RenderBackend;
  /** 资源池（G-46 ResourcePool 实例） */
  pool: ResourcePool;
  /** 执行组合断言 */
  assert(invariant: InvariantId): AssertionResult;
}
```

## 2. RenderBackend × ResourcePool 契约

```typescript
interface RenderBackend {
  name: string;
  pool: ResourcePool;   // ★ 构造时注入（P1：资源归宿主）
  mounted: boolean;

  mount(): void;
  unmount(): void;

  // ★ 唯一允许的资源访问通道（P2：单向依赖，只读）
  readAuth(domain: string, origin: string): AuthView | null;
  readCache(origin: string, key: string): unknown;
}
```

**铁律 CCI-01**：Backend **不得缓存** `readAuth` 返回值——每次必须查池。否则 INV-01 失效（池更新后后端持旧值）。

**铁律 CCI-02**：Backend **不得持有** Cookie/Token 副本——`unmount()` 不得销毁任何池内资源（NEG-02 验证）。

## 3. 六不变量断言 API

```typescript
type InvariantId =
  | 'INV-01-auth-survives-backend-switch'   // 切后端登录态不丢
  | 'INV-02-cache-survives-backend-switch'  // 切后端缓存不丢
  | 'INV-03-logout-switch-commutative'      // 登出×切换交换律
  | 'INV-04-concurrent-no-crash'            // 并发不崩溃
  | 'INV-05-same-ir-same-view'              // 同 IR 同资源视图
  | 'INV-06-degrade-no-crash';              // 降级不崩溃
```

| 不变量 | 断言方法 | 对应测试 |
|--------|---------|---------|
| INV-01 | `backend_A.readAuth() === backend_B.readAuth()` | INT-A1~A6 |
| INV-02 | `cacheGet` 在切换前后值相等 | INT-B1~B3 |
| INV-03 | 两种顺序最终 `pool.cookies.size === 0` | INT-C1~C5 |
| INV-04 | N 次并发无异常 + 最终态可预测 | INT-D1~D2 |
| INV-05 | 三后端 `.kind` & `.value` 全等 | INT-A7/A8 |
| INV-06 | `mount()` 抛错被正确捕获 + 回退可用 | INT-E1~E2 |

## 4. 官方 Backend 实现要求

| Backend | CCI 要求 |
|---------|---------|
| VueDomBackend | 通过 `readAuth` 读池；`unmount` 不触池 |
| FlutterBackend | 同上；且 Dart↔JS 边界传值**不缓存** |
| NativeBackend | 同上；原生侧不得持久化 sid |

**所有 Backend 必须过 G-47 conformance 才能标记为"G-46 兼容"。**

## 5. 错误分类

| 错误码 | 含义 | 处理 |
|--------|------|------|
| `BACKEND_UNAVAILABLE` | 装载失败 | 捕获 + 回退后端（INV-06） |
| `STALE_AUTH_VIEW` | 后端缓存了旧登录态 | CCI-01 违规，拒绝 |
| `POOL_MUTATED_ON_UNMOUNT` | unmount 销毁了池资源 | CCI-02 违规（NEG-02） |
| `INVARIANT_VIOLATED` | 六不变量任一失败 | 阻断合并 |

## 6. conformance 快检（复用 G-45 装载即验证）

Backend 动态装载时（G-45 机制），**同步跑 G-47 六不变量快检**——不过门禁 → 拒绝装载 + 降级（原则 #4）。

```
装载 Backend → 注入共享 ResourcePool → 跑 INV-01~06 → 全 PASS → 启用
                                              ↓ 任一 FAIL
                                        拒绝装载 + 降级 UI
```
