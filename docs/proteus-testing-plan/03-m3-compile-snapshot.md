# M3 — 编译产物快照 (L3)

> 占比 5%，验证 Compiler codegen 输出 = "透明编译"的回归防线

## 1. 原理

`dist/mp/**/*.{wxml,wxss,js,json}` 是编译产物。**把它进 git 做快照**，Compiler 改动后 `git diff` 即知影响范围。

## 2. 工具链

- `vitest` + 自定义 matcher `toMatchCodegenSnapshot()`
- 快照目录：`__snapshots__/mp/` ` __snapshots__/web/`
- 更新：`vitest -u` 或 `proteus test --update-snapshots`

## 3. 快照结构

```
__snapshots__/mp/
  pages/home/home.wxml.snap
  pages/home/home.js.snap
  app.json.snap
  components/p-button/p-button.wxml.snap
```

每个 `.snap` 是编译产物原文 + 元数据头：

```js
// @proteus-snapshot v1
// source: src/pages/home/Home.vue
// transform: compileSFC
// compiler-version: 2.47.0
exports[`Home.vue > compiles to home.wxml`] = `
<view class="home">
  <p-button wx:if="{{show}}">click</p-button>
</view>
`;
```

## 4. 测试写法

```ts
import { compileFixture } from './test-utils'

it('Home.vue → home.wxml', async () => {
  const { wxml } = await compileFixture('Home.vue')
  expect(wxml).toMatchCodegenSnapshot()
})
```

`compileFixture` 内部调 Compiler（不读真实文件系统），输入 SFC 字符串 → 输出四件套。

## 5. 三端快照一致性

同一份 SFC，三端产物对比：

```ts
it('p-button consistent across platforms', async () => {
  const { web, mp, app } = await compileAll('PButton.vue')
  // 结构一致，仅平台语法差异
  expect(mp.wxml).toContain('<p-button')
  expect(web.html).toContain('<button')
  expect(app.output).toContain('PButton')
})
```

## 6. 更新策略（防随意改快照）

- CI：**禁止** `--update-snapshots`，失败即阻断
- 本地：允许 `-u`，但需 `git diff` 审查后提交
- 大改：先在 `proteus.config.ts` 标记 `snapshotVersion: 2`，分批迁移

## 7. 验收

- [ ] 每个 `.vue` 至少 1 个快照
- [ ] `proteus test` 快照失败 = CI 红
- [ ] `--trace-transform` 输出与快照一一对应
- [ ] 快照文件体积 < 500KB（超阈值告警）
