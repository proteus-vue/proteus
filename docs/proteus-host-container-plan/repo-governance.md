# 仓库与工程治理：三层仓库形态与严禁 fork 铁律

> **定位**: G-42 核心文档之一
> **核心铁律**: **G-42.6 — 宿主仓库严禁 fork 框架源码**

---

## 1. 为什么必须定死仓库形态

### 1.1 不定死的后果

如果仓库形态不明确，生态会自然演化成：

```
宿主团队需要定制 → 复制框架源码 → 改一改 → 自己的版本
                        ↓
        框架发布 v2 → 宿主无法升级（改过的代码冲突）
                        ↓
        宿主永远锁死在 v1 → 生态碎片化
```

**这是 uni-app / RN 生态的真实写照**——大量公司内部 fork 了一份框架，永远升不了级。

### 1.2 定死后的收益

```
框架主仓（唯一的源码真相）
    ↓ 发 npm / ohpm 包
宿主 App 仓（只依赖，不 fork）
    ↓
框架升级 = 改 package.json 版本号
```

---

## 2. 三层仓库形态

```
┌─ L1 框架主仓（monorepo）──────────────────────┐
│  proteus/                                     │
│  ├── packages/core          IR/Diff/调度/内核  │
│  ├── packages/compiler-node 官方编译后端       │
│  ├── packages/render-*      官方渲染后端       │
│  ├── packages/host-*        官方宿主运行时     │
│  ├── packages/container-*   官方容器策略       │
│  └── spec/                  规约 + conformance │
│                                               │
│  → SPI 定义 + 官方实现 + 规约，三位一体        │
└───────────────────────────────────────────────┘
              ↓ 发独立 npm / ohpm 包
┌─ L2 宿主 App 仓（业务侧，独立）───────────────┐
│  my-superapp/                                 │
│  ├── 集成 proteus/core + 选定 Backend/Container│
│  ├── 实现/定制自己的 HostContainer（可选）     │
│  └── 业务代码                                  │
│                                               │
│  → 不 fork 框架，只依赖 + 组合                 │
└───────────────────────────────────────────────┘
              ↓ 社区贡献
┌─ L3 社区 Backend 仓（完全独立）───────────────┐
│  proteus-render-xxx（任何人可发）              │
│  proteus-container-xxx                        │
│                                               │
│  → 只需通过 conformance，进 registry           │
└───────────────────────────────────────────────┘
```

---

## 3. 铁律 G-42.6：严禁 fork

### 3.1 规则定义

> **宿主仓库严禁复制/内嵌 Proteus 框架源码。**
> **所有定制必须通过：① 官方扩展点 ② 依赖替换 ③ 组合配置 实现。**

### 3.2 允许的定制方式

| 需求 | 正确做法 | 禁止做法 |
|------|---------|---------|
| 换渲染引擎 | `npm i proteus-render-flutter` | 复制 core 改 nodeOps |
| 换容器策略 | `createContainer('superapp', opts)` | 复制容器源码改逻辑 |
| 加原生能力 | 实现 `ProteusCapabilityBackend` 发包 | 改框架 bridge 代码 |
| 改编译行为 | 实现 `ProteusCompilerBackend` | 改官方编译器 |
| 定制主题 | design-tokens 覆盖 | 改组件源码 |

### 3.3 机器可检查

```bash
# conformance 检查（CI 门禁）
proteus conformance --repo ./my-superapp
# 检查项：
#   - 宿主仓是否包含框架源码副本（源码指纹比对）
#   - 是否直接 import 框架内部模块（非公开 API）
```

**命中即 CI 失败。**

---

## 4. 版本策略

### 4.1 语义化版本 + SPI 兼容性承诺

| 版本段 | 含义 | 兼容性承诺 |
|--------|------|-----------|
| **Major** | 破坏性变更 | SPI 可能不兼容，需迁移 |
| **Minor** | 新能力 | SPI 向后兼容 |
| **Patch** | 修复 | 完全兼容 |

### 4.2 SPI 版本协商

框架与 Backend/Container 之间**运行时协商版本**（G-27/G-39/G-42 均实现 `versionNegotiation`）：

```typescript
interface VersionNegotiation {
  readonly spiVersion: string        // 容器实现的 SPI 版本
  readonly coreVersion: string       // 期望的框架版本
  isCompatible(core: string): boolean
}
```

不兼容时**启动即报错**，不是运行时崩溃。

### 4.3 升级路径

```
宿主升级框架：
  1. 改 package.json 版本号
  2. 跑 proteus conformance（验证 Backend/Container 仍兼容）
  3. 跑业务测试
  → 完成

（对比：fork 过的仓库 → 手动 merge 冲突 → 永远升不完）
```

---

## 5. 依赖契约

### 5.1 宿主允许依赖的包

```
✅ @proteus-vue/core                公开 API（IR / 生命周期 / 调度）
✅ @proteus-vue/host-{platform}     官方宿主运行时
✅ @proteus-vue/container-{type}    官方容器策略
✅ @proteus-vue/render-{engine}     官方/社区渲染后端
✅ @proteus-vue/capability-{xxx}    官方/社区能力包

❌ @proteus-vue/core/internal/*     内部模块（禁止直接 import）
❌ 复制的框架源码                （G-42.6 禁止）
```

### 5.2 公开 API 边界

框架必须明确区分：
- `exports`（公开，有兼容性承诺）
- `exports/internal`（内部，无承诺，禁止外部依赖）

---

## 6. 与竞品对比

| 维度 | uni-app / RN 生态 | **Proteus（G-42 治理）** |
|------|------------------|------------------------|
| 仓库形态 | 未定义 → 自然 fork | **三层明确定义** |
| fork 现象 | 普遍 | **铁律禁止 + CI 检查** |
| 升级成本 | 高（merge 冲突） | **低（改版本号 + 跑 conformance）** |
| 定制方式 | 改源码 | **扩展点 / 依赖替换 / 组合** |
| 生态碎片化 | 严重 | **受控（conformance 统一）** |

---

## 7. 小结

> **仓库形态不是"工程细节"，是生态能否长期演进的架构决策。**
> **G-42.6 的"严禁 fork"看似限制，实则是保护——**
> **它保证框架升级时，所有宿主都能跟上，而不是锁死在旧版本。**
