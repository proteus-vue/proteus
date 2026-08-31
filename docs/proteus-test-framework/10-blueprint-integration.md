# Blueprint 150 页集成

> 对齐 `proteus-blueprint` 的验证矩阵：把 150 页拆成**关键路径**，E2E 不全量跑（会跑一整晚），只覆盖核心链路。

## 关键路径（每条跨 ≥3 层）

| ID | 路径 | Web E2E | MP E2E | 跨层 |
|---|---|---|---|---|
| P1 | 播放一首歌 → 切页不中断 | ✅ | ✅ | Component+Lifecycle+Pinia+API+Platform |
| P2 | 会员开通 → 支付回调 | ✅ | ✅ | Router+API+Security+i18n |
| P3 | 登录 → 权限拒绝 → fallback | ✅ | ✅ | Security+Router+Component |
| P4 | IM 长列表滚动 → 内存不涨 | ✅ | ✅ | Component+Module+API |
| P5 | 切换语言/暗色 → 无闪烁 | ✅ | ✅ | i18n+Component+Platform |

## L1-L3 覆盖矩阵

```
150 页 × 各自 store/composable → 自动跑（按模块并行）
每模块抽 2-3 关键组件        → L3 组件
编译产物全量快照              → L2（进 git）
关键路径 5 条                 → L4 E2E（真机）
```

## `proteus audit all` 全量门禁

```
150 页 → audit route / module / config / i18n / security
输出：路由矩阵 + 模块依赖图 + 状态注册表 + 能力覆盖矩阵
CI 耗时预算：< 12s（并行）
```

## 性能基线（对齐 Blueprint §12）

| 指标 | 预算 | 测量方式 |
|---|---|---|
| 首屏 FCP | < 1.5s | Playwright metrics |
| 长列表 fps | ≥ 55 | automator performance |
| 内存 | < 150MB | DevTools trace |
| `audit all` | < 12s | CI timing |

## 铁律
- E2E 关键路径固定为 5-10 条，新增业务走 L1-L3
- 性能基线落库，退化超 10% 阻断 PR
- Blueprint 验收标准（§12）与本文件逐条对账

---
