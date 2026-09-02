# Proteus Semantic Primitives (G-32)

> **完整语义原语架构**：6 大类 · 128 原语 · 覆盖小程序官方能力 100%  
> 以小程序现行全量能力为「完整性标尺」，但不继承其 API 设计。

---

## 目录结构

```
proteus-semantic-primitives/
├── G-32-complete-semantic-architecture.md   ★ 主文档（五支柱 + 128 原语总览 + 铁律 + 分批）
├── capability-catalog.md                    能力原语明细（50 个，含 TS 签名 + 降级）
├── miniprogram-mapping.md                   ★ 小程序全量对照矩阵（覆盖率审计口径）
├── degradation.md                           降级设计（@conditional + Tier 矩阵）
├── batches.md                               分批落地（B1-B6）+ 协同 + DoD
├── rules.md                                 铁律 G-32.1-5 + CMP009-012
├── migration-examples.md                    ★ 语义优先迁移示例（逐场景对照）
├── architecture-update.md                   规约增量
├── README.md                                ★ 本文件
├── MANIFEST                                  预期文件白名单
├── pack.sh                                  打包（仅 MANIFEST 文件，store 模式）
└── verify.sh                                校验（MANIFEST 严格核对 + SHA256 复算）
```

---

## 核心结论

> **Proteus 内置原语覆盖小程序官方能力的 100%（组件 100% + API 类别 100%），但不与小程序 API 兼容——全部重写为语义优先、Hook 化、类型安全、Backend 无关的原语。API 兼容由独立的 `@proteus/compat-miniprogram` 承担。**

### 128 原语分布

| 类别 | 数量 | 范围 |
|------|------|------|
| ① 布局 Layout | 12 | G-22 泛化（消灭 swiper/scroll-view/movable-view 为属性） |
| ② UI | 18 | 视图/文本/媒体/输入 |
| ③ Shell | 10 | 页面/路由/弹层/分栏 |
| ④ Gesture | 10 | 手势 = 声明式约束（v-gesture:*） |
| ⑤ Capability | 50 | G-28 系统化（全部 useXxx() Hook） |
| ⑥ Engineering | 28 | 状态/路由/动画/调试 |
| **合计** | **128** | |

### 覆盖率审计

```
小程序官方组件：42 个 → ✅ 42（80% L1 + 20% L2/私有）
小程序 API 类别：~120 → ✅ 116 + 🔄 4（私有收敛到 useMiniProgram）
总计：100% 覆盖，缺口 = 0
```

---

## 与既有 plan 的关系

```
PROTEUS-METHODOLOGY（原则#0）
   └─ 五支柱 → G-32 = 支柱②「接口与实现解耦」在「原语完整性」上的工程化收口
        └─ G-22 柔性布局 → ① 布局原语
        └─ G-24 系统集成 → ⑤ 能力原语
        └─ G-31 组件/API 语义化 → ② ③④⑥ + 铁律 G-32.x
```

### 直接对接

- **G-28 NativeBackend SPI** ← ⑤ Capability 50 直接映射
- **G-27 RenderBackend** ← ① ②③④ 的 Backend 渲染
- **G-30 conformance** ← `audit:coverage` + 降级测试
- **G-31 C-IR** ← 原语属性约束
- **G-17 路由** ← ⑥ Engineering 的 `router.*`

---

## 打包与校验

```bash
# 打包
./pack.sh

# 校验（MANIFEST 严格核对 + SHA256 复算）
./verify.sh
```

**校验逻辑**：
1. `unzip -t` 检查完整性
2. MANIFEST 白名单核对：预期文件全部存在 + 无多余文件
3. SHA256 复算，与 CHECKSUM.md 逐条比对
4. 关键术语在位检查（ProteusRenderBackend / useNative / Component IR / G-32 / CMP009 等）

> **关键**：verify 脚本不自行判断"哪些文件该有"，全部以 MANIFEST 为准。任何缺文件/多文件 → 直接 FAIL。

---

## 规划体系

```
48 (G-31 之前) + 1 (G-32) = 49 份 plan + 1 哲学 + 1 规约
```

---

## 待办（路线图）

- [ ] **B1**：原语清单冻结 + C-IR schema + `audit:coverage`（M1，与 G-27/29/30/31 B1 同批）
- [ ] **B2**：布局 + UI（Web/DOM）
- [ ] **B3**：能力 50（Native iOS/Android）
- [ ] **B4**：Shell + Gesture
- [ ] **B5**：工程原语
- [ ] **B6**：自动化 + codemod

详见 `batches.md`。

---

## License

Part of Proteus Architecture Plans. Internal use.
