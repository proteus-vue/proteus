# 00 - Compiler 架构总览

## 定位

`@proteus/compiler` —— 应用层多 main 架构下的透明编译内核。

**输入**：`src/` 下的 Vue SFC + `proteus.config.ts` + `app.ts`（多 main）
**输出**：`dist/web/` + `dist/mp/` + `dist/app/`（三端产物）

## 整体管线

```
┌─────────────────────────────────────────────────────────────┐
│                    proteus.config.ts                         │
│         (platforms, transforms, chunks, trace)               │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  Parse Pipeline (01)                                        │
│  SFC → <template> / <script> / <style> / <route> / <config> │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  IR (02)                                                    │
│  Platform-independent intermediate representation             │
│  ├─ ComponentIR  ├─ RouteIR  ├─ BindingIR                  │
│  ├─ ModuleIR     ├─ StoreIR  ├─ CapabilityIR               │
└──────────────────────┬──────────────────────────────────────┘
                       │
              ┌────────┴────────┐
              ▼                 ▼
┌─────────────────────┐  ┌─────────────────────┐
│ Transform System (03)│  │  Codegen (04/05/06) │
│ 规则插件 + 可开关     │  │  Web / Skyline / App│
│ - vapor binding       │  │  IR → 三端产物      │
│ - scoped CSS          │  │                      │
│ - <route> → RouteIR  │  │                      │
└─────────────────────┘  └─────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  Emit                                                      │
│  + Source Map (07)  + Trace (07)  + HMR (08)               │
└─────────────────────────────────────────────────────────────┘
```

## 铁律（不可违反）

1. **IR 平台无关**：所有平台差异收敛在 codegen，IR 节点不带 `wx.*` / `document.*`
2. **Transform 纯函数**：`(node, context) => node`，无副作用，可缓存
3. **规则独立可关**：每条规则在 config 里可 `false` 关闭，关闭后产物不含该规则任何输出
4. **产物可审计**：每条产物代码行可追溯到 源码行 + 规则名
5. **无隐式注入**：编译器不偷偷加 runtime 垫片（除非显式开启 `runtime: true`）
6. **多 main 友好**：每个平台 main 独立编译上下文，共享 IR 缓存

## 三端 Codegen 差异点

| 产物 | Web | Skyline (mp) | App |
|------|-----|--------------|-----|
| 模板 | HTML | WXML | Native IR → Kotlin/Swift |
| 样式 | CSS | WXSS (scoped 哈希) | 平台样式 |
| 脚本 | ESM | CommonJS (require) | JSI / bridge |
| 入口 | `index.html` + SPA | `app.js` + `pages/*.js` | `MainApplication` |
| 路由 | vue-router | pages.json + routeType | StackNavigator |
| 组件 | DOM | glass-easel | Native widget |

## 里程碑

```
M1 (B1-B3): Parse + IR + Transform 骨架      ← 地基
M2 (B4-B6): 三端 Codegen 最小可用
M3 (B7):    Source Map + Trace
M4 (B8):    增量编译 + HMR
M5 (B9-B10): 超级应用加固（性能/可观测）
M6 (B11-B12): 测试 + 迁移 + CI
```

## 依赖关系

- 无上游依赖（最底层基建）
- 下游：Router / Component / Platform / Lifecycle / Pinia / Module（全部依赖 IR 与 transform 契约）

## 验收（M6 完成标准）

- [ ] 一份 SFC 编译到三端产物，产物结构符合各端规范
- [ ] `--trace-transform` 能输出完整映射链
- [ ] 每条 transform 可独立关闭且产物对应变化
- [ ] 增量编译：二次构建 < 500ms（千级文件）
- [ ] HMR 在 Web/Skyline 可用
- [ ] 编译期错误带源码位置 + 规则名 + 修复建议
