// scripts/vapor-capability-probe.mts —— 我方 Vapor 编译器能力探测（能力清单的**可复现**装置）
// 用法：npx tsx scripts/vapor-capability-probe.mts
// 对照官方能力基线：docs/Proteus_Vapor能力清单.md（探针输出与清单表格逐项对应）
import { buildLayoutTemplate } from '../packages/compiler/src/vapor/template.ts'
import { buildVaporSubscriptions } from '../packages/compiler/src/vapor/build.ts'

const cases: Record<string, string> = {
  '基础+静态样式': `<div style="width: 100px; height: 50px; background-color: #f00">x</div>`,
  '插值文本': `<p-view style="height: 20px"><p-text>{{ msg }}</p-text></p-view>`,
  'v-if': `<div><span v-if="a">A</span><span v-else>B</span></div>`,
  'v-else-if 链': `<div><span v-if="a">A</span><span v-else-if="b">B</span><span v-else>C</span></div>`,
  'v-for 单层': `<li v-for="it in items" :key="it.id">{{ it.n }}</li>`,
  'v-for 嵌套': `<ul><li v-for="g in gs"><span v-for="i in g.x" :key="i.id">{{ i.n }}</span></li></ul>`,
  '动态 :style 绑定': `<div :style="{ color: c }">x</div>`,
  '动态 :width 绑定': `<div :width="w">x</div>`,
  '复合 class': `<div :class="[a, { on: b }]">x</div>`,
  'v-show': `<div v-show="s">x</div>`,
  'v-html': `<div v-html="h"></div>`,
  'v-text': `<div v-text="t"></div>`,
  'v-once': `<div v-once>{{ x }}</div>`,
  'v-model': `<input v-model="m" />`,
  '事件 @click': `<div @click="go">x</div>`,
  '事件修饰符': `<div @click.stop="go">x</div>`,
  '组件标签': `<MyComp :p="1" @ev="f" />`,
  '具名插槽': `<div><slot name="foo" /></div>`,
  '作用域插槽': `<Comp><template #bar="sp">{{ sp.y }}</template></Comp>`,
  '动态组件': `<component :is="c" />`,
  '动态属性': `<div :[dyn]="v">x</div>`,
  'Teleport': `<Teleport to="#x"><i>t</i></Teleport>`,
  'KeepAlive': `<KeepAlive><X /></KeepAlive>`,
  '过渡': `<Transition><div /></Transition>`,
  'v-memo': `<div v-memo="[a]">{{ a }}</div>`,
  '混合文本': `<p>a{{ x }}b</p>`,
  '绘制声明 glow': `<div glow='{"color":"#fff","radius":10,"alpha":0.5}' style="height: 10px"></div>`,
  '绘制声明 clip-path': `<div clip-path='{"kind":"inset","params":[0,0,0.5,0]}' style="height: 10px"></div>`,
}

console.log('=== 模板层（buildLayoutTemplate）===')
for (const [name, tpl] of Object.entries(cases)) {
  const full = `<template>${tpl}</template>`
  try {
    const r = buildLayoutTemplate(full, 'p.vue')
    const diags = (r.diagnostics || []).map((d) => String((d as { message?: string }).message ?? d).slice(0, 80))
    const nodes = (r.template?.nodes || []).length
    const ok = diags.length === 0
    console.log(`${ok ? '✅' : '⚠️ '} ${name.padEnd(18)} nodes=${String(nodes).padEnd(3)} ${diags.length ? 'diag=' + JSON.stringify(diags) : ''}`)
  } catch (e) {
    console.log(`💥 ${name.padEnd(18)} EXC ${String((e as Error).message).slice(0, 80)}`)
  }
}

console.log()
console.log('=== 订阅层（buildVaporSubscriptions，用可编译的表达式）===')
const subCases: Record<string, string> = {
  '插值 {{ item.w }}': `<li v-for="item in list" :key="item.id"><p-text>{{ item.w }}</p-text></li>`,
  '绑定 :width="item.w"': `<li v-for="item in list" :key="item.id" :width="item.w"></li>`,
  '绑定 :show="a"': `<div :show="a"></div>`,
  '绑定 :class="c"': `<div :class="c"></div>`,
  '绑定 :style 动态': `<div :style="{ width: item.w }"></div>`,
  '静态+绑定混合': `<div :src="u" name="static"></div>`,
  '表达式算术': `<div :width="a + b * 2"></div>`,
  '表达式三元': `<div :width="ok ? 10 : 20"></div>`,
  '表达式逻辑': `<div :show="a && b || c"></div>`,
  '表达式成员链': `<div :width="user.profile.w"></div>`,
  '表达式调用': `<div :width="fn(1)"></div>`,
  '表达式宽松相等': `<div :show="a == b"></div>`,
  '表达式模板串': '<div :name="`x${a}`"></div>',
  '表达式可选链': `<div :width="a?.b"></div>`,
  '表达式数组长度': `<div :show="list.length > 0"></div>`,
  '表达式赋值(非法)': `<div :width="a = 1"></div>`,
}
for (const [name, tpl] of Object.entries(subCases)) {
  const full = `<template>${tpl}</template>`
  try {
    const tplR = buildLayoutTemplate(full, 'p.vue')
    const r = buildVaporSubscriptions(full, 'p.vue')
    const diags = (r.diagnostics || []).map((d) => String((d as { message?: string }).message ?? d).slice(0, 70))
    const srcs = (r.table?.sources || []).map((s) => s.sourceName)
    const ok = diags.length === 0
    console.log(`${ok ? '✅' : '⚠️ '} ${name.padEnd(18)} sources=[${srcs.join(',')}] nodes=${(tplR.template?.nodes || []).length} ${diags.length ? 'diag=' + JSON.stringify(diags) : ''}`)
  } catch (e) {
    console.log(`💥 ${name.padEnd(18)} EXC ${String((e as Error).message).slice(0, 80)}`)
  }
}
