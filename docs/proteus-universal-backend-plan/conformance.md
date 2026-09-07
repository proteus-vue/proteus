# Conformance Test: Backend 接入验证

> G-30 可信性的根基：**不是"你声称实现了"，而是"test 自动验证"。**

---

## 1. 为什么需要 conformance test

传统框架的"多端支持"是**宣言式**的——框架说"支持鸿蒙"，但没有自动化验证，往往"能用"和"行为一致"是两回事。

Proteus 要求：**每个 Backend 必须通过 conformance test，CI 自动跑，失败不发布。**

---

## 2. 测试套件（四类）

### 2.1 IR 语义等价

同一份 IR → 各 Backend 产出**语义等价**结果。

```ts
test('p-grid → 网格容器', async () => {
  const ir = parse('<p-grid min-col-width="160"><p-card /></p-grid>')
  const result = await backend.render(ir)
  expect(result).toMatchConformedShape({
    type: 'grid',
    minCellWidth: 160,
    children: [{ type: 'card' }]
  })
})
```

### 2.2 capabilities 一致性

声明 vs 实现一致——**禁止虚假声明 supported**。

```ts
test('capabilities 真实', async () => {
  const caps = backend.capabilities
  for (const [name, decl] of Object.entries(caps)) {
    if (decl.supported) {
      expect(backend[name]).toBeDefined()  // 声明支持就必须有实现
    }
  }
})
```

### 2.3 降级路径

L2 缺失能力 → 编译期报错 / `@conditional` 生效。

```ts
test('scanQR 不支持 → 降级', async () => {
  const code = `<p-conditional capability="scanQR"><template #default>
    <button>scan</button></template><template #fallback>
    <input /></template></p-conditional>`
  const compiled = await compile(code, { capabilities: { scanQR: false } })
  expect(compiled).toContain('input')   // 渲染 fallback
  expect(compiled).not.toContain('button')
})
```

### 2.4 性能基准（Tier 1 必填）

| 指标 | 基线 | 容忍度 |
|------|------|--------|
| 首屏 TTI | < 1.5s | ±20% |
| 列表滚动 | 60fps | ≥55fps |
| 内存峰值 | < 200MB | ±30% |

---

## 3. CLI

```bash
# 跑某个 Backend 的全部 conformance
pnpm test:backend --backend=my-platform

# 跑特定套件
pnpm test:backend --backend=my-platform --suite=capabilities

# 生成 conformance 报告（用于对外宣称"Proteus 认证"）
pnpm test:backend --backend=my-platform --report
```

**输出示例**：

```
Proteus Backend Conformance Report
==================================
Backend: @proteus/backend-car v0.1.0
Tier:    2 (受限可用)

✓ IR 语义等价        12/12 passed
✓ capabilities 一致性  8/8 passed (2 declared unsupported, with reason)
✓ 降级路径           5/5 passed
⚠ 性能基准           skipped (Tier 2, optional)

Result: PASS — publishable (Tier 2)
```

---

## 4. 与 G-27/G-28 conformance 的关系

| 模块 | conformance 内容 |
|------|-----------------|
| G-27 | Render IR 语义等价 + 布局行为一致 |
| G-28 | Native 能力调用 + 权限处理 + 错误码 |
| **G-30** | **统一入口** `test:backend` = 以上 + Tier 判定 + 降级 |

`pnpm test:backend` 是 G-30 提供的**统一 CLI**，内部调用各 SPI 的 conformance。

---

## 5. 门槛总结

> **一个端要"接入成功"，必须：**
> 1. 实现 ~15 个 nodeOps 方法（RenderBackend）
> 2. capabilities 声明真实（supported + reason）
> 3. 通过全部 conformance 套件
> 4. 发布为 `@proteus/backend-xxx`

这四条是"任意端"可信的工程底线。
