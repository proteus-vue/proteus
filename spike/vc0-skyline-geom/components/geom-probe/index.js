// VC0 被测组件：自带 4 类节点（组件作用域测量对象）——attached / ready / 延迟 500ms 三时机
const probe = require('../../utils/probe.js')

Component({
  properties: {
    tag: { type: String, value: 'comp' }
  },
  lifetimes: {
    attached() {
      // 时机 ①：attached（渲染未完成）+ 排一个延迟 500ms 的
      probe.runComponentTimeline(this, this.data.tag)
    },
    ready() {
      // 时机 ②：ready（渲染完成）
      probe.runMatrix(this, this.data.tag + '-ready', 'c-' + this.data.tag + '-')
    }
  }
})
