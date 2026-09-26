// 由 website/scripts/gen-content.mjs 生成（勿手改）——组件总览画廊的结构化索引。
// SSOT：packages/components/*/index.vue 的 defineProps/defineEmits（与 md 总览同一 indexRows）。
export interface ComponentIndexEntry { dir: string; props: number; emits: number }
export interface ComponentIndexDomain { key: string; en: string; components: ComponentIndexEntry[] }
export interface ComponentIndex { total: number; domains: ComponentIndexDomain[] }

export const componentIndex: ComponentIndex = {
  "total": 74,
  "domains": [
    {
      "key": "布局",
      "en": "Layout",
      "components": [
        {
          "dir": "p-adaptive",
          "props": 2,
          "emits": 2
        },
        {
          "dir": "p-aspect",
          "props": 2,
          "emits": 0
        },
        {
          "dir": "p-box",
          "props": 2,
          "emits": 0
        },
        {
          "dir": "p-divider",
          "props": 3,
          "emits": 0
        },
        {
          "dir": "p-fit",
          "props": 1,
          "emits": 0
        },
        {
          "dir": "p-formfactor",
          "props": 6,
          "emits": 0
        },
        {
          "dir": "p-grid",
          "props": 2,
          "emits": 0
        },
        {
          "dir": "p-inline",
          "props": 4,
          "emits": 0
        },
        {
          "dir": "p-masonry",
          "props": 2,
          "emits": 0
        },
        {
          "dir": "p-safe",
          "props": 3,
          "emits": 0
        },
        {
          "dir": "p-scroll",
          "props": 4,
          "emits": 0
        },
        {
          "dir": "p-scroll-view",
          "props": 43,
          "emits": 14
        },
        {
          "dir": "p-sidebar",
          "props": 4,
          "emits": 0
        },
        {
          "dir": "p-spacer",
          "props": 3,
          "emits": 0
        },
        {
          "dir": "p-stack",
          "props": 7,
          "emits": 1
        },
        {
          "dir": "p-view",
          "props": 7,
          "emits": 0
        },
        {
          "dir": "p-virtual-list",
          "props": 3,
          "emits": 0
        },
        {
          "dir": "p-zone",
          "props": 1,
          "emits": 0
        }
      ]
    },
    {
      "key": "内容与表单",
      "en": "Content & Forms",
      "components": [
        {
          "dir": "p-avatar",
          "props": 4,
          "emits": 0
        },
        {
          "dir": "p-button",
          "props": 25,
          "emits": 11
        },
        {
          "dir": "p-camera",
          "props": 6,
          "emits": 5
        },
        {
          "dir": "p-canvas",
          "props": 6,
          "emits": 0
        },
        {
          "dir": "p-checkbox",
          "props": 5,
          "emits": 2
        },
        {
          "dir": "p-form",
          "props": 5,
          "emits": 1
        },
        {
          "dir": "p-heading",
          "props": 1,
          "emits": 0
        },
        {
          "dir": "p-icon",
          "props": 5,
          "emits": 0
        },
        {
          "dir": "p-image",
          "props": 13,
          "emits": 2
        },
        {
          "dir": "p-input",
          "props": 28,
          "emits": 4
        },
        {
          "dir": "p-label",
          "props": 2,
          "emits": 1
        },
        {
          "dir": "p-list-view",
          "props": 10,
          "emits": 0
        },
        {
          "dir": "p-loading",
          "props": 5,
          "emits": 0
        },
        {
          "dir": "p-map",
          "props": 31,
          "emits": 10
        },
        {
          "dir": "p-media",
          "props": 50,
          "emits": 10
        },
        {
          "dir": "p-nav-bar",
          "props": 11,
          "emits": 1
        },
        {
          "dir": "p-picker",
          "props": 13,
          "emits": 3
        },
        {
          "dir": "p-progress",
          "props": 11,
          "emits": 0
        },
        {
          "dir": "p-radio",
          "props": 5,
          "emits": 2
        },
        {
          "dir": "p-rich-text",
          "props": 5,
          "emits": 0
        },
        {
          "dir": "p-scale",
          "props": 3,
          "emits": 0
        },
        {
          "dir": "p-select",
          "props": 6,
          "emits": 1
        },
        {
          "dir": "p-selection",
          "props": 2,
          "emits": 1
        },
        {
          "dir": "p-skeleton",
          "props": 6,
          "emits": 0
        },
        {
          "dir": "p-slider",
          "props": 10,
          "emits": 3
        },
        {
          "dir": "p-svg",
          "props": 4,
          "emits": 0
        },
        {
          "dir": "p-switch",
          "props": 5,
          "emits": 2
        },
        {
          "dir": "p-text",
          "props": 10,
          "emits": 0
        },
        {
          "dir": "p-textarea",
          "props": 22,
          "emits": 4
        }
      ]
    },
    {
      "key": "页面外壳",
      "en": "Page Shell",
      "components": [
        {
          "dir": "p-action-sheet",
          "props": 3,
          "emits": 3
        },
        {
          "dir": "p-ad",
          "props": 6,
          "emits": 3
        },
        {
          "dir": "p-drawer",
          "props": 4,
          "emits": 1
        },
        {
          "dir": "p-keyboard-accessory",
          "props": 3,
          "emits": 0
        },
        {
          "dir": "p-mask",
          "props": 6,
          "emits": 1
        },
        {
          "dir": "p-modal",
          "props": 8,
          "emits": 2
        },
        {
          "dir": "p-nav",
          "props": 2,
          "emits": 0
        },
        {
          "dir": "p-page",
          "props": 3,
          "emits": 0
        },
        {
          "dir": "p-page-container",
          "props": 10,
          "emits": 2
        },
        {
          "dir": "p-popover",
          "props": 3,
          "emits": 1
        },
        {
          "dir": "p-popup",
          "props": 8,
          "emits": 1
        },
        {
          "dir": "p-segment",
          "props": 2,
          "emits": 2
        },
        {
          "dir": "p-split",
          "props": 3,
          "emits": 0
        },
        {
          "dir": "p-tabbar",
          "props": 2,
          "emits": 2
        },
        {
          "dir": "p-toast",
          "props": 7,
          "emits": 1
        },
        {
          "dir": "p-toolbar",
          "props": 4,
          "emits": 1
        },
        {
          "dir": "p-webview",
          "props": 4,
          "emits": 3
        }
      ]
    },
    {
      "key": "手势",
      "en": "Gestures",
      "components": [
        {
          "dir": "p-draggable",
          "props": 16,
          "emits": 4
        },
        {
          "dir": "p-scrollable",
          "props": 5,
          "emits": 2
        }
      ]
    },
    {
      "key": "工程",
      "en": "Engineering",
      "components": [
        {
          "dir": "p-animate",
          "props": 4,
          "emits": 0
        },
        {
          "dir": "p-error-boundary",
          "props": 4,
          "emits": 0
        },
        {
          "dir": "p-router-link",
          "props": 16,
          "emits": 1
        },
        {
          "dir": "p-share-element",
          "props": 10,
          "emits": 0
        },
        {
          "dir": "p-transition",
          "props": 4,
          "emits": 0
        }
      ]
    },
    {
      "key": "能力入口",
      "en": "Capability Entry",
      "components": [
        {
          "dir": "p-location",
          "props": 2,
          "emits": 2
        },
        {
          "dir": "p-pick-photo",
          "props": 2,
          "emits": 2
        },
        {
          "dir": "p-scan-qr",
          "props": 2,
          "emits": 2
        }
      ]
    }
  ]
}
