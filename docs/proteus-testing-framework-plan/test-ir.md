# Test IR —— 测试语义定义

> 配套：`G-44-testing-framework.md` §2.1

---

## 1. 设计目标

断言不是"测试代码里的 `expect()`"，而是**可序列化、可传输、可复现的语义节点**。这带来三个能力：

1. **跨进程**：Test IR 可序列化后发给 DeviceBackend（真机/鸿蒙分布式）
2. **跨运行器**：Node 跑和 AOT 跑消费同一份 IR
3. **可观测**：DevTools 可直接渲染断言树 + 失败 trace

---

## 2. 核心类型

```ts
// 唯一标识：T-{layer}-{seq}
type TestId = `T-${string}-${number}`

interface TestIR {
  id: TestId
  name: string
  target: TestTarget
  arrange: IRNode | IRNode[]     // 被测输入
  act: ActOp[]                   // 操作序列
  assert: AssertionNode[]        // ★ 断言语义
  profile?: Profile3D            // G-25
  backend?: string               // 指定后端；缺省=全部适配后端
  tags: string[]                 // 'conformance' | 'integration' | 'e2e' | 'leak'
  xfail?: { reason: string; issue: string }  // 已知失败
}

interface TestTarget {
  layer: 'render' | 'compile' | 'runtime' | 'carrier'
       | 'integration' | 'ownership' | 'breakpoint'
  capability?: string            // 如 'createNode' | 'transferOwnership'
}
```

---

## 3. 断言节点（核心）

**禁止**：`assert: 'code'` 形式（逻辑塞进闭包，不可序列化）。

**必须**：结构化节点，运行器解释执行。

```ts
type AssertionNode =
  | { kind: 'eq'; path: string; value: unknown }          // 路径取值相等
  | { kind: 'match'; path: string; pattern: string }      // 正则
  | { kind: 'exists'; path: string }                      // 节点存在
  | { kind: 'count'; path: string; op: '=' | '>' | '<'; n: number }
  | { kind: 'throws'; op: ActOp; error?: string }         // 预期抛错
  | { kind: 'notLeak'; resource: 'timer' | 'listener'
                              | 'view' | 'arrayBuffer' } // G-43
  | { kind: 'conforms'; spec: string }                    // 符合某 spec
  | { kind: 'and' | 'or'; items: AssertionNode[] }        // 组合
```

**示例**：验证 `<p-grid>` 渲染 + 无泄漏

```json
{
  "id": "T-render-001",
  "target": { "layer": "render", "capability": "createNode" },
  "arrange": { "type": "p-grid", "props": { "minColWidth": 160 } },
  "act": [{ "op": "render", "to": "root" }],
  "assert": [
    { "kind": "eq", "path": "$.root.children[0].type", "value": "p-grid" },
    { "kind": "match", "path": "$.root.children[0].attrs.min-col-width", "pattern": ".*160.*" }
  ]
}
```

---

## 4. Act 操作

```ts
type ActOp =
  | { op: 'render'; to: string }
  | { op: 'update'; path: string; patch: Record<string, unknown> }
  | { op: 'destroy'; path: string }
  | { op: 'transfer'; resource: string; to: string }     // G-43
  | { op: 'borrow'; resource: string; scope: string }
  | { op: 'press'; key: string }                          // TV 焦点
  | { op: 'injectState'; state: Record<string, unknown> } // 车机驾驶状态
  | { op: 'resize'; w: number; h: number }                // G-25
  | { op: 'setFormFactor'; f: FormFactor }
  | { op: 'callNative'; method: string; args: unknown[] }
```

---

## 5. Profile3D（G-25）

```ts
interface Profile3D {
  w: number       // 宽度
  h: number       // 高度
  f: 'touch' | 'cursor' | 'remote' | 'dial' | 'voice'
}

// 标准档位（等价类，非连续）
const W_BREAK = [320, 600, 840, 1200, 1920]
const H_BREAK = [480, 720, 1080, 1200]
const F_FORMS = ['touch', 'cursor', 'remote', 'dial', 'voice'] as const
```

---

## 6. 序列化规则

1. 所有 `arrange` / `act` / `assert` 必须 JSON 可序列化
2. 函数（如自定义 matcher）**禁止内联**；改为注册 `MatcherId`，由后端查表
3. `path` 使用 JSONPath 子集（`$.root.children[0].type`）
4. IR 文件扩展名 `.tir.json`，纳入 git（可 review、可复现）

---

## 7. 与 G-43 的协同

`notLeak` 断言直接消费 G-43 的所有权图：

```json
{
  "kind": "notLeak",
  "resource": "arrayBuffer",
  "path": "$.ownership.Root.shell1"
}
```

测试时可**注入泄漏场景**（业务 A 持有跨页面引用），断言 DevTools 所有权图能定位到 `Leaky.vue:23`。

---

*本文件定义"测试语义"。执行方式见 `test-backend-spi.md`。*
