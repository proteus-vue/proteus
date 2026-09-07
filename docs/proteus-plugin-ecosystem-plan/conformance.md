# G-59 Conformance

## 不变量（INV-ECO-01 ~ 08）

| ID | 命题 | 验证方式 |
|----|------|----------|
| INV-ECO-01 | `*` 声明被拒绝；超预算被拒绝 | `validate()` 返回 WILDCARD_FORBIDDEN / OVER_BUDGET |
| INV-ECO-02 | 去激活未清理 → 记审计 | `deactivate()` 返回未清理项 |
| INV-ECO-03 | 老版本声明仍可解析 | `resolve('0.1.0')` 在含 0.8.0 的宿主上返回 0.1.0 |
| INV-ECO-04 | 破坏率可度量 | `breakingRate()` 返回 0..1 |
| INV-ECO-05 | 未授 tier → 拒绝；授 tier → 全 tier API 可用 | `permits()` 对 clipboard 的两次相反判定 |
| INV-ECO-06 | 内置插件 capability 不得超额 | `assertBuiltinParity()` |
| INV-ECO-07 | 废弃无 replacement → 拒绝 | `deprecate()` 返回 DEPRECATE_NO_REPLACEMENT |
| INV-ECO-08 | 哈希变化 → 撤销并要求重授权 | `check()` 返回 'reauth-required' |

## 编号映射

- CMP-195 → INV-ECO-01
- CMP-196 → INV-ECO-02
- CMP-197 → INV-ECO-03
- CMP-198 → INV-ECO-04
- CMP-199 → INV-ECO-05
- CMP-200 → INV-ECO-06
- CMP-201 → INV-ECO-07
- CMP-202 → INV-ECO-08
- CMP-203 → AP-ECO-01
- CMP-204 → AP-ECO-03
- CMP-205 → AP-ECO-04
- CMP-206 → 接缝命题（G-58 沙箱 ∧ G-59 数据分级）

## 覆盖矩阵

| 来源 | 用例数 | 覆盖 |
|------|--------|------|
| G-58 插件形态 | 映射 | 升级为数据分级 |
| G-55 性能工程 | 映射 | 启动预算 |
| G-37 未实测不宣称 | 映射 | 数字三类标注 |
| G-59 本份 | 78 | INV-ECO-01~08 + 负向 11（**实测值**） |

**合计：78 cases（reference-impl 自测，实测值）**

> ⚠️ 数字纪律自纠：本份初稿写作时估算为 58，实际跑出 78。
> 按 G-59.9「数字三分类」与 G-37「未实测不宣称」，**以实测值为准，不改数字**。
>
> 另：实施过程中修正了一处**测试用例写法错误**（非实现错误）——
> 全局预算用例原用 cost 200/300/400，三者均超过单插件预算 100，
> 导致三个插件全部倒在单插件预算上，永远测不到全局预算分支。
> 已改为 perPlugin=400 的独立契约实例，使全局预算成为真正的约束条件。

## 负向自检（NEG-01 ~ NEG-11）

| ID | 场景 | 期望 |
|----|------|------|
| NEG-01 | 声明 `*` | 拒绝，非警告 |
| NEG-02 | 空 events 数组 | 拒绝（无激活时机 = 永不运行） |
| NEG-03 | 单插件超预算 | 拒绝 |
| NEG-04 | 全局超预算 | 拒绝最后加入者 |
| NEG-05 | 未授权访问 clipboard | 拒绝（TIER_DENIED） |
| NEG-06 | 未知 API | 按 secrets 保守处理 → 默认拒绝 |
| NEG-07 | 代码哈希变化 | reauth-required，capability 已撤销 |
| NEG-08 | 废弃无 replacement | 拒绝 |
| NEG-09 | 声明不存在的版本 | resolve 返回 null |
| NEG-10 | 内置插件超额 capability | 断言失败 |
| NEG-11 | 去激活未清理资源 | 记录未清理项 |

## 接缝命题

**G-58 INV-EX（沙箱隔离）∧ G-59 INV-ECO-05（数据分级）**
→ 控制流（沙箱）+ 数据流（分级）双重边界
→ 插件既逃不出沙箱，也够不到高敏数据
