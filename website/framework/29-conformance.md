---
title: 一致性验证
order: 24
group: 质量与兼容
---

# 一致性验证

> 框架只做两件事：定义「你要什么」（语义接口），定义「怎么验证做对了」（conformance）。
> 一致性验证是第二件事的机器化——后端合不合规，不由文档说了算，由门禁说了算。

## 验证什么

跨端框架最大的谎言风险：「同一份代码，多端一致」。Proteus 把这句话变成可执行的断言：

| 断言层 | 验证内容 | 失败示例 |
|---|---|---|
| IR Schema | 语义树结构合法（p- 前缀 / semantic 合法 / CMP006 降级声明 / grid 冲突） | 非法节点混入 |
| 渲染一致性 | 同一棵语义树在六端渲染出语义等价的控件树 | Web 渲染 text、原生渲染成 button |
| 组合合规 | 宿主 × 后端组合满足组合层铁律 | 切后端时销毁了资源池 |
| 能力合规 | 用到的能力在目标端已声明 | 页面用了扫码但端未声明 |

## 规则编号体系

所有规则全局编号（CMP 系列），可被工具引用、被 CI 拦截：

- **CMP 全局编号**：跨 plan 连续编号，避让登记有案（如 G-46 = CMP089-096，G-47 = CMP097-102）
- **CCI 组合层铁律**（G-47）：后端与资源池组合时的六条 error 级铁律——

| 编号 | 级别 | 铁律 |
|---|---|---|
| CCI-01 | error | Backend 不得缓存 `readAuth` 结果，每次查共享池 |
| CCI-02 | error | `unmount()` 不得销毁池内任何资源 |
| CCI-03 | error | 切后端须原子事务（mount 新 + unmount 旧不可分割） |
| CCI-04 | error | 登出与切后端须串行化（同一锁） |
| CCI-05 | error | 不可用后端必须显式抛错（禁止静默吞错） |
| CCI-06 | error | 组合 conformance 必须 100% PASS，0 warning |

- **AP 反模式系列**：已知踩坑模式的命名登记（如 AP-C3 静默吞装载错误 = CCI-05 违规）

## 门禁形态

### 1. IR 校验（进入渲染前）

`validateComponentIR` 在渲染/出码前校验语义树：p- 前缀合法性、semantic 字段合法、降级声明（CMP006）、grid 冲突检查。诊断信息即修 IR 的指引。

### 2. 六端渲染 conformance

同一棵语义树喂给六个渲染后端，语义控件映射逐一对照参考表（G-31 B5 门禁）：`ui.text → UILabel / CupertinoText / Text` 这类映射行必须成立。`test-ir` 包提供 `ConformanceRunner` 与断言运行器（`evalAssertion` / `applyAct`），支持「渲染 → 断言 → 交互 → 再断言」的状态化验证。

### 3. 能力门控（SKIP 语义）

端未声明某能力时，对应验证项 **SKIP 而非 FAIL**——门禁区分「做错了」与「没承诺做」。能力声明见[能力系统](/docs/18-capability-system)。

### 4. 宿主 × 引擎组合矩阵

6 宿主 × 6 引擎 = 36 种组合，按 Tier 声明验证范围：Tier 1（承诺验证）组合全部 `runConformance().failed === 0`；Tier 0（跨生态不合法）显式标黑。组合矩阵同时执行 CCI 铁律，防「单端正确、组合崩坏」。

## 在工程里跑

```bash
npm test                          # 单测 + 各包 conformance 用例
npm run test:e2e:web              # 浏览器 E2E
proteus conformance --repo        # 仓库级一致性报告（CLI）
```

AI 场景下同一套门禁通过 MCP 暴露：`validate_ir` → `run_conformance`（见 [AI 原生开发](/docs/32-ai-agent)）。

## 原则 #0

> 验证体系不是质量部门的 KPI，而是架构的一部分——**没有 conformance 的 SPI 是假 SPI**。
> 每一条规则编号都能追溯到一次真实踩坑或一次架构决策。

## 下一步

- [Headless 后端与语义快照](/docs/framework/25-headless-backend) —— 无设备环境跑一致性
- [测试与部署](/docs/27-testing-deploy) —— 工程内测试分层
- [容器与宿主](/docs/framework/33-containers-hosts) —— 被验证的六容器画像
