# 测试策略

> 对齐 `proteus-testing` 基建层，聚焦编译器自身测试。

## 一、四层测试

### L1：Transform 单测
每条规则一个 snapshot 测试：
```ts
it('v-for → wx:for + wx:key', () => {
  const ir = parse('<view v-for="i in list" :key="i.id">')
  const out = transform(ir, vForTransform)
  expect(out).toMatchSnapshot()
})
```

### L2：后端 codegen 测试
IR → 产物 snapshot，覆盖三端：
```
__snapshots__/home.skyline.wxml.snap
__snapshots__/home.web.js.snap
__snapshots__/home.app.json.snap
```

### L3：端到端（SFC → 产物）
完整 `.vue` → 完整四件套，验证 Router/Component/Platform 映射集成正确。

### L4：跨层矩阵
编译产物 + 运行时联调：
- Web：Playwright 跑产物页面
- Skyline：开发者工具 + skyline-mock 跑产物
- 校验"源码改动 → 产物行为"一致性

## 二、fixtures

```
tests/fixtures/
  basic/        ← v-if/v-for/插槽 等基础语法
  route/        ← <route> 块各种写法
  component/    ← 全局组件/appBar 包裹
  platform/     ← capability 分叉
  stress/       ← 千级页面/深嵌套
  errors/       ← 故意写错的源码（缺 key、循环依赖）
```

## 三、属性测试（超级应用）

- 用 `fast-check` 生成随机模板，验证 parser 不崩溃
- IR 序列化往返一致性

## 四、性能基准

- `vitest --benchmark` 记录全量/增量编译耗时
- 基线锁定，PR 引入回归（>10% 变慢）阻断

## 五、验收

- [ ] 每条 transform 有 snapshot
- [ ] 三端 codegen snapshot 全绿
- [ ] stress fixture（千级页面）在预算内
- [ ] benchmark 基线受 CI 保护
