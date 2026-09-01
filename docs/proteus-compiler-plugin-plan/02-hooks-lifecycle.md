# 钩子全景与生命周期（G-21）

> 配套 `01-compiler-plugin-system.md`，详述六个阶段钩子的执行顺序、Context 形态、可变性约定。

## 一、完整管线（含插件注入点）

```
┌─ resolve         : 解析插件引用（proteus.config → 实际插件对象）
│
├─ ① parse        : SFC → TemplateAST + ScriptAST + StyleAST
│     └─ plugin.parse()         [pre → default → post]
│
├─ ② buildIR      : AST → IRNode 树（语义层）
│     └─ plugin.buildIR()       [default]
│
├─ ③ transform    : IR → IR（规则级纯函数展开）
│     └─ plugin.transform()     [pre → default → post]  ← 旧 TransformPlugin
│
├─ ④ codegen      : IR → 各端产物字符串（Web/Skyline/iOS/Android/Harmony）
│     └─ plugin.codegen()       [post]
│
├─ ⑤ emit         : 产物写入（磁盘 / 内存 / HMR channel）
│     └─ plugin.emit()          [post]
│
└─ ⑥ post         : 后处理（sourcemap 合并、报告、类型声明、审计）
      └─ plugin.post()          [post]
```

## 二、各钩子 Context 专属字段

```ts
interface ParseContext extends BaseContext {
  ast: { template?: Node; script?: Node; style?: Node[] };
  parseTemplate(source: string): Node;
  parseScript(source: string): Node;
  /** 标记为需跳过默认解析（插件已完全接管） */
  skipDefaultParse(): void;
}

interface BuildIRContext extends BaseContext {
  ir: IRNode; // 根节点，可遍历/增删
  createNode(type: string, props?: Record<string, unknown>): IRNode;
  visit(visitor: IRVisitor): void;
  registerComponent(name: string, def: ComponentDef): void;
}

interface TransformContext extends BaseContext {
  helpers: HelperMap;
  options: ProteusConfig;
  platform: Platform;
  /** 原地修改 node 并返回 void，或返回新节点替换 */
  replaceNode?(newNode: IRNode): void;
}

interface CodegenContext extends BaseContext {
  backend: CodegenBackend; // 当前端后端实例
  overrideBackend?(b: CodegenBackend): void;
  registerNativeComponent(name: string): void;
  /** 生成额外辅助函数（如 worklet 桥） */
  addHelper(name: string, code: string): void;
}

interface EmitContext extends BaseContext {
  outputs: Map<string, OutputAsset>; // path → content
  sourcemap: SourceMap;
  emitFile(file: OutputFile): void;
  /** 修改已有产物（谨慎使用） */
  patchOutput(path: string, mutator: (c: string) => string): void;
}

interface PostContext extends BaseContext {
  report: BuildReport; // 含 IR、产物清单、耗时、警告
  generateDts(decls: DtsDeclaration[]): void;
  writeReport(name: string, data: unknown): void;
}
```

## 三、执行顺序与 `enforce`

```
[pre]    → 按注册序（适合平台无关语法展开、全局注入）
[default]→ 按注册序（适合语义映射、IR 构建、规则 transform）
[post]   → 按注册序（适合优化、codegen、emit、审计）
```

**确定性规则**：
- 同 `enforce` 组内按 `proteus.config` 注册顺序
- `dependsOn` 声明强制拓扑排序（循环依赖 → error）
- 插件未声明 `enforce` → 归 `default`

**内置规则执行序（沿用旧 `04-transform-plugin`）**：
```
pre:      平台无关语法展开（v-if/v-for 解析、自定义指令注册）
default:  语义映射（DOM → 平台节点、IR build、transform 规则）
post:     平台优化（Skyline 包裹、wx:key 注入、codegen、审计）
```

## 四、可变性约定

| 钩子 | 输入 | 输出 | 是否纯函数 |
|------|------|------|:---:|
| `parse` | source | AST（可改） | 推荐纯 |
| `buildIR` | AST | void（改 ctx.ir） | 否（有 IR 副作用） |
| `transform` | IRNode | IRNode \| void | **必须纯** |
| `codegen` | IR | void（改 ctx.backend） | 否 |
| `emit` | outputs | void | 否 |
| `post` | report | void | 推荐纯 |

> **`transform` 强制纯函数**（无 IO、无全局状态），对齐旧 API + AI 可生成 + 易单测。

## 五、增量编译与 HMR

- 插件 `cache` 自动按 `(pluginName, file, hash)` 键入；**增量编译复用缓存**
- `addDependency(file)` 让 HMR 追踪插件额外依赖（如插件读外部 JSON schema）
- 插件若产生不稳定输出（随机数、时间）→ 必须用 `ctx.cache` 固化，否则破坏增量

## 六、验收

- [ ] 六个钩子单测 + 集成测试（含执行顺序断言）
- [ ] dependsOn 拓扑排序 + 循环依赖报错
- [ ] 增量编译下插件 cache 命中正确
- [ ] HMR 追踪插件额外依赖
