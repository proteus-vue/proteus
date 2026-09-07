# Batches & Roadmap: G-30 落地计划

> 配套 `architecture-update.md` §5 路线图落点。

---

## 1. 分批总览

| 批次 | 目标 | 依赖 | 交付 |
|------|------|------|------|
| **B1** | 形式化定义 + Tier 模型 + capabilities schema | — | 本文档集 + JSON Schema |
| **B2** | conformance test 框架 | B1 | `test:backend` CLI |
| **B3** | 车机 Backend 冷启动演练（★关键验证） | B1, B2, G-27 | `@proteus/backend-car` 原型 |
| **B4** | 降级原语 `@conditional` + 编译期裁剪 | G-29 | Compiler Plugin |
| **B5** | 官方指南 + 模板工程 | B1-B4 | `create-proteus-backend` |

---

## 2. B1：形式化定义（M1）

**目标**：把"任意端"从口号变成可讨论的工程定义。

**交付**：
- [x] `G-30-universal-backend.md`（主文档）
- [x] `rules.md`（铁律）
- [x] `capability-mapping.md`（端×能力矩阵）
- [x] `architecture-update.md`
- [ ] `capabilities.schema.json`（JSON Schema，供 IDE 校验 backend.config.ts）

**退出标准**：
- Tier 模型覆盖所有已知端（移动/桌面/Web/小程序/自绘/车机/IoT/VR/Headless）
- 明确"不可接入"边界（§7 风险）

---

## 3. B2：conformance test 框架（M1）

**目标**：让"接入"可被自动验证。

**交付**：
- [ ] `proteus test:backend` CLI
- [ ] 四类测试套件（IR 等价 / capabilities / 降级 / 性能）
- [ ] 报告生成器（conformance report）

**退出标准**：
- 现有 5 个官方 Backend（VueDom/Native/Flutter/Skia/Headless）全部通过
- 新增 Backend 仅需 `pnpm test:backend` 即知是否合格

---

## 4. B3：车机 Backend 冷启动演练（M2，★）

**这是"任意端"的可信性证明。** 论据（论证）在 B1/B2，验证在 B3。

**目标**：框架团队之外的人，3 天内接入一个没人预研过的端。

**设定**：
- 端：车机（典型 Tier 2：有渲染 + 有蓝牙/USB，但无相机、无小程序环境）
- 实现者：1 名不熟悉 Proteus 内部的开发者
- 约束：仅用 `create-proteus-backend` 模板 + 文档

**交付**：
- [ ] `@proteus/backend-car` 原型
- [ ] capabilities：`camera: false, bluetooth: true, scanQR: false ...`
- [ ] 示例 App：扫码页在车机上自动降级为"手动输入"（验证 `@conditional`）
- [ ] 演练复盘报告：实际耗时 / 卡点 / 文档缺口

**退出标准**：
- 3 天内跑通基础渲染 + 能力降级
- conformance report: PASS (Tier 2)
- 发现的问题回流到 B1 文档 / `create-proteus-backend` 模板

---

## 5. B4：降级原语 + 编译期裁剪（M2）

**目标**：把"端差异"收敛到语义层。

**交付**：
- [ ] `<p-conditional>` 组件 + Compiler 编译期分支
- [ ] `defineCapability()` 命令式降级
- [ ] 编译期报错信息（含 3 种解决方式提示）
- [ ] 降级测试套件

**依赖**：G-29（Compiler SPI）—— 裁剪逻辑本身是 Compiler Backend 的职责。

---

## 6. B5：官方指南 + 模板工程（M3）

**目标**：让"写 Backend"成为社区可参与的事。

**交付**：
- [ ] `pnpm create proteus-backend <name>` 模板
- [ ] "Write a Backend" 官方指南（基于 B3 复盘）
- [ ] Backend 发布规范 + 审计流程（沿用 G-28 生态治理）

---

## 7. 与 M1/M2/M3 的关系

| 里程碑 | 包含 G-30 内容 |
|--------|----------------|
| **M1 地基（0-3月）** | B1（定义）+ B2（conformance） |
| **M2 能力（4-9月）** | B3（车机演练★）+ B4（降级原语） |
| **M3 生态（10-18月）** | B5（指南 + 模板 + 社区） |

**关键路径**：
```
G-27 B1 (nodeOps SPI) ─┐
G-29 B1 (CompilerIR)  ─┤
G-30 B1 (Tier 模型)   ─┤── 三者 M1 同期（都是"定义 SPI shape"）
                        ↓
G-30 B3 (车机演练) ← ★ 依赖 G-27 成熟
```

---

## 8. 成功判据（Definition of Done）

G-30 视为"完成"当且仅当：

1. ✅ Tier 模型 + capabilities schema 成文且被工具消费
2. ✅ `test:backend` conformance 框架可用，官方 Backend 全通过
3. ✅ **B3 车机演练成功**（外部人 3 天内接入）
4. ✅ `@conditional` + 编译期裁剪在示例 App 跑通
5. ✅ `create-proteus-backend` 模板发布，社区可贡献

**只有 3 成功，"任意端"才是真的。** 其余四条是工程支撑。
