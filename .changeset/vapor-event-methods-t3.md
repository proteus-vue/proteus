---
'@proteus-vue/slot-runtime': minor
'@proteus-vue/compiler': minor
'@proteus-vue/render-backend': patch
---

Vapor 事件 T3：`console.*` 转面板日志（新 `log` 动作）+ 补齐方法调方法/模板串判据

承接 T1/T2（方法引用/方法体）。T3 收口「事件-方法」这条线向 Vue 对齐：

- **`console.{log,info,warn,error,debug}(…)`** —— 编译期降级为 **`log` 动作**（`programs` 各实参
  的求值程序，运行期求值交 `onLog` 出口）。真实方法体几乎都带 `console` 调试，而 App 端不执行
  script ⇒ 此前整条调用被拒（**点了没反应**）。
  - `screen-runtime` / `superapp-runtime` 增 `onLog` 出口（缺省转 `onNote`——面板可归类；dev 面板
    可另接到 Console 页，保留 level）。
  - 其余 `console.*`（`table`/`time`/…）⇒ 明确诊断（封闭集）。
- **方法调方法 / 模板串**：核验后**本已可用**（递归内联 / `compileExpr`），补判据锁定（不再只靠"没有诊断"）。

验证：`tests/handler-actions.test.ts` ⑦（log 求值交 onLog）· `vapor-events` T3 组（log 动作 / 各级别 /
`console.table` 诊断 / 方法调方法）· **三端真机判据 ㉓**（T2 夹具方法体加 `console.log`；`t2_probe.logs`
逐次 3 条，Android/鸿蒙/iOS 全过 + `check:vapor-three-end` 指纹一致）· 全量 5651 · vue-tsc 0。
文档：能力清单 #16 / guides 09（中英）/ 计划（T3 收口）。
