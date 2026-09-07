# Playground（在线体验）

## 目标

浏览器内**真实运行 Proteus Compiler**，把 `.vue` 实时编译为 Web / Skyline / App 三端产物，并可视化 IR + transform 链路。

这是官网**杀手功能**（见 `01-home.md`），也是"透明编译"最直观的证明。

## 架构

```
用户输入 .vue
  → Monaco Editor（语法高亮 + 补全）
  → Web Worker（跑 Compiler，不阻塞 UI）
  → Compiler 输出：IR + 三端 codegen + TraceBus 事件
  → 主线程渲染：Tabs（IR | Web | Skyline | App | Trace）
```

## Compiler 如何在浏览器跑

- Compiler 编译为 **WASM**（对齐前面"Web 渲染高性能"讨论）：核心 parser/IR/transform 用 Rust→WASM
- JS 部分：codegen 后端（WXML 字符串生成）
- 首屏**不加载 WASM**，用户点"运行"或改代码时才懒加载（防首页变慢）

## 功能清单

### 1. 编辑器
- Monaco（VS Code 同款），Vue/TS 语法高亮
- 支持多文件（虚拟文件系统）：`.vue` + `proteus.config.ts`
- 错误内联提示（Compiler 报错 → 编辑器红线 + 行号）

### 2. 输出 Tabs
| Tab | 内容 |
|-----|------|
| IR | 中间表示 JSON（可折叠树） |
| Web | render 函数 / SFC JS |
| Skyline | `.wxml` + `.json`（pages.json 片段） |
| App | Custom Renderer 调用序列 |
| Trace | transform 链路（`--trace-transform` 对齐 compiler-plan 05） |

### 3. Trace 可视化（复用 DevTools）
- 直接接 DevTools TraceBus（devtools-plan）
- 每条 transform：`文件名:行号 → 产物位置`
- 可点击跳源码行

### 4. 预设（preset）
内置常用示例：
- `v-if` / `scoped-css` / `<route>` / `mountMpApp` / `defineStore`
- 教程页用 `<proteus-playground preset="...">` 嵌入（见 03）

### 5. 分享
- 代码进 URL hash（base64 + 压缩）
- 生成短链 `/playground#<hash>`，可复现 bug
- **AI 协作**：一键导出为 LLM 可消费的最小用例

## 沙箱与安全

- Worker 内执行，主线程隔离
- 禁止 `eval` / `Function` 构造（对齐 security-plan）
- 资源限制：代码长度、编译超时（5s）

## 降级方案

若浏览器不支持 WASM：
- 显示静态预编译输出（不影响浏览）
- 提示"完整交互需现代浏览器"

## 验收

- [ ] 输入 `<view v-if>` → 实时出 `<view wx:if>`（< 500ms）
- [ ] Trace 链路与 compiler-plan `--trace-transform` 一致
- [ ] 分享链接在另一浏览器可复现
- [ ] 低端机不卡（Worker + 防抖）

## 依赖

- `compiler-plan`（Compiler WASM + IR + Trace）
- `devtools-plan`（TraceBus 可视化）
- `01-home.md` / `03-guide-tutorial.md` / `04-api-reference.md`（嵌入点）
- `security-plan`（沙箱）
