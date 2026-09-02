# Proteus G-30：任意端接入能力（Universal Backend）

> **Layer**: L1 方法论层
> **Status**: Draft
> **Depends on**: G-27 / G-28 / G-29 / 原则 #10

---

## 一句话

> **只要一个平台能提供「渲染宿主 + 原生能力宿主 + JS 运行时」三者之一，它就可以通过实现一个 Backend 接入 Proteus。**
> 四层全部可插拔（编译 G-29 / 逻辑 JSI / UI G-27 / 能力 G-28）⇒ **对任意端开放，对任意端收敛。**

---

## 文档导航

| 文件 | 内容 |
|------|------|
| **`G-30-universal-backend.md`** | ★ 主文档：形式化定义 / Tier 模型 / 五步接入 / 边界 / 对标 FAQ |
| `rules.md` | 铁律 G-30.1-4 + capabilities 分级（进规约铁律总表） |
| `capability-mapping.md` | 端 × 能力矩阵 + L1/L2/L3 分级 + 冷启动流程 |
| `degradation.md` | 降级原语 `@conditional` / `defineCapability` / 编译期裁剪 |
| `conformance.md` | Backend conformance test 框架（可信性根基） |
| `comparison.md` | 小程序 API 映射 vs 语义 IR（对外话术素材） |
| `batches.md` | B1-B5 落地分批 + 路线图落点 + DoD |
| `architecture-update.md` | 规约增量（合并进 `proteus-architecture.md`） |

---

## 核心断言

```
Platform = (R, C, J)

R: 渲染宿主 → ProteusRenderBackend (G-27)
C: 能力宿主 → ProteusNativeBackend (G-28)
J: JS 运行时 → JSI

Tier 1: R+C+J  → 一等公民（零代价）
Tier 2: 缺一   → 受限可用（编译期裁剪）
Tier 3: 仅 R   → 纯渲染（Flutter/Skia/VR）
Tier 4: 仅 J   → Headless（SSR/Agent）
```

---

## 与传统框架的本质差异

> **传统**：小程序 API = 标准，其他端翻译过去（条件编译 `#ifdef`）
> **Proteus**：框架语义 IR = 标准，各端 Backend 实现（SPI + conformance）

详见 `comparison.md`。

---

## 可信性证明

"任意端"不是口号，可被三者证明：

1. **形式化**：Tier 模型 + 三元组定义 + 明确边界（`G-30-universal-backend.md` §1, §2）
2. **可操作**：Backend 五步接入法 + ~15 方法门槛（`capability-mapping.md` §5）
3. **可验证**：conformance test 强制，CI 自动校验（`conformance.md`）—— **★ B3 车机演练是关键证据**

---

## 状态

- **Status**: Draft
- **规划体系**：46 → **47 份**（L1 方法论层 8 份）
- **待评审**：Tier 阈值 / conformance 用例集 / B3 工作量

---

## 下一步

合并进规约 + 更新 positioning（建议一次性收口）：

1. `architecture-update.md` → 合并进 `proteus-architecture.md`（原则 #10 泛化 + 铁律）
2. `proteus-positioning-v3.md`：
   - §4 架构分层补「任意端接入（G-30）」
   - §5 杀手特性补「**任意端：只要实现 Backend 即一等公民**」
   - §6 对标矩阵补「新端接入成本 / 端差异处理 / 能力缺失时机」
   - §9 规划体系 47 份
3. 路线图：G-30 B1/B2 → M1，B3/B4 → M2（★ B3 为关键验证点）
