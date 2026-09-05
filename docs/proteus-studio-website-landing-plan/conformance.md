# G-60 Conformance

> **自测数字为实测值，非估算**：`node reference-impl.cjs` → `self-test: 91/91`

## 1. 不变量

| ID | 命题 | 验证方式 | 全局编号 |
|----|------|---------|---------|
| **INV-W1** | 插件 API 文档从 WIT 单一数据源生成，**漂移即阻断** | `checkDrift()` 返回 `stale` 时 CI 失败 | CMP-207 |
| **INV-W2** | 版本快照由 release tag 触发，**禁止人工决定时机** | 流程约束（CI 配置），见 06 章 | CMP-208 |
| **INV-W3** | 版本无关内容存 `/shared` 单一源，**禁止跨版本复制** | `buildVersionDocs()` 返回同一对象引用 | CMP-209 |
| **INV-W4** | 每页版本横幅含**版本号 + 状态 + 最新版等价页深链** | `bannerFor().linkToLatest` 指向同一 path | CMP-210 |
| **INV-W5** | 废弃状态由**元数据驱动**注入，`noindex` 自动 | `shouldIndex()` 对 deprecated/archived 返回 false | CMP-211 |
| **INV-W6** | 未知版本返回 `null`，**禁止静默降级到 latest** | `resolve('9.9') === null` | CMP-212 |
| **INV-W7** | **破坏性变更必须被 diff 拦截** | `diffSpecs().breaking` 非空即阻断 | CMP-213 |
| **INV-W8** | 产物**缺签名拒绝分发** | `validate()` 返回 `ARTIFACT_UNSIGNED` | CMP-214 |

## 2. 反模式

| ID | 反模式 | 为什么错 | 全局编号 |
|----|--------|---------|---------|
| **AP-W1** | 手写 API 参考页 | P1：drifts the day after it is written | CMP-215 |
| **AP-W2** | 跨版本复制共享内容 | P2.2：一处修正要手工应用 N 次，必然漏 | CMP-216 |
| **AP-W3** | 用 URL / 下拉框传达版本 | P2.3：阅读流中的用户不看地址栏 | CMP-217 |
| **AP-W4** | 手工编辑 markdown 加废弃标记 | P2.4：必然漏页、口径不一致 | CMP-218 |
| **AP-W5** | 未知版本静默降级到 latest | 用户以为看的是目标版本 → 按新版写码跑旧版报错 | CMP-219 |
| **AP-W6** | 官网数字未标注"目标/实测" | 违反 G-37；官网是数字虚报高发区 | CMP-220 |

## 3. 接缝命题（跨 G 编号）

| ID | 命题 | 全局编号 |
|----|------|---------|
| **J1** | G-58 WIT `since` 版本并存 ∧ G-60 文档按版本路由 → 多版本 API 可查 | CMP-221 |
| **J2** | G-59 保留策略 ∧ G-60 结构化公示 → 治理规则对外可见 | CMP-222 |
| **J3** | G-56 Studio 产物 ∧ G-60 下载矩阵 → 分发可信 | CMP-223 |
| **J4** | G-37 宣称可验证 ∧ G-60 `source_hash` 锚点 → 文档可信可被机器校验 | CMP-224 |
| **J5** | G-51 `SKIP ≠ PASS` ∧ G-60 未知版本返回 `null` → 不静默降级 | CMP-225 |
| **J6** | G-59「警告会被忽略，故须硬拒绝」∧ G-60 漂移 `stale` 阻断 | CMP-226 |
| **J7** | 原则 #0「不绑定」∧ G-60 shared 单一源不复制 → 复制 N 份即绑定 N 次 | CMP-227 |

## 4. 用例覆盖（合计 91，实测）

| 分组 | 条数 | 覆盖 |
|------|------|------|
| 版本注册表（解析 / 状态 / 索引 / 横幅 / 保留） | 19 | INV-W4, W5, W6 |
| canonical 与等价页 | 3 | P2.6 |
| 导航树与断链 | 8 | 断链机器检测 |
| 共享内容单一源 | 3 | INV-W3, J7 |
| ApiSpec / 渲染 / 漂移 | 16 | INV-W1, J4 |
| lintSpec | 5 | SPEC_LINT |
| diffSpecs 破坏性分类 | 10 | INV-W7 |
| 下载矩阵与 endpoint | 9 | INV-W8 |
| 负向与边界 | 11 | 空树 / 空 spec / 无 active 版本 / 未知 arch |
| 接缝命题 | 7 | J1–J7 |

## 5. 负向自检清单

| ID | 用例 | 期望 |
|----|------|------|
| NEG-01 | 单版本站点 | `resolve('latest')` 正常，无 archived 候选 |
| NEG-02 | 全部 deprecated（无 active） | `latest()` 为 `null`，**不崩溃** |
| NEG-03 | 空 ApiSpec | hash 仍可计算（8 位） |
| NEG-04 | 空 entries 渲染 | 不崩溃，输出"暂无 API" |
| NEG-05 | 未知版本取横幅 | 返回 `null` |
| NEG-06 | 空字符串链接 | 被 `brokenLinks()` 捕获为 `empty` |
| NEG-07 | 未知 arch 下载 | 返回 `null`，**不降级到近似平台** |
| NEG-08 | 仅空白字符描述 | `lintSpec` 视为缺失 |

## 6. 本份未覆盖（诚实边界）

- **INV-W2 无法由参考实现验证**——它是 CI 流程约束，需检查实际 pipeline 配置
- **未真实构建站点**：选型基于文档与第三方记录，非实测
- **WIT parser 未实现**：`ApiSpec` 当前由测试直接构造，真实解析链待阶段 2
- **性能预算未测**：首屏时间、构建时长等均为目标值
- **75% 与周下载量数据**：见 00-pain-points.md 的局限声明，不得对外引用
