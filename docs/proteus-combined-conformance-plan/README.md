# Proteus G-47 — 组合一致性 Conformance (Combined Conformance)

> **G-27（外·渲染）× G-46（内·资源）的组合正确性证明**
> 方法论第十一次泛化：不绑定"测试层级"

## 为什么需要 G-47

G-27 与 G-46 各自 conformance 通过，**交界处仍可静默失败**：

- 切后端后登录态丢失（会话字段未随 IR 传递）
- Flutter Backend 自维护空 Token（不读共享池）
- 切后端 ∩ 登出的竞态 → 僵尸会话

**G-47 用六个机器断言的不变量证明"切后端时数据链不断"。**

## 快速开始

```bash
# 1. 看演示（23 项组合测试）
node reference-impl.cjs

# 2. 完整自检
bash verify.sh
```

## 六不变量

| ID | 含义 |
|----|------|
| INV-01 | 切后端登录态不丢 |
| INV-02 | 切后端缓存不丢 |
| INV-03 | 登出 × 切后端交换律 |
| INV-04 | 并发不崩溃 |
| INV-05 | 同 IR 同资源视图 |
| INV-06 | 降级不崩溃 |

## 核心设计

**P1 资源归宿主**：登录态在共享 ResourcePool，不在 Backend
**P2 单向依赖**：Backend 只读池（`readAuth`），不缓存
**CCI-02**：`unmount()` 不得销毁池资源（NEG-02 验证）

## 文件结构

```
01-problem.md           问题定义
02-architecture.md      测试金字塔 + 组合点
03-spi.md               Backend × Pool 契约
04-security.md          CCI 铁律 + 攻击树
conformance.md          23 项测试映射
reference-impl.cjs       ★ 可运行实现 (23/23)
rules.md                CCI-01-06 + CMP097-102
architecture-update.md  原则 #13.34-36
verify.sh              自包含验证
pack.sh                安全打包
```

## 依赖

- G-27 RenderBackend SPI
- G-44 Test IR（INT 系列）
- G-45 装载即验证（Backend 装载时跑 G-47 快检）
- G-46 ResourcePool（docs/proteus-resource-pool-plan：L1/L2/L3 + 双轨 + 所有权）

详见 `01-problem.md` §1.2。

---
*Status: v1 — 2026-09-03*
