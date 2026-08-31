# CI 策略（占位）

> ⚠️ **本章为占位章节**。CI 环境方案（官方云测 vs 自建 Mac runner）**待定**，本节只定义接口与约束，不给出可执行实现。

## 已知约束
1. **小程序 automator 必须 GUI**，无法在 Linux headless 节点直接运行
2. 可选后端：
   - **官方云测**（微信云测试服务）—— 省心、付费、真机矩阵
   - **自建 Mac runner**（GitHub Actions macOS / 自建 Mac mini）—— 可控、需维护 IDE 版本
3. 决策未定前，CI 只跑 **L1-L3 + 编译快照 + Web Playwright**

## 预留接口

```ts
// test-runner/ci.ts（待实现）
export interface CiDriver {
  runUnit(): Promise<void>        // L1-L3 + 快照，所有节点可跑
  runWebE2E(): Promise<void>     // Playwright
  runMpE2E(): Promise<void>      // automator —— 仅 Mac / 云测节点
}
```

## CI 流水线骨架（待定稿）

```
lint + typecheck
  └─ vitest (L1-L3 + 快照)         ← 所有节点
       └─ playwright (Web E2E)     ← 所有节点（headless chromium）
            └─ automator (MP E2E)  ← [Mac runner / 云测] 条件执行
```

## TODO（启动 M7 时补齐）
- [ ] 决策：官方云测 vs 自建 Mac runner
- [ ] Mac runner 镜像标准化（微信 IDE + Node + CLI 版本锁定）
- [ ] 云测 API 接入与凭证管理
- [ ] E2E 失败制品归档（截图 / DevTools dump / trace）
- [ ] 并行策略：150 页 Blueprint 不能串行跑一整晚

---
