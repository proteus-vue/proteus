# 验收矩阵与性能预算

## 1. 纪念日灰度验收

| 端 | 设备 | 验收项 | 门槛 |
|----|------|--------|------|
| Web | Chrome / Safari / Firefox | 全站灰度生效 | ✅ 含图片/按钮/背景 |
| Web | IE11（可选） | SVG filter 兜底 | ✅ 至少不完全失效 |
| Skyline | 微信 8.x（iOS/Android） | 灰度生效 + **flex 不失效** | ✅ 布局无错位（核心） |
| iOS | iPhone（含灵动岛机型） | 灰度 + 覆盖层不阻断交互 + **避让灵动岛** | ✅ 点击穿透正常 |
| iOS | iPad | 审核合规扫描 | ✅ 无 `CAFilter` 私有 API |
| Android | 低端机（4.4+） | ColorMatrix 方案不卡顿 | ✅ 无明显掉帧 |
| Android | WebView 页面 | 灰度降级（不视觉异常） | ✅ 特殊容器排除生效 |
| 鸿蒙 | NEXT 模拟器/真机 | `.grayscale(1)` 生效 + 可响应切换 | ✅ 动态恢复彩色 |

### 关键验收点

1. **布局安全**：Skyline/小程序灰度后页面**不得**出现 flex 错位、滚动异常；
2. **交互穿透**：灰度覆盖层 `pointer-events: none`，所有可点击区域正常响应；
3. **安全区避让**：灰度层不覆盖/干扰灵动岛、安全区（复用 `p-safe`）；
4. **热切换**：日期到/远端开关触发后，**无需重启**即切换，且各页面同步；
5. **恢复**：日期过/开关关后**完全**恢复彩色，无残留滤镜。

## 2. 骨架屏验收

| 端 | 验收项 | 门槛 |
|----|--------|------|
| Web | 首屏骨架先于 JS 显示 | ✅ FCP 前可见 |
| Skyline | 骨架 WXML 静态渲染 | ✅ 首屏直出 |
| App | AOT 骨架原生 View，Vue 启动前可见 | ✅ 对齐 IFR 首帧 <200ms |
| 三端 | 骨架结构与真实页面一致 | ✅ 节点/布局语义对齐 |
| 三端 | 过渡无闪屏 | ✅ refKey 对齐，淡入淡出 |
| 三端 | 响应式自适应 | ✅ 非固定图片、随视口调整 |

### 性能预算

| 指标 | 预算 | 说明 |
|------|------|------|
| 骨架 IR 单路由产物 | < 2KB | 结构化 JSON，远小于 base64 图片 |
| 灰度注入脚本（常态常驻） | < 1KB | 必须极小（全年常驻） |
| 骨架生成 CI 安装体积增量 | 0 | 不引入 Chromium |
| 骨架生成耗时（单路由） | < 100ms | 静态分析，无运行时开销 |
| 灰度切换耗时 | < 16ms（一帧） | 仅改 class / 覆盖层显隐 |

## 3. CI 门禁

```yaml
# .github/workflows/consistency.yml（新增 job）
- name: memorial & skeleton check
  run: |
    pnpm proteus doctor --strict
    pnpm proteus skeleton generate --verify
    pnpm proteus memorial check
- name: e2e matrix
  matrix: { platform: [web, skyline, ios, android, harmony] }
  run: pnpm test:e2e --platform ${{ matrix.platform }}
```

`proteus-skeleton-verify.mjs` 校验：骨架 IR 与真实 IR 节点数/布局语义一致性（SKL002）。

## 4. 对标基线（Proteus vs 主流）

| 能力 | 截图方案 | 手写组件 | **Proteus** |
|------|---------|---------|-----------|
| 首屏骨架（Web） | ✅ | ✅ | ✅ |
| 首屏骨架（App，Vue 启动前） | ❌ | ⚠️ | ✅ AOT 原生 View |
| 结构响应式 | ❌（图片） | ✅ | ✅ IR |
| 构建依赖 | Chromium | 无 | 无 |
| 纪念日一键（五端） | ❌ | ❌ | ✅ |

## 5. 真机测试清单

- [ ] 五端各真机跑通灰度 + 骨架
- [ ] Skyline 灰度后滚动列表、tab 切换无错位
- [ ] iOS 灵动岛机型灰度层不侵入岛区
- [ ] Android WebView/视频页灰度降级正常
- [ ] 远端开关切灰 → 各页面同步 → 关闭恢复
- [ ] 骨架 → 真实 View 过渡无白屏/闪屏
- [ ] 性能预算全部达标（CI 硬性门禁）
