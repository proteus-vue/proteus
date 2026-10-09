---
'@proteus-vue/create-proteus': patch
---

模板首页重做：从「裸 Hello Proteus」到四端一致的可交互展示页

背景（用户）：「默认创建的模板项目实在太 low 了」+「点击按钮无效……一定要功能正常才行」——
原首页只有一个 `Hello Proteus` + 一个点不动的按钮，作为产品「第一印象」不合格。

- **首页 `src/pages/index.vue` 重做**为展示页：品牌区（badge/主标题/副标题）、关键数字卡
  （5 端 / 1 份源码 / 0 条件编译）、**交互演示**（计数器）、下一步卡片。**全部用原始标签**
  （`div / h1 / p / button`，不依赖内置组件——组件三端尚未对齐）。
- **新增 `src/styles/global.css`**（`:root` 设计令牌 + 根重置 + `.page/.card/.section-title` 骨架）
  ——**四端同源**：小程序走 `targets.mp.globalStyle`、Web 在 `src/main.ts` import、
  App 构建期折进节点样式（`var(--x)` 编译期展开为具体值）。**改主题只改 `:root`**。
- ★**修「按钮点不动」**：App 的事件编译（`compileEvents`）**只支持内联动作**
  （`@click="count++"`），**不支持方法引用**（`@click="handleTap"`）——后者在 Web/小程序可用，
  但 **App 端不产出事件**（`runtime-content.json` 的 `events` 为空）⇒ 看得见点不动。
  模板统一改用内联写法，并**真机验证**（Android 自绘：点击 → `已点击 N 次` 递增）。
- **跨端一致性**（基准 = 仓库 `css-conformance`）：静态 class + 设计令牌；页根 `width:100%` +
  安全区避让（`--pf-inset-*`）；不用 `:hover`/伪类；不用 `inline-block`（Skyline 门禁不接受）。
- **回归锁**：`tests/create-proteus.test.ts` 断言首页为展示页、不含 `p-*`/`:hover`、
  事件用内联 `@click="count++"`，且 global.css 三处接线齐全。
- **文档**：guides/05 模板清单、guides/09「页面构成」同步（含**事件写法**提示：App 只认内联），zh + EN。

去端验：Android 真机（release APK，自绘）四端一致 + 点击计数生效；web/mp/android 构建通过。
