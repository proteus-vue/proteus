# 跨层集成契约验证

> **目标**：确保 15 份 plan 的接口定义**真实对得上**，不存在"文档说 A、代码写 B"

---

## 7.1 接口契约清单（必须逐条验证）

| # | 契约 ID | 提供方 | 消费方 | 验证方式 |
|---|---------|--------|--------|---------|
| C1 | `defineApp()` | Lifecycle | Compiler | 编译产出 `App()` 调用 |
| C2 | `mountMpApp({ appBar })` | Lifecycle | Component | appBar → `app-bar/` 四件套 |
| C3 | `usePlayerStore()` | Pinia | Component/API | store 在 player-bar 可用 |
| C4 | `audioCapability` | Platform | API | 三端 adapter 签名一致 |
| C5 | `permissions` 权限树 | Security | Router | 守卫生成正确 |
| C6 | `chunk` 字段 | Router | Module/Build | 分包映射正确 |
| C7 | `defineModule()` | Module | Compiler | 依赖图无环 |
| C8 | `useTrace()` | DevTools | 全部 | 六源事件可采集 |
| C9 | `proteus audit` | CLI | 全部 | 全量审计通过 |
| C10 | i18n `$t()` | i18n | Component | 类型推断 + 分包加载 |

## 7.2 契约测试（对齐 Testing plan B5）

```ts
// tests/contract/lifecycle-component.spec.ts
import { describe, it, expect } from 'vitest'
import { defineApp, mountMpApp } from '@proteus/lifecycle'
import PlayerBar from '@/global/PlayerBar.vue'

describe('C2: mountMpApp appBar → Component', () => {
  it('appBar 配置编译为 app-bar/ 四件套', () => {
    const app = defineApp({
      appBar: PlayerBar,
    })
    const result = compile(app)  // ← Compiler codegen

    // 验证产物
    expect(result.files).toContain('app-bar/index.wxml')
    expect(result.files).toContain('app-bar/index.js')
    expect(result.appJson).toHaveProperty('appBar', {})
  })

  it('player-bar 不在任何 page WXML 中', () => {
    const pages = result.getPageWxmls()
    pages.forEach(wxml => {
      expect(wxml).not.toContain('<player-bar')
    })
  })
})
```

**验收点**：
- [ ] 10 条契约全部有自动化测试
- [ ] 改任意一个 plan 的接口 → CI 立即报错
- [ ] 契约测试在 CI 第一阶段跑（先于功能测试）

## 7.3 编译产物快照（对齐 Compiler M5）

```
dist/mp/
├── app.js / app.json / app.wxss
├── app-bar/                    ← C2: appBar 全局层
│   └── index.{wxml,wxss,js,json}
├── components/global/          ← Component 全局注册
│   └── ui-button/
├── pages/                      ← 150 页（每页四件套）
│   ├── home/
│   ├── player/
│   ├── trade/
│   └── ...
├── stores/                     ← Pinia M7 分片产物
│   └── player.js
├── modules/                    ← Module 分包
│   ├── trade/
│   ├── social/
│   └── content/
└── locales/                    ← i18n 语言包分包
    ├── zh-CN.js
    └── en-US.js
```

**验收点**：
- [ ] `dist/mp/**/*.{wxml,json}` 全部进 git（快照回归）
- [ ] `proteus audit compile` 校验产物结构与源码一致
- [ ] `--explain` 输出每个产物的生成原因（透明化）

---
