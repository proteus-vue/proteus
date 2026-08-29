# create-proteus —— Proteus 脚手架

> `npm create proteus my-app` —— 一键生成 Web + 微信小程序（Skyline）双端工程。

## 使用

```bash
npm create proteus my-app
cd my-app
npm install
npm run dev:web        # Web 端（浏览器打开 Vite 提示地址）
npm run build:mp       # 小程序端（微信开发者工具导入 dist/mp-weixin，替换 proteus.config.ts 的 appid）
```

## 生成内容（32 个文件）

- **编译管线**：`vite.config.ts` + `vite-plugin-mp-transform.ts`（薄适配层，依赖 npm 包 `@proteus/compiler`）+ `scripts/gen-routes.ts`（路由/app.json/page.json 生成器）+ `scripts/mp-entry-stub.ts`
- **框架本体**（src/ 快照）：`router`（Router/RouterView/guards/skyline/presets）+ `platform`（adapter 双端）+ `runtime`（setData 桥接/生命周期/app 骨架）+ `shims`（wx 类型）
- **应用骨架**：`src/main.ts`（Web 入口）/ `src/main.mp.ts`（★极简入口：不写 App()，骨架自动生成）/ `src/App.vue` / `src/pages/index.vue`（首页，含 `<route>` 块）
- **配置**：`proteus.config.ts`（platform/skyline/appid/rules 规则覆盖…）

## 模板维护（★与主仓库同步）

模板 = 主仓库快照 + 手写模板，`scripts/snapshot-template.ts` 负责同步：

```bash
tsx scripts/snapshot-template.ts
```

- **自动快照**：`src/platform/` `src/runtime/` `src/shims/` `src/router/`（除 auto-routes.ts）`scripts/`（除 snapshot 自身）`vite-plugin-mp-transform.ts`（import 替换为 `@proteus/compiler`）`tsconfig.json` `index.html`（入口替换为 src/main.ts）
- **手写模板**（改主仓时手动同步）：`package.json`（含 `{{name}}` 占位）/ `proteus.config.ts` / `vite.config.ts` / `src/main.ts` / `src/main.mp.ts` / `src/App.vue` / `src/pages/index.vue` / `src/router/auto-routes.ts`（仅首页占位，首次 build 时 gen-routes 重新生成）

> ⚠ `@proteus/compiler` 未发布 npm 前，生成工程安装会 404；临时用 `npm install <仓库>/packages/compiler` 或 npm link。

## 发布

```bash
npm run build -w create-proteus   # esbuild 单文件（dist/index.js + shebang）
npm publish                       # files: dist + templates
```
