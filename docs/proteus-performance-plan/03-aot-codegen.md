# AOT 预编译与代码生成

> 对齐：`02-strategy.md` 机制 (1)、`proteus-app-renderer-plan/09-compiler-ir-integration.md`
> 批次：G-30 B1

---

## 1. 动机

**现状**：SFC 模板在运行时由 Vue 编译 + Renderer 解析，消耗 T5（30-80ms）。
**目标**：构建期完成编译，运行时只做"指令执行"，T5 → <5ms。

---

## 2. AOT 流水线

```
SFC (.vue)
   │
   ├─ <template> ──▶ Compiler IR (已有 --trace-transform)
   │                    │
   │                    ▼
   │               NativeInstruction[]  ◀── 新增 codegen
   │                    │
   │                    ▼
   └─ <script>/<style> ──▶ 业务 JS (正常 bundle)
                        │
                        ▼
                   dist/
                     ├─ pages/home.js      (业务)
                     └─ pages/home.aot     (AOT 指令, 二进制)
```

---

## 3. 指令格式

### 3.1 操作码

```ts
enum OpCode {
  CreateView    = 0x01,  // 创建 Native View
  SetProp       = 0x02,  // 设置属性
  AppendChild   = 0x03,  // 添加子节点
  InsertBefore  = 0x04,  // 插入到指定位置
  Remove        = 0x05,  // 删除
  SetEventHandler = 0x06 // 绑定事件 (worklet ref)
}
```

### 3.2 编码示例

```ts
// 模板: <p-view class="box"><p-text>Hi</p-text></p-view>
// IR:
[
  { op: CreateView, type: 'p-view', props: { class: 'box' } },
  { op: CreateView, type: 'p-text', props: { text: 'Hi' } },
  { op: AppendChild, parent: 0, child: 1 }
]
// 二进制 (紧凑):
// [0x01][typeId][props...][0x01][typeId][props...][0x03][0][1]
```

### 3.3 属性编码

```ts
function encodeProps(props: Record<string, any>): Uint8Array {
  // 属性名用字典索引 (复用 Compiler 的 prop schema)
  // 属性值按类型编码 (string/number/bool/ref)
}
```

---

## 4. Compiler 集成

```ts
// packages/compiler/src/codegen/aot.ts
export function generateAOT(ir: IRNode[]): Uint8Array {
  const buf = new BinaryBuffer()
  for (const node of ir) {
    buf.writeU8(OpCode.CreateView)
    buf.writeU16(getNativeTypeId(node.tag))  // p-view → id
    encodeProps(buf, node.props)
    if (node.children.length) {
      buf.writeU16(node.children.length)
    }
  }
  return buf.toBytes()
}

// 在 build 阶段调用 (对齐 Compiler M3)
export function compileSFC(sfc: SFC): CompiledOutput {
  const ir = compileToIR(sfc)
  return {
    js: compileScript(sfc.script),
    aot: generateAOT(ir.nodes),   // ← 新增
    css: compileStyle(sfc.style)
  }
}
```

对齐 `--trace-transform`：AOT 生成过程可追踪，输出 IR → 指令映射。

---

## 5. 运行时消费

```ts
// packages/app-renderer/src/aot-runner.ts
export function mountAOT(
  instructions: Uint8Array,
  root: NativeRoot,
  jsi: JSIContext
) {
  const reader = new BinaryReader(instructions)
  const viewStack: NativeView[] = []

  while (!reader.eof()) {
    const op = reader.readU8()
    switch (op) {
      case OpCode.CreateView: {
        const typeId = reader.readU16()
        const props = decodeProps(reader)
        const view = jsi.call('createView', typeId, props)  // 同步
        viewStack.push(view)
        break
      }
      case OpCode.AppendChild: {
        const parentIdx = reader.readU16()
        const childIdx = reader.readU16()
        viewStack[parentIdx].appendChild(viewStack[childIdx])
        break
      }
      // ...
    }
  }
  root.setRoot(viewStack[0])
}
```

**性能**：纯数组遍历 + JSI 调用，无解析、无 diff，<5ms。

---

## 6. 与静态首帧 (IFR) 的关系

AOT 是 IFR 的**前提**：阶段 A（首帧直出）直接消费 AOT 指令，不经过 Vue。

```ts
// App 启动
mountAOT(homeAOT, root, jsi)  // 阶段 A: <120ms, 无 Vue

// 后台 (并行)
bootstrapVue()                // 阶段 B

// 接管
reconcile(vueTree, nativeTree) // 阶段 C
```

详见 `04-ifr-static-first-frame.md`。

---

## 7. 产物体积预算

| 指标 | 目标 |
|------|------|
| AOT 产物总大小 | < 首屏 JS 的 30% |
| 单指令平均字节 | < 16 bytes |
| 属性字典命中率 | > 95% |

**压缩**：AOT 指令用 `Uint8Array` + 字典编码，天然紧凑；可选 gzip（需运行时解压，权衡）。

---

## 8. 验收

- [ ] SFC → AOT 指令正确生成（与 Vue 运行时产物结构一致）
- [ ] AOT 指令执行结果 == Vue 运行时渲染结果（diff 测试）
- [ ] T5 < 5ms（真机测量）
- [ ] AOT 产物纳入 `proteus audit app --size`
