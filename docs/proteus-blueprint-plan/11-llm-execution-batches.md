# LLM 分批执行

> **目标**：把"150 页超级应用验证"拆成 LLM 可逐步执行的批次，避免上下文撑爆

---

## 11.1 批次总览（对齐前面 15 份 plan 的批次格式）

```
阶段 1：基础设施（不依赖业务）
  Batch 1.1: monorepo 初始化 + pnpm workspace
  Batch 1.2: 15 份 plan 的 packages/* 结构
  Batch 1.3: CI 矩阵骨架

阶段 2：核心模块（播放器 + 用户）
  Batch 2.1: Pinia stores (player, user, auth)
  Batch 2.2: audio + auth capability
  Batch 2.3: PlayerBar (appBar) + 播放页
  Batch 2.4: Lifecycle 集成 (onShow/onHide/onRecover)

阶段 3：交易模块
  Batch 3.1: 权限树 + Router 守卫
  Batch 3.2: 支付 API + Security 签名
  Batch 3.3: i18n + 交易页面

阶段 4：社交 + 内容
  Batch 4.1: WebSocket + 聊天长列表
  Batch 4.2: SSR + 瀑布流

阶段 5：集成验证
  Batch 5.1: 契约测试 (C1-C10)
  Batch 5.2: 编译产物快照
  Batch 5.3: DevTools 六泳道 trace

阶段 6：构建 + E2E
  Batch 6.1: 三端 build + 分包
  Batch 6.2: 真机 E2E
  Batch 6.3: 性能基线
```

## 11.2 单批 Prompt 模板

```markdown
## 当前批次：Batch 2.1 (Pinia stores)

### 上下文（只给这些，不喂全部文档）
- overview.md (铁律)
- 03-feature-music-player.md (本功能域规格)
- 对应 plan: proteus-pinia-plan/01-storage-adapter.md

### 任务
实现 `stores/player.ts`，要求：
1. 使用 defineStore (Setup API)
2. persistence: eager/lazy/volatile/encrypted 配置
3. 导出 usePlayerStore()

### 验收
- [ ] vitest 单元测试通过
- [ ] `--trace-transform` 无违规
- [ ] 对齐 Pinia M7 分片设计
```

## 11.3 依赖图（批次执行顺序）

```
1.1 → 1.2 → 1.3
              ↓
2.1 → 2.2 → 2.3 → 2.4
                    ↓
3.1 → 3.2 → 3.3
              ↓
4.1 → 4.2
        ↓
5.1 → 5.2 → 5.3
              ↓
6.1 → 6.2 → 6.3
```

**关键约束**：每个批次合并后必须**全绿**（测试 + audit）才能进下一批。

## 11.4 防撑爆规则（沿用前面约定）

- LLM 单次只吃：overview + 当前批次文件 + 直接依赖 plan
- 每份 plan 文件 = 一个上下文单元
- 批次间通过 `git commit` 沉淀，不靠上下文传递
- CI 自动跑全量 audit（不依赖 LLM 记忆）

---
