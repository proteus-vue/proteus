# 09 · 迁移与 CI 门禁

## 1. 存量业务迁移策略

### 原则

> **渐进式：不改写业务逻辑，只替换平台调用。**

---

### Step 1：扫描现状

```bash
proteus migrate capability --scan
```

输出：

- 所有 `wx.*` / `window.*` 调用
- 建议替换的 capability
- 风险等级

---

### Step 2：按能力迁移

```js
// Before
wx.login()

// After
const login = useCapability('login.wechat')
login.signIn()
```

提供 **codemod** 自动转换：

```bash
proteus migrate capability --from wx --to proteus
```

---

### Step 3：保留平台例外（高阶）

极少数必须写平台分支的代码：

- 文件命名：`*.platform.ts`
- 需 PR 审批
- 必须有回归用例

---

## 2. 迁移优先级

1. 高频能力（login / share / clipboard）
2. 业务无关能力（device / storage）
3. UI 相关能力（toast / modal → Component 层）

---

## 3. CI 门禁（硬规则）

### 3.1 静态检查（✅ 已实现并接入 CI）

```bash
proteus capabilities:check <root>   # B5 平台规范：业务目录 wx./window. + 平台文件防泄漏（违规退出码 1）
proteus capabilities:manifest <root> --platform <web|skyline|app>  # B3 编译期分叉：能力缺失报告 + 业务引用警告
```

已接入 `.github/workflows/ci.yml`（capabilities:check + manifest --platform skyline/web）。

失败条件（capabilities:check 退出码 1）：

- 业务目录出现 `wx.` / `window.`（B5 §6 禁止清单）
- 平台文件 API 泄漏（skyline 文件用 window. / web 文件用 wx.）
- adapter 未注册（manifest 扫描失败）

能力缺失（B3）为信息性报告（manifest --platform 输出；硬卡可后续配置 required）。

---

### 3.2 运行时检查（开发态）

- 检测到直接平台调用 → console.error
- DevTools 显示警告来源

---

## 4. 与已有 CI 体系打通

| 层 | audit 命令 |
|----|-----------|
| Pinia | `proteus audit store`（pinia-plan M8.4 stores 铁律门禁，CI 已接入） |
| Router | `proteus audit route`（router:check） |
| Module | `proteus audit module`（module-plan B8，CI 可接入） |
| **Platform** | `proteus capabilities:check` + `capabilities:manifest --platform`（✅ CI 已接入） |

统一输出格式，统一门禁。

---

## 5. 迁移完成标准

- [ ] 业务目录无直接平台 API
- [ ] 所有 adapter 有单测
- [ ] CI 全绿
- [ ] DevTools 可观测全部能力

---

## 6. 反模式清单（写入 CONTRIBUTING.md）

```ts
// ❌
if (isWeChat()) { wx.xxx() }

// ❌
//#ifdef MP-WEIXIN

// ❌
platforms/web.ts 里写 wx.xxx
```

```ts
// ✅
useCapability('xxx')
```
