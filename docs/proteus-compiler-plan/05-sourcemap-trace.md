# M5 Source Map & `--trace-transform`

> 透明编译的硬证据：**源码行 ↔ IR 节点 ↔ 产物位置**三段可追溯。

## 一、定位（对齐整体哲学）

Lifecycle/Store/Router/API 都有 `--trace-*`，Compiler 对应 `--trace-transform`。目标：开发者或 AI 看到产物异常，**一条命令定位到"哪条 transform 规则 + 哪个源码位置"**。

## 二、Source Map 策略

- 每个 codegen 产物附带 `.map`（Web `.js.map`、小程序 `.js.map` + `.wxss.map`）
- 映射链：**源码字符偏移 → IR 节点 → 产物字符偏移**
- 调试时浏览器/小程序 DevTools 可直接映射回 `.vue` 源码

## 三、`--inspect` / `--trace-transform` 输出

```bash
proteus build --trace-transform v-for --inspect
```

输出：
```
[transform:v-for] pages/home/Home.vue:12:5
  source:   <view v-for="item in list" :key="item.id">
  IR:       ForNode(id=item, of=list, key=item.id)
  target:   <view wx:for="{{list}}" wx:key="id">
  backend:  skyline
  file:     dist/mp/pages/home/home.wxml:3:1
```

三段式：**源码 → IR → 产物**，一一对应。

## 四、Trace 链路统一（对齐 Observability 层）

```
--trace-transform  (compiler)
--trace-lifecycle  (lifecycle)
--trace-route      (router)
--trace-store      (pinia)
--trace-api        (api)
--trace-capability (platform)
```

统一 traceId 前缀 + 结构化 JSON 输出，可被 DevTools / 远程上报消费。

## 五、错误定位增强

编译报错示例：
```
✘ [v-for] pages/home/Home.vue:12:5
  Missing `:key`. Skyline requires wx:key for list rendering.
  → See transforms/v-for.ts
  → Fix: add :key="item.id"
```

AI 可直接读取此输出并自动修复（vibe coding 场景）。

## 六、验收

- [ ] 任意产物位置可反查源码位置（source map 验证）
- [ ] `--trace-transform` 覆盖全部内置规则
- [ ] 错误提示含规则文件 + 修复建议
- [ ] trace 输出结构化（JSON），可被 DevTools 消费
