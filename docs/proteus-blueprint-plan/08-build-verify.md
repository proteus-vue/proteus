# 构建验证

> **目标**：验证 Build Pipeline plan 在 150 页真实场景下的表现

---

## 8.1 三端产物构建

```bash
# Web
proteus build --platform web
# → dist/web/ (SPA: index.html + chunks/)

# 微信小程序
proteus build --platform mp-wechat  
# → dist/mp/ (150 页四件套 + subPackages/)

# App (Custom Renderer)
proteus build --platform app
# → dist/app/ (Native 模块 + JSI bridge)
```

**验收点**：
- [ ] 三端并行构建，总耗时 < 5min（CI 矩阵）
- [ ] 增量构建：改 1 页 → 只重编该页 + 受影响 chunk（< 10s）
- [ ] 缓存命中率 > 80%（二次构建）

## 8.2 分包与体积预算（对齐 Router M7.1 + Module B5）

```
主包 (必加载)
├── app.js + app-bar/          ~ 180KB
├── pages/home/                ~ 60KB
├── stores/(eager)             ~ 40KB
└── 总计                       < 500KB ✅

分包
├── trade/   (8 页)            ~ 320KB
├── social/  (4 页 + IM)       ~ 480KB
├── content/ (40 页)            ~ 760KB
└── 每个分包                  < 2MB ✅
```

**验收点**：
- [ ] 主包 < 500KB（首屏加载预算）
- [ ] 每个分包 < 2MB（微信限制）
- [ ] `proteus audit build` 检测超限 → CI 失败
- [ ] 体积趋势图：每次 PR 体积变化可视化

## 8.3 审计门禁（CLI M3）

```yaml
# CI 阶段
audit:
  route: error      # 权限违规 → 阻断
  module: error     # 循环依赖 → 阻断
  api: warn         # 裸调用 → 警告（存量兼容）
  security: error   # 硬编码密钥 → 阻断
  i18n: warn        # missing key → 警告
  compile: error    # 产物结构异常 → 阻断
```

**验收点**：
- [ ] 全量审计 < 30s（150 页规模）
- [ ] `--explain` 输出每条违规的源码位置 + 修复建议
- [ ] 存量违规可 `# proteus-ignore` 标记（渐进治理）

## 8.4 确定性构建（M7.2）

```bash
# 两次构建产物完全一致（除 timestamp）
sha256sum dist/mp/app.js  # 两次相同 ✅
```

**验收点**：
- [ ] 去除所有 timestamp/随机值 → 产物字节级一致
- [ ] 利于增量部署 + 缓存 CDN

---
