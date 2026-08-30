// packages/web/src/components/navigator.ts
// 小程序 <navigator>：Web 模拟——导航链接（url → PlatformAdapter.navigateTo，复用 Web 路由转场）
import { defineComponent, h } from 'vue'
import { adapter } from '@proteus-vue/shared'

export const WebNavigator = defineComponent({
  name: 'ProteusWebNavigator',
  inheritAttrs: false,
  setup(_props, { slots, attrs }) {
    const onClick = (e: Event) => {
      e.preventDefault()
      const url = (attrs as Record<string, unknown>).url as string | undefined
      if (url) void adapter.navigateTo({ url: String(url) })
    }
    return () => {
      const { class: cls, url, ...rest } = attrs as Record<string, unknown>
      return h(
        'a',
        {
          ...rest,
          href: 'javascript:void(0)',
          class: ['proteus-web-navigator', (cls as string) || ''],
          onClick,
        },
        slots.default?.(),
      )
    }
  },
})
