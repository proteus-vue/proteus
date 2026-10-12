// eslint.config.mjs —— ★决策 #868：补 lint 工具链层（flat config · ESLint 10）
//
// 【为什么有它（外部审查点名的唯一"缺层"）】本仓有 146 道**自定义门禁**（点状拦截）却**零 lint 基线**
//   （面状风格/坏味道）。门禁擅长拦"本仓已知的具体坑"，但**拦不住通用坏味道**——例如
//   `no-unmodified-loop-condition` / `no-constant-condition` / `no-fallthrough` 这类，正是
//   #865/#866 那批"手写解析循环"缺陷的**同类土壤**。
//
// 【定位：只做**正确性 + 坏味道**，不做格式 bikeshedding】
//   本仓代码风格（缩进/引号/分号/命名）高度一致且有历史资产，**不引入 prettier 冲突**、不启用
//   逐条风格规则。规则集聚焦"可能出 bug"的语义规则（见下 §规则集），把审美交给既有约定。
//
// 【棘轮：ESLint 10 原生 bulk suppressions】存量违规一次性写入 `eslint-suppressions.json`（`--suppress-all`），
//   此后 lint **只报新增**（`--suppress-all` 的语义 = 锁存量、只增不减）；修掉后 `--prune-suppressions` 降钉。
//   这与本仓 `no-blind-wait-baseline.json` / `loop-guard-baseline.json` 的棘轮文化**同源**。
//
// 【诚实边界】① 本轮**不启用 type-aware 规则**（需为 51 包各配 `parserOptions.project`，跨包引用多、
//   代价高且易假红）——先落地"语法级"高信号规则；type-aware（如 `no-floating-promises`/`no-misused-promises`）
//   列为后续。② tsconfig 的 `noUncheckedIndexedAccess` 是**另一条线**（实测仅 2 包开启即 47 错，
//   全仓数千条，须独立迁移），本文件不动它。
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import pluginVue from 'eslint-plugin-vue'
import globals from 'globals'

/** 统一忽略：构建产物 / 生成物 / 依赖 / 声明文件 / **第三方工具源码** */
const IGNORES = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/coverage/**',
  '**/*.d.ts',
  'docs/generated/**',
  '**/.zcode/**',
  '.tools/**',              // ★第三方工具源码（NDK simpleperf / quickjs 等）——非本仓代码
  '**/.proteus/**',         // ★编译器产物（examples/showcase 里的 .proteus/ = 编译输出）——非源码
  'hosts/**/build/**',
  'hosts/**/build-*/**',    // ★hosts 打包产物（build-selfdraw / build-sim 等）
  'hosts/**/.cxx/**',
  'hosts/**/third_party/**',
  '**/assets/bundle-*.js',        // ★宿主内打包产物（bundle-*.js）
  '**/rawfile/bundle-*.js',       // ★鸿蒙 rawfile 里的打包产物
  '**/fixtures/bundle-*.js',      // ★夹具打包产物
  'hosts/**/fixtures/*.js',
  'spike/tools/**',              // ★vendored 第三方库（yoga / skyline 等）——非本仓代码
  '**/*.min.js',
  'website/.vitepress/dist/**',
  'website/.vitepress/cache/**',
  'examples/**/dist/**',
]

/**
 * ★规则集（高信号、低噪音——专注"可能出 bug"）：
 *   ① `@eslint/js` recommended（基础正确性）
 *   ② typescript-eslint recommended（**非 type-aware**）——含 `no-unsafe-*` 之外的语法级规则
 *   ③ 手选"坏味道/易错"规则（见 §MANUAL）
 *   关闭的：`no-unused-vars`（存量巨大、属"清理"非"缺陷"，走 suppression 或后续批次）。
 */
const MANUAL = {
  // ——— 循环 / 控制流（#865/#866 同类土壤）———
  'no-unmodified-loop-condition': 'error', // 循环条件里的变量未被修改 ⇒ 可能死循环
  'no-constant-condition': ['error', { checkLoops: 'allExceptWhileTrue' }],
  'no-unreachable-loop': 'error',          // 循环体必然在首轮跳出 ⇒ 多半写错
  'no-unreachable': 'error',
  'no-fallthrough': 'error',               // switch 穿透（少写 break）
  'no-self-compare': 'error',
  'no-self-assign': 'error',
  'no-cond-assign': ['error', 'except-parens'],
  'no-dupe-keys': 'error',
  'no-dupe-args': 'error',
  'no-dupe-class-members': 'error',
  'no-dupe-else-if': 'error',
  'no-unsafe-negation': 'error',
  'no-unsafe-optional-chaining': 'error',
  'no-sparse-arrays': 'error',
  'no-template-curly-in-string': 'error',  // 字符串里写了 ${}（该用模板串）
  'no-async-promise-executor': 'error',
  'array-callback-return': 'error',        // map/filter 回调漏 return
  'no-throw-literal': 'error',
  'prefer-promise-reject-errors': 'error',
  // ——— 判等（本仓普遍 ===；保留 == null 惯用法）——★降 warn：存量多属"清理"非"缺陷" —
  eqeqeq: ['warn', 'always', { null: 'ignore' }],
  // ——— 关闭/降级：属"清理/审美"而非"缺陷"，避免制造巨型噪音 ———
  'no-unused-vars': 'off',
  // 未用变量：**warn**（暴露但不阻断——存量清理属独立批次，不 gate）
  '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
  'no-empty': 'off',
  'no-console': 'off',        // CLI/scripts 大量用 console
  'no-control-regex': 'off',
  'no-useless-escape': 'off',
  'no-prototype-builtins': 'off',
}

export default [
  { ignores: IGNORES },

  // TS / Vue 源（含 .mjs 脚本）统一基础
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/recommended'],

  // .vue 里的 <script lang="ts"> 用 TS 解析器
  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: { parser: tseslint.parser, extraFileExtensions: ['.vue'] },
    },
  },

  {
    files: ['**/*.{ts,tsx,mts,cts,vue,mjs,cjs,js}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: MANUAL,
  },

  // ★TS 文件关 `no-undef`（typescript-eslint 官方建议）：TS 编译器已负责未定义标识符检查，
  //   ESLint 的 `no-undef` 对 TS 类型/声明会**假阳性**（实测 2878 条几乎全在 JS 工具源码/类型名上）。
  {
    files: ['**/*.{ts,tsx,mts,cts,vue}'],
    rules: { 'no-undef': 'off' },
  },

  // ——— 放宽面（避免与既有约定/生成物打架）———
  // 测试文件：mock/断言宽松
  {
    files: ['tests/**/*.{ts,mts,mjs}', '**/*.test.{ts,mts,mjs}', '**/*.spec.{ts,mts,mjs}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-cond-assign': 'off',
    },
  },
  // 脚本/CLI：Node 环境，允许 any（大量动态 JSON）
  {
    files: ['scripts/**/*.{mjs,ts}', 'packages/cli/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  // Vue SFC：命名/多词组件名等审美规则放宽（本仓组件名即约定）
  {
    files: ['**/*.vue'],
    rules: {
      'vue/multi-word-component-names': 'off',
      'vue/no-v-html': 'off',
      'vue/require-default-prop': 'off',
      'vue/attributes-order': 'off',
      'vue/max-attributes-per-line': 'off',
      'vue/singleline-html-element-content-newline': 'off',
      'vue/html-self-closing': 'off',
      'vue/html-indent': 'off',
      'vue/html-closing-bracket-newline': 'off',
      'vue/first-attribute-linebreak': 'off',
    },
  },
  // TS 里 `no-empty-object-type` / `no-explicit-any` 存量多，先降为 warn（不阻断，走 suppression）
  {
    files: ['**/*.{ts,mts,vue}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-empty-object-type': 'warn',
      '@typescript-eslint/no-unused-expressions': 'warn',
      '@typescript-eslint/ban-ts-comment': 'warn',
      '@typescript-eslint/no-this-alias': 'warn',
      '@typescript-eslint/no-namespace': 'warn',
      '@typescript-eslint/no-require-imports': 'warn',
    },
  },
]
