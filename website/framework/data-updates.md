---
title: 数据更新策略
order: 34
group: 数据与状态
ends: data-updates
---

# 数据更新策略

跨端数据更新的统一契约：**响应式写入自动驱动视图更新，业务不手推**。各端的「推送通道」不同——Web 无桥、小程序 setData、App 走 Bridge——差异由框架**编译期重写 + 运行时合并**吸收，业务代码一致。（各端落地状态见上方「终端落地进度」。）

## 小程序端：setDataBridge（16ms 批量窗口）

小程序视图层数据的唯一入口是 `setData`——成本与**数据量**和**调用次数**正相关。`@proteus-vue/runtime` 的 `setDataBridge` 按页面粒度收集脏路径：

- **路径合并**：`a.b` / `a[0].c` 等点号与数组路径精确合并（同一窗口内 `count.value++` 两次 → 一次 `setData({ count: 2 })`）
- **值去重**：同路径同值写入跳过
- **深层 diff**：对象/数组变更递归出叶路径补丁——只推送变化的子路径
- **flushSync**：需要立即上屏的场景显式冲刷
- batchWindow 由工厂注入（默认 16 ≈ 1 帧）

## 编译期：写入点重写

`<script setup>` 的 `ref` 读写被重写为桥调用（见[脚本转换](/docs/framework/compile-script)）：

| Vue 语义 | 编译策略 |
|---|---|
| `ref` 读写 | 脏路径收集 + 批量 setData |
| `computed` | data 不存；onLoad 初始化 + 依赖 ref 写入时**同步重算合并进同一 setData** |
| `watch(ref, cb)` | 生成 `proteusWatchX`；依赖 ref 写入 setData 后自动调用（旧值写入前保存） |
| `provide/inject`（ref 联动） | 写入点注入 `proteusSyncProvide`（同步注册表 + 通知订阅者） |

## 数据控制纪律

1. **监听器对称清理**：inject 订阅在 detached/onUnload 取消（页面级命名空间 onUnload 删除防泄漏）
2. **watch MVP 边界**：单 ref 直接引用 + 箭头函数回调；数组源/函数源/function 回调编译期警告
3. **静态快照语义**：provide 传 `.value`/字面量 = 静态快照（对齐 Vue：传 ref 联动、传值快照）

## 下一步

- [页面间数据传递](/docs/framework/page-data)
