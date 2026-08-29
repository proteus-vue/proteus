# 07 · 超级应用加固：可观测（M8）

## M8.1 Capability Trace

每次能力调用携带 `traceId`：

```ts
useCapability('share', {
  trace: true,
})
```

输出：

```json
{
  "traceId": "cap_123",
  "capability": "share",
  "platform": "skyline",
  "adapter": "share.skyline",
  "result": "success",
  "duration": 42
}
```

与 Pinia / Router / API 统一链路。

---

## M8.2 能力使用报告（CLI）

```bash
proteus capability report
```

输出：

- 哪些能力被使用
- 各平台支持情况
- 降级发生次数
- 缺失能力清单

---

## M8.3 DevTools 面板

- 当前平台
- 已注册 capabilities
- 每个能力状态（supported / fallback / unsupported）
- 手动触发 `isSupported()`

---

## M8.4 CI 审计（关键）

### 规则

1. 禁止 `wx.` / `window.` 出现在业务目录
2. 每个 capability 必须有三端 adapter（或明确 fallback）
3. 每个能力必须有单测
4. capability-manifest 与实际代码一致

### ESLint 规则

```js
'no-restricted-syntax': [
  'CallExpression[callee.object.name="wx"]',
  'CallExpression[callee.object.name="window"]',
]
```

### 审计命令

```bash
proteus audit capability
```

CI 失败示例：

```
❌ src/pages/xxx.ts uses wx.login() directly
   → 应使用 useCapability('login.wechat')
```

---

## M8.5 版本漂移检测

- 对比 `capability-manifest.json`
- 检测：
  - adapter 缺失
  - 版本不兼容
  - 行为差异（快照测试）

---

## 验收

- [ ] traceId 全链路打通
- [ ] CLI 报告可用
- [ ] DevTools 可调试
- [ ] CI 阻断平台泄漏
