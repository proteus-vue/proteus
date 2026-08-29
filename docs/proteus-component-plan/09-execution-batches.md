# 分批执行策略（防上下文撑爆）

> 原则：同 Pinia/Router/API 规划——**每份 `.md` = 一个独立上下文单元，每批 = 一个可合并 PR，LLM 单次只吃「overview + 当前模块 + 直接依赖」**。

---

## 1. 批次总览（8 批 = 8 个 PR）

```
B1  M1 规范 + 渲染抽象 + capability       → 地基
B2  M2 基础组件 P0（View/Text/Image/ScrollView/Button）
B3  M3 长列表 + 虚拟滚动 + 懒加载
B4  M4 弹层体系 + Worklet 转场
B5  M5 导航栏 + appBar 集成
B6  M6 业务组件（5 个）
B7  M7 性能/内存/降级（超级应用加固）
B8  M8 可观测 + DevTools + CI 审计
```

依赖图：
```
B1 ─→ B2 ─→ B3 ─→ B7 ─→ B8
            ↘ B4 ─→ B5 ─→ B6 ─→ B8
```
- B3/B4 可并行（依赖仅 B2）
- B6 依赖 B4+B5 + Pinia M7 + API A4/A5
- B7/B8 串行收尾

---

## 2. 单批上下文预算

| 项 | 预算 |
|----|------|
| 本批主文档 | 1 份 |
| 直接依赖文档 | ≤ 2 份 |
| 现有代码引用 | 仅接口签名，不贴全文 |
| 目标 tokens | ≤ 24k（约 90k 字符） |

---

## 3. Prompt 模板

### B1 Prompt（示例）
```
你是 Proteus 组件层实现者。请只依据以下上下文完成 B1：

【必读】
- 00-overview.md（架构 + 铁律 C1-C8）
- 02-platform-capability.md（完整）
- 关联：proteus-pinia-plan/04-lightweight-persistence.md（Storage 接口签名，仅读签名）

【可选参考，不要全读】
- 03-base-components.md（PView 部分，仅接口）

【任务】
1. 实现 packages/components/src/runtime/capability.ts（PlatformCapability 接口 + Web/Skyline 探测）
2. 实现三端渲染抽象骨架（web/skyline/app 三个目录，接口即可）
3. 补 Vitest 单测：mock capability 验证两条分支
4. 更新 02 文档：补充实现细节（如探测函数清单）

【硬约束】
- 组件代码不得出现 `wx.*` / `document.*`（用 capability 抽象）
- 每个 capability 探测函数必须有降级默认值
- 不引入重型依赖
- 产出：可运行的 capability 单测 + 三端骨架 + 文档同步

完成后输出：变更文件清单 + 未解决问题（若有）。
```

### 通用规则（所有批次遵守）
1. **先读 overview + 本批文档**，再读依赖文档的「接口签名段」，不贴全文。
2. **一次只实现一个组件/模块**，完成即停，不超前写 B6。
3. **文档与代码同步**：实现完必须回填对应 `*.ir.md` 与矩阵条目。
4. **跑测试再收尾**：单测/快照必须绿。
5. **禁止跨批修改**：B3 不动 B4 的 popup 代码。

---

## 4. 进度追踪

| 批 | 状态 | PR | 依赖满足 |
|----|------|-----|----------|
| B1 | ⬜ | — | — |
| B2 | ⬜ | — | B1 |
| B3 | ⬜ | — | B2 |
| B4 | ⬜ | — | B2 |
| B5 | ⬜ | — | B2 |
| B6 | ⬜ | — | B4,B5, Pinia M7, API A4/A5 |
| B7 | ⬜ | — | B3,B4 |
| B8 | ⬜ | — | B6,B7, Router M8, API M8 |

---

## 5. 与既有计划的协同
- **Pinia**：B1 复用 Storage 接口；B6 业务组件读 store
- **Router**：B5（appBar）+ B4（转场）依赖 Router M5/M7.4
- **API**：B6 支付/登录组件依赖 API A4/A5
- **统一 observability**：B8 的 traceId 与三计划打通

> 执行顺序建议：**先 Pinia M1-M2 → Router B1-B5 → API A1 → Component B1-B6**。组件 B1 可并行于 Pinia/Router，但 B6 必须等三者稳定。
