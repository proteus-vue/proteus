# G-38 Conformance 测试套件

> 编译后端必须**全部通过**以下测试，方可宣称「Proteus Compatible」。
> 运行：`proteus conformance --backend ./my-backend.js`

## 总览

| 编号 | 类别 | 项数 | 说明 |
|------|------|------|------|
| C-01 | 接口完整性 | 6 | 16 方法全部实现且签名正确 |
| C-02 | 生命周期 | 5 | initialize / dispose 配对、幂等 |
| C-03 | parse 正确性 | 5 | SFC / TSX / Vue 解析为 ProgramIR |
| C-04 | transform 语义 | 6 | IR 等价、128 原语映射 |
| C-05 | emit 产物 | 5 | bundle / sourcemap / artifact hash |
| C-06 | 增量编译 | 5 | 依赖追踪、缓存命中、局部重算 |
| C-07 | 降级与 Fallback | 3 | Rust → Node 自动降级 |
| C-08 | 性能基准 | 3 | 相对 Node 基线 |
| C-09 | 确定性 | 2 | 字节级一致 |
| C-10 | 可观测性 | 2 | 诊断、指标输出 |

**合计 42 项。0 失败 = 合规。**

---

## C-01 接口完整性（6）

| ID | 断言 | 严重度 |
|----|------|--------|
| C-01-01 | 实现全部 16 个必需方法 | error |
| C-01-02 | `id` 为唯一字符串 | error |
| C-01-03 | `capabilities` 字段完整 | error |
| C-01-04 | `parse / transform / emit` 均返回结构化 IR | error |
| C-01-05 | `createIncrementalSession` 返回会话对象 | error |
| C-01-06 | 可选方法（`reportDiagnostics` 等）缺失时不崩溃 | warning |

## C-02 生命周期（5）

| ID | 断言 | 严重度 |
|----|------|--------|
| C-02-01 | `initialize` 完成前不可调用编译方法 | error |
| C-02-02 | `dispose` 后调用编译方法抛错 | error |
| C-02-03 | 重复 `initialize` 幂等 | error |
| C-02-04 | 资源在 `dispose` 后释放（句柄归零） | error |
| C-02-05 | 并发初始化安全 | warning |

## C-03 parse 正确性（5）

| ID | 断言 | 严重度 |
|----|------|--------|
| C-03-01 | 正确解析 `<p-grid>` SFC | error |
| C-03-02 | 正确解析 TSX `<pStack>` | error |
| C-03-03 | 语法错误 → Diagnostic（不抛异常） | error |
| C-03-04 | 保留源码位置信息（用于 sourcemap） | error |
| C-03-05 | 不支持的语言 → 明确报错（非静默） | error |

## C-04 transform 语义（6）

| ID | 断言 | 严重度 |
|----|------|--------|
| C-04-01 | `<p-grid>` → `semantic: 'layout.grid'` | error |
| C-04-02 | `<p-stack snap="mandatory" loop>` 表达 swiper | error |
| C-04-03 | `useFetch()` → CapabilityIR `network.fetch` | error |
| C-04-04 | Tier 降级标记正确传递 | error |
| C-04-05 | 与 Node 参考实现 IR 树比对一致 | error |
| C-04-06 | 不支持原语 → 编译期诊断（非运行时崩） | error |

## C-05 emit 产物（5）

| ID | 断言 | 严重度 |
|----|------|--------|
| C-05-01 | 产出合法可运行 bundle | error |
| C-05-02 | capabilities.sourceMap → 有效 sourcemap | error |
| C-05-03 | `getArtifactHash` 稳定 | error |
| C-05-04 | treeShake 移除未用原语 | warning |
| C-05-05 | minify 不破坏语义 | error |

## C-06 增量编译（5）

| ID | 断言 | 严重度 |
|----|------|--------|
| C-06-01 | 首次全量构建建立依赖图 | error |
| C-06-02 | 修改单文件 → 仅重算该文件 + 反向依赖 | error |
| C-06-03 | 缓存命中跳过 parse + transform | error |
| C-06-04 | `invalidate` 后 `recompute` 返回正确 diff | error |
| C-06-05 | `commit / rollback` 语义正确 | warning |

## C-07 降级与 Fallback（3）

| ID | 断言 | 严重度 |
|----|------|--------|
| C-07-01 | Rust 不可用 → 自动切 Node | error |
| C-07-02 | 降级事件可观测（日志 / 指标） | error |
| C-07-03 | 降级后产物语义一致（G-38.2） | error |

## C-08 性能基准（3）

| ID | 断言 | 严重度 |
|----|------|--------|
| C-08-01 | 提供 benchmark 脚本 | error |
| C-08-02 | Rust 后端相对 Node 有可测提升（目标 ≥ 2x） | warning |
| C-08-03 | WASM 后端在浏览器内可运行 | warning |

## C-09 确定性（2）

| ID | 断言 | 严重度 |
|----|------|--------|
| C-09-01 | 同一 IR → 两次 emit 字节级一致 | error |
| C-09-02 | Node 与 Rust 产物运行行为等价 | error |

## C-10 可观测性（2）

| ID | 断言 | 严重度 |
|----|------|--------|
| C-10-01 | `reportDiagnostics` 输出结构化错误 | error |
| C-10-02 | 编译耗时 / 缓存命中率可采集 | warning |

---

## 运行方式

```bash
# 全量
proteus conformance --backend ./dist/my-backend.js

# 仅某组
proteus conformance --backend ./dist/my-backend.js --only C-06

# 生成报告
proteus conformance --backend ./dist/my-backend.js --report ./conformance.json
```

## 退出码

- `0`：全部通过（或仅 warning）
- `1`：存在 error 级别失败

## 跳过规则

`capabilities.x = false` 时，对应项为 `SKIPPED`（不算失败）。例如 `incremental: false` → C-06 全部 SKIPPED。

## 参考实现

`@proteus-vue/compiler-backend-node`（B2 交付）作为参考实现，先跑通 42/42，再据此实现其他后端。
