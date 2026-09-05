# G-60 实施门槛

## 阶段 1：文档工程骨架（本份覆盖）

- [x] 痛点调研（00-pain-points.md，**先于设计**）
- [x] 版本注册表 + 状态机 + 元数据驱动横幅
- [x] 导航树 + 断链检测
- [x] API spec 数据结构 + 哈希 + 漂移检测
- [x] SpecDiff 破坏性分类
- [x] 下载矩阵 + updater endpoint 变量替换
- [x] reference-impl.cjs（自测见 conformance.md）
- [x] verify.sh

## 阶段 2：真实站点搭建

- [ ] Docusaurus 初始化 + 版本化配置
- [ ] `/shared` transclusion 机制落地
- [ ] WIT → ApiSpec parser（自研）
- [ ] `wit-lint` / `wit-diff --breaking`
- [ ] renderer 生成 `/api/{version}/` 页面
- [ ] CI 接入：tag 触发 → 快照 + 构建 + 签名 + 发布

## 阶段 3：下载与更新

- [ ] Tauri updater 接入（`tauri-plugin-updater`）
- [ ] 私钥生成 + CI secret + **离线冷备份**
- [ ] macOS notarization / Windows Authenticode
- [ ] manifest 生成与校验（缺签名即拒绝）
- [ ] 平台检测下载页

## 阶段 4：品牌与体验

- [ ] 落地页（Astro）+ 3D 吉祥物接入
- [ ] 吉祥物点击 → 能力介绍区同步切换
- [ ] favicon / OG image 用小程序头像 SVG
- [ ] 全站主色统一 `#00C7C9 → #019CB3 → #016F9A`
- [ ] 搜索（Pagefind）

## 阶段 5：对外宣称合规

- [ ] **所有性能数字标注"目标/实测"**
- [ ] 移除所有未经实测的宣称
- [ ] 数字审计接入 CI（G-60.7）

---

## 各阶段的风险与前置

| 阶段 | 主要风险 | 前置条件 |
|------|---------|---------|
| 2 | WIT parser 成本被低估 | G-58 的 WIT 文件稳定 |
| 3 | **私钥丢失（不可恢复）** | 备份流程先于首次签名 |
| 3 | macOS notarization 卡审核 | Apple Developer 账号 |
| 4 | 3D 吉祥物在移动端性能 | 已验证（G-56 组件） |
| 5 | 历史文档里散落未实测数字 | 全文扫描 |

**阶段 3 的私钥风险是唯一"不可逆"的**——其余都可以重来。
所以正确顺序是：**先建备份流程，再生成第一把私钥**。

---

## 与全局路线的关系

```
G-56 Studio 自有宿主壳  ──┐
G-58 插件 API           ──┼──→ G-60 官网落地（对外出口）
G-59 生态治理           ──┘
                              ↓
                        G-61 插件市场（运营系统）
```

官网是这套体系的**对外界面**。前面所有 plan 的产出，
最终都要通过它变成开发者能看到、能信任、能下载的东西。
