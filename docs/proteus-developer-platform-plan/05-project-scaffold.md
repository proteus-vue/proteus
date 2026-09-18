# 05 项目脚手架（A2）

> 接续 `04-cli-pipeline.md`。定义 `proteus create` 的产物结构与 `capability-manifest` 规范——
> **manifest 是 AppPackage 的静态源头**（见 02-architecture §2）。

---

## 1. 生成的项目结构

```
my-miniprogram/
├── proteus.config.ts          # 配置（04 定义）
├── capability-manifest.yaml   # ★ 能力清单（本份核心）
├── src/
│   ├── app.js                 # 入口（AppService，G-48）
│   ├── pages/                 # 页面（PageFrame）
│   ├── components/            # 组件
│   └── capabilities/          # 能力实现（Adapter 适配，07 生成）
├── assets/                    # 静态资源
└── tests/                     # G-44 测试
```

---

## 2. capability-manifest.yaml（核心规范）

```yaml
packageId: com.example.demo
version: 1.0.0
sdkVersion: ">=1.2.0 <2.0"

capabilities:
  - name: login
    adapter: wechat             # 映射到 G-48 PlatformAdapter
    required: true
    rationale: "用户登录"        # ★ 审核依据（10-submission-review）
  - name: payment
    required: true
    restricted: true            # ★ 需审核（触发人工审核）
    rationale: "虚拟支付"
  - name: bluetooth
    restricted: true            # 受限能力（隐私/安全风险）
    required: false

permissions:
  - resource: storage
    access: readWrite
  - resource: network
    access: unrestricted
  - resource: device.location
    access: read
    rationale: "定位功能"

resources:                      # G-49 ResourceQuota
  memory: 256MB
  storage: 100MB
  cpu: 20%
```

### 字段语义

| 字段 | 含义 | 校验方 |
|------|------|--------|
| `capabilities[].adapter` | 走哪个平台 Adapter | G-48 Runtime |
| `capabilities[].restricted` | 是否需审核 | 10-submission-review |
| `capabilities[].rationale` | **用途说明（审核必需）** | 审核系统 |
| `permissions[]` | G-49 CapabilityBridge 静态声明 | G-49 Sandbox |
| `resources` | 资源配额 | G-49 ResourceQuota |

> **关键**：`rationale` 是**审核可解释性**的来源——没有 rationale 的受限能力直接驳回（B 生态的合规要求）。

---

## 3. 脚手架生成策略

`proteus create` 根据模板 + manifest 生成：

1. **基础文件**：`proteus.config.ts`、目录结构、示例页面
2. **能力桩代码**：`src/capabilities/<name>.ts`（调用 Capability IR 的统一接口）
3. **Adapter 占位**：`src/capabilities/adapters/<adapter>.ts`（07 可补全自动生成）

**模板可扩展**：`proteus create --template <name>`（官方模板 + 社区模板，对齐插件生态）。

---

## 4. 与 G-48 Capability IR 的关系

```
capability-manifest.yaml  ──▶  G-48 CapabilityRegistry
(rationale/restricted)         (runtime 选择 Adapter)
        │
        ▼
   G-49 CapabilityBridge（permissions 静态声明 → 网关策略）
```

**manifest 是 Capability IR 的"静态声明版"**：开发时写 manifest，运行时 G-48 据此选择 Adapter，
G-49 据此生成网关策略。**三者共享同一份能力语义**（原则 #0 不绑定小程序能力）。

---

## 5. conformance 断言

- `SCAFF-01`：生成的 manifest 可被 `proteus build` 解析为有效 AppManifest
- `SCAFF-02`：缺少 `rationale` 的 restricted capability → 审计失败（AUD-01 扩展）
- `SCAFF-03`：manifest 的 capabilities 与源码实际调用**一致**（不一致 → AUD-01）

---

*下一份：`06-debug-protocol.md`（A3：调试协议，复用 devtools（G-34）TraceBus）。*
