// src/components/global-components.d.ts
// ★内置组件模板标签类型注册（GlobalComponents 声明合并）：
//   业务页面模板里 <p-view>/<p-button> 等标签获得 props/emits 类型提示与校验（vue-tsc）
//   双名注册：Pascal（<PView>）+ kebab（<p-view>，框架约定写法）
// 新增内置组件：此处补两行（Pascal + kebab），并在 src/components/index.ts 聚合导出
declare module 'vue' {
  export interface GlobalComponents {
    PView: typeof import('./p-view/index.vue')['default']
    'p-view': typeof import('./p-view/index.vue')['default']
    PText: typeof import('./p-text/index.vue')['default']
    'p-text': typeof import('./p-text/index.vue')['default']
    PImage: typeof import('./p-image/index.vue')['default']
    'p-image': typeof import('./p-image/index.vue')['default']
    PButton: typeof import('./p-button/index.vue')['default']
    'p-button': typeof import('./p-button/index.vue')['default']
    PScrollView: typeof import('./p-scroll-view/index.vue')['default']
    'p-scroll-view': typeof import('./p-scroll-view/index.vue')['default']
    PListView: typeof import('./p-list-view/index.vue')['default']
    'p-list-view': typeof import('./p-list-view/index.vue')['default']
    PInput: typeof import('./p-input/index.vue')['default']
    'p-input': typeof import('./p-input/index.vue')['default']
    PTextarea: typeof import('./p-textarea/index.vue')['default']
    'p-textarea': typeof import('./p-textarea/index.vue')['default']
    PMask: typeof import('./p-mask/index.vue')['default']
    'p-mask': typeof import('./p-mask/index.vue')['default']
    PPopup: typeof import('./p-popup/index.vue')['default']
    'p-popup': typeof import('./p-popup/index.vue')['default']
    PToast: typeof import('./p-toast/index.vue')['default']
    'p-toast': typeof import('./p-toast/index.vue')['default']
    PLoading: typeof import('./p-loading/index.vue')['default']
    'p-loading': typeof import('./p-loading/index.vue')['default']
    PNavBar: typeof import('./p-nav-bar/index.vue')['default']
    'p-nav-bar': typeof import('./p-nav-bar/index.vue')['default']
    PSkeleton: typeof import('./p-skeleton/index.vue')['default']
    'p-skeleton': typeof import('./p-skeleton/index.vue')['default']
    PErrorBoundary: typeof import('./p-error-boundary/index.vue')['default']
    'p-error-boundary': typeof import('./p-error-boundary/index.vue')['default']
    VirtualList: typeof import('./virtual-list/index.vue')['default']
    'virtual-list': typeof import('./virtual-list/index.vue')['default']
  }
}

export {}
