# Compiler 集成

两份能力的编译管线，复用现有 Compiler IR / transform / TraceBus 体系。

## 1. 纪念日灰度：编译期注入

### 1.1 Web

`transformIndexHtml` 钩子，向 `<head>` 注入：

```html
<!-- 常态构建即包含，日期判定走轻量 JS -->
<style>.proteus-memorial{filter:grayscale(100%);-webkit-filter:grayscale(100%);}</style>
<script>
  // 读取 memorial.json + 本地日期表，命中则 document.documentElement.classList.add('proteus-memorial')
</script>
```

### 1.2 Skyline / 小程序

Compiler 在 IR 阶段给页面根节点追加 `filter: grayscale(1)` 指令，**不**直接写 `page` 选择器（避免 flex 失效）。

### 1.3 App（iOS/Android/鸿蒙）

CLI 原生生成阶段把灰度模块编入，启动时读取配置一次性挂载滤镜层（详见 `01-memorial-gray.md` 五端映射）。

## 2. 骨架屏：静态分析流水线

新增 Compiler transform 阶段 `transform: skeleton`（在 AOT 之前、`--trace-transform` 可见）：

```
SFC 解析
  ↓ AST 遍历（静态分析）
节点类型识别（img/text/button/flex/list/glass）
  ↓ 推导规则映射
骨架 IR（SkeletonIRNode 树）
  ↓ 与 AOT IR 同源存储
dist/.proteus/skeleton/{route}.ir.json
  ↓ 按 target 分发
Web: 内联 HTML+CSS  │  Skyline: WXML  │  App: 原生占位 View
```

### 2.1 AST 遍历要点

- 只分析**静态可确定**的结构；含 `v-if` 动态分支时，取主分支（或 `fixtures` 指定状态）生成骨架；
- `v-for` 列表按预估项数重复骨架项（取自 `recycle-view` 配置或默认 5 项）；
- `<pg-glass>` 等 Glass 节点降级为普通占位块（骨架态无玻璃效果）。

### 2.2 产物

```
dist/.proteus/
  skeleton/
    index.ir.json
    list.ir.json
    detail.ir.json
  aot/                ← 与 AOT 产物同源目录
  ifr/                ← 与 IFR 静态首帧协同
```

### 2.3 TraceBus 事件

```ts
TraceBus.emit('skeleton:generated', { route, nodeCount, sizeKB })
TraceBus.emit('memorial:injected', { target: 'web' | 'skyline' | 'app' })
```

对接 DevTools + `--trace-transform` 可视化。

## 3. CLI 命令

```bash
# 显式生成骨架（开发期预览）
proteus skeleton generate

# 校验纪念日配置
proteus memorial check

# 构建期自动串联
proteus build   # 内部依次：typecheck → AOT → skeleton → memorial → IFR → bundle
```

## 4. 与现有管线顺序

```
src/SFC
  → parse
  → transform: memorial  (注入灰度指令)
  → transform: skeleton  (生成骨架 IR)
  → transform: aot       (AOT 预编译，复用 IR)
  → transform: ifr       (静态首帧，骨架即首帧)
  → codegen → bundle
```

## 5. 性能预算（详见 `10-benchmark-budgets.md`）

- 骨架 IR 产物单路由 < 2KB（结构化 JSON，远小于 base64 图片）；
- 灰度注入脚本 < 1KB（常态构建常驻，必须极小）；
- 骨架生成不引入 Chromium 依赖，CI 安装体积零增长。
