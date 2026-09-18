# M6 增量编译 & HMR

> 超级应用千级页面，全量编译不可接受。本章定义增量编译 + 热更新策略。

## 一、依赖图（Module Dependency Graph）

Compiler 在解析阶段构建**文件级依赖图**：

```
.vue ──imports──▶ .ts / .css / 组件
 ├── <template> 引用子组件
 ├── <script>   import { X }
 └── <style>    @import
```

每个节点记录：`filePath / dependencies[] / dependents[] / lastHash`

## 二、增量策略

**变更检测**：文件 mtime/hash 变化 → 只重编译该文件 + 受其影响的下游节点（闭包传播）。

**缓存层**：
- AST 缓存（parse 结果）
- IR 缓存（transform 结果）
- Codegen 缓存（产物）

三级缓存命中则跳过对应阶段。

## 三、HMR（Web 后端）

- 复用 Vite 的 HMR 机制（`@vitejs/plugin-vue` 兼容）
- `.vue` 模板/脚本/样式分别支持热替换
- 样式 scoped 更新无需刷新组件实例

## 四、小程序热更新（Skyline）

小程序无浏览器 HMR API，策略：

1. **开发时文件监听** → 变更文件推送
2. **微信开发者工具**：通过 `wx.reload()` / 自定义编译触发局部刷新
3. **State 保留**：页面级状态尽量不丢（依赖 Pinia store 外部化）

> 小程序 HMR 是"软"热更新（局部重编译 + 页面重建），体验不如 Web，但远胜全量重启。

## 五、缓存持久化

- `.proteus/cache/` 存 AST/IR/产物缓存
- CI 间可复用（需处理平台/版本差异）
- `proteus build --no-cache` 强制全量

## 六、性能预算（超级应用基线）

| 指标 | 目标 |
|------|------|
| 冷启动全量编译（千级页面） | < 60s |
| 增量编译（单文件改动） | < 2s |
| HMR 更新生效 | < 500ms |

## 七、验收

- [ ] 修改单文件只重编该文件及下游
- [ ] 连续改动增量编译耗时稳定在预算内
- [ ] 缓存命中率 > 80%（千级页面场景）
- [ ] `--no-cache` 可复现全量构建
