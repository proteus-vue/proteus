# 08 · 回归测试矩阵（核心）

> **这是本计划最重要的一章：**
> 条件编译之所以难回归，是因为“能力×平台”的组合爆炸。
> Proteus 的解法：**把组合收敛为矩阵，把矩阵变成自动测试。**

---

## 1. 测试金字塔

```
        E2E（每平台关键路径）
       /                        \
    集成测试（capability × platform）
   /                                \
 单测（adapter / registry / fallback）
```

---

## 2. 能力 × 平台矩阵

| Capability | Web | Skyline | App | Fallback |
|-----------|-----|---------|-----|----------|
| clipboard | ✅ | ✅ | ✅ | — |
| share | ✅ | ✅ | ✅ | clipboard |
| login.wechat | ⚠️ | ✅ | ✅ | login.sms |
| biometrics | ❌ | ✅ | ✅ | password |
| payment | ✅ | ✅ | ✅ | — |

> ⚠️ = 降级实现，❌ = 明确不支持

---

## 3. 单测策略

### 3.1 Adapter 单测

```ts
it('share.skyline calls wx.shareAppMessage', async () => {
  const adapter = await import('./share.skyline')
  const api = adapter.create()
  await api.share({ title: 'test' })
  expect(wx.shareAppMessage).toBeCalled()
})
```

### 3.2 Registry 单测

- 优先级选择
- fallback 链
- 重复注册报错

---

## 4. 集成测试

### 4.1 Mock Platform

```ts
setPlatform('skyline')
const share = useCapability('share')
expect(share.isSupported()).toBe(true)
```

### 4.2 降级测试

```ts
mockSupport('share', false)
const api = useCapability('share')
expect(api).toBe(clipboard)
```

---

## 5. 跨平台一致性测试（关键）

> **同一份业务代码，在三个平台产生相同行为。**

### 5.1 快照比对

```ts
expect(capabilityManifest).toMatchSnapshot()
```

### 5.2 行为契约测试

每个能力定义“预期行为”：

```ts
contracts: {
  'share': {
    input: { title: 'x' },
    expect: { resolved: true },
  },
}
```

三端运行同一契约。

---

## 6. 回归触发规则

| 变更 | 重跑 |
|------|------|
| adapter 改动 | 该能力全平台矩阵 |
| capability 新增 | 全量矩阵 |
| 平台入口改动 | 该平台全量 |

---

## 7. CI 矩阵配置（示例）

```yaml
strategy:
  matrix:
    platform: [web, skyline, app]
    capability: [clipboard, share, login, payment]
```

---

## 8. 验收

- [ ] 每个能力有单测
- [ ] 每种 fallback 有测试
- [ ] 三端行为契约一致
- [ ] CI 自动跑矩阵
- [ ] 新增平台不改业务即可回归
