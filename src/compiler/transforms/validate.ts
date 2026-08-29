// src/compiler/transforms/validate.ts
// validate 阶段编译规则注册表 —— 每条规则一份 AI 说明书（反黑盒机制核心）
import type { TransformRule } from './types'

export const VALIDATE_RULES: TransformRule[] = [
  {
    id: 'validate/js-syntax',
    phase: 'validate',
    status: 'implemented',
    title: 'JS 产物语法自校验',
    description: 'new Function(js) 仅解析不执行，语法错误 → 校验失败并携带错误信息',
    why: '反编译黑盒机制（决策 #17）：坏产物当场报错指明文件，绝不静默输出不可用的产物（对比 uni-app 产物无法定位问题）',
    when: '每次整包编译后（assertValidResult 内）',
    example: {
      before: '// 若产物 js 含语法错误',
      after: 'CompilerError: [proteus-compiler] xxx.vue: js 产物语法错误：Unexpected token ...',
    },
    verify: 'tests/mp-transform.test.ts 校验用例（构造坏产物断言抛错）',
    source: 'src/compiler/validate.ts → validateJs',
    decision: '#17',
  },
  {
    id: 'validate/wxml-pairing',
    phase: 'validate',
    status: 'implemented',
    title: 'WXML 标签配对自校验',
    description: '栈式扫描 WXML 标签配对（先剥离注释，避免行号注释干扰），未闭合/错配 → 校验失败',
    why: '反编译黑盒机制（决策 #17）：模板转换出错的常见形态就是标签不配对，编译期拦截比真机报错好定位',
    when: '每次整包编译后（assertValidResult 内）',
    example: {
      before: '// 若产物 wxml 标签不配对',
      after: 'CompilerError: [proteus-compiler] xxx.vue: wxml 产物结构错误：</view> 与 <text> 不匹配（位置 N）',
    },
    verify: 'tests/mp-transform.test.ts 校验用例',
    source: 'src/compiler/validate.ts → validateWxml',
    decision: '#17',
  },
  {
    id: 'validate/compiler-error',
    phase: 'validate',
    status: 'implemented',
    title: '坏产物抛 CompilerError 指明文件',
    description: '校验失败 → 抛 CompilerError（携带源文件名，消息含 [proteus-compiler] 前缀）',
    why: '反黑盒机制的统一错误通道：AI/开发者拿到错误即可定位到具体文件（错误 = 可操作的反馈，而非黑盒失败）',
    when: 'js 或 wxml 校验不通过时',
    example: {
      before: '// 静默输出坏产物（反模式）',
      after: 'throw new CompilerError(filename, message)',
    },
    verify: 'tests/mp-transform.test.ts 校验用例',
    source: 'src/compiler/validate.ts → CompilerError + assertValidResult',
    decision: '#17',
  },
]
