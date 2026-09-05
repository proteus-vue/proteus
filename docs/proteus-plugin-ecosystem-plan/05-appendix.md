# G-59 附录

## A. 五条痛点 → 八条不变量 完整映射

| 痛点 | 不变量 | 机制 |
|------|--------|------|
| P1 激活无契约 | INV-ECO-01 | 拒绝 `*`，单插件/全局双预算 |
| P1 去激活不回收 | INV-ECO-02 | 去激活契约 + 未清理记入审计 |
| P2 升级即破坏 | INV-ECO-03 | WIT 并存，老版本可解析 |
| P2 破坏不可度量 | INV-ECO-04 | breakingRate 作为看板指标 |
| P4 第一方 API 致命 | INV-ECO-05 | 数据敏感度四级 + 保守默认 |
| P3 平台下场 | INV-ECO-06 | 内置同构断言（**仅限技术层面**） |
| P5 废弃留坑 | INV-ECO-07 | 废弃必须提供 replacement |
| P4 延迟激活 | INV-ECO-08 | 更新即重授权 + 高敏访问审计 |

## B. 数据敏感度分级表（代表性）

| API | Tier | 依据 |
|-----|------|------|
| `env.appVersion` | `public` | 公开信息 |
| `workspace.readFile` | `workspace` | 项目内容 |
| `diagnostics.publish` | `workspace` | 诊断信息 |
| **`clipboard.readText`** | **`credentials`** | 实证：刮取助记词/私钥 |
| **`clipboard.writeText`** | **`credentials`** | 实证：替换剪贴板地址 |
| `env.variables` | `credentials` | 常含 token |
| `git.config` | `credentials` | 含用户身份 |
| `fs.readHomeSsh` | `secrets` | SSH 私钥 |
| `keystore.read` | `secrets` | 密钥库 |
| **（未登记 API）** | **`secrets`** | **保守默认** |

## C. 为什么不逐个列危险 API

枚举"危险 API"是**追不上的**：
- 新 API 持续加入
- 组合无穷（单个无害，组合有害）
- 第一方"无害"API 是最大的盲区（clipboard 实证）

**数据敏感度是有限集合，API 是无限集合。在有限集合上建模型才收敛。**

## D. 反模式

- **AP-ECO-01** 允许 `activationEvents: *`（个体理性 → 集体劣化）
- **AP-ECO-02** 超预算只警告不拒绝（警告会被忽略）
- **AP-ECO-03** 按 API 危险度授权（追不上，且漏第一方 API）
- **AP-ECO-04** 代码哈希变化不重新授权（信任被继承 = 给了攻击窗口）
- **AP-ECO-05** 废弃不提供 replacement（重演 Webview UI Toolkit）
- **AP-ECO-06** 内置插件用私有 API 做竞品功能（摧毁生态信任）
- **AP-ECO-07** 破坏率不对外公开（不可度量 = 无承诺）

## E. 与 G-55 性能工程的关系

G-55 处理**内核性能**（索引、缓存、查询延迟）；
G-59 L0 处理**插件启动性能**。两者是同一"高性能第一原则"的两个切面：

```
G-55: 内核冷启动 < 500ms
G-59: 插件全局启动预算 800ms
      → 宿主整体冷启动目标 < 1.3s
```

⚠️ 这个 1.3s 是**推导值**（500 + 800），非实测，且两者可能有重叠部分。

## F. 接缝命题

**G-58 INV-EX（沙箱隔离）∧ G-59 INV-ECO-05（数据分级）**
→ 插件既无法逃逸沙箱，也无法通过"无害 API"触及高敏数据
→ 数据流而非控制流成为安全边界
