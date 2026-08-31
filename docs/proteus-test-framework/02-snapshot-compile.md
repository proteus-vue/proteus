# M2 · L2 编译产物快照

## 目标
把"透明编译"变成**可版本化的测试资产**：`dist/mp/**/*.{wxml,json,js}` 全部进 git，diff 即回归。

## 快照对象

| 产物 | 断言方式 |
|---|---|
| `.wxml` | `@babel/parser` 解析 AST，比对结构与指令映射 |
| `pages.json` / `app.json` | 结构化 deep-equal |
| `.js` chunk | 源码 hash + 关键导出存在性 |
| source map | 行列映射回 `.vue` 源文件（对齐 Compiler M5） |

## 用法

```ts
import { compile } from '@proteus-vue/compiler'
import { toMatchSnapshot } from '@proteus-vue/test-snapshot'

expect.extend({ toMatchSnapshot })

it('SFC → WXML 映射', async () => {
  const { wxml } = await compile('<template><view v-if="x"/></template>')
  expect(wxml).toMatchSnapshot()   // 首次生成 .snap，后续比对
})
```

## 更新流程
- 改了 transform 规则 → `vitest -u` 更新快照 → **PR 必须 review `.snap` diff**
- CI 不允许快照自动更新，失败即阻断

## 与 `--trace-transform` 联动
快照失败时附带 trace ID，可直接在 DevTools 回溯 transform 链路：
```
Snapshot mismatch: dist/mp/pages/index.wxml
traceId: tr_01H...
→ proteus dev --trace-transform=tr_01H...
```

## 铁律
- 快照文件**必须进 git**（`.gitattributes` 设 `-diff` 大文件除外）
- 禁止 `--update-snapshots` 在 CI 跑
- 快照用例与被测 SFC **一对一**，禁止一个用例覆盖多个文件

---
