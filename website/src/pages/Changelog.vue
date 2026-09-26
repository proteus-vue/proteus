<script setup lang="ts">
// website/src/pages/Changelog.vue —— 版本与动态（2026-09-26 P1a）
// 数据：src/data/release-notes.ts（手维、条目可追溯到仓库提交/项目记忆——发版低频时最可靠）。
// 诚实口径：npm 发布态与工作树版本分列，凭据阻塞期明确标注「待发布」。
import { computed } from 'vue'
import { releaseNotes, releaseState } from '../data/release-notes'
import { locale } from '../i18n'

const isEn = computed(() => locale.value === 'en')
const kindLabel = (kind: string) =>
  ({ feat: isEn.value ? 'Feature' : '新能力', fix: isEn.value ? 'Fix' : '修复', infra: isEn.value ? 'Infra' : '基建', site: isEn.value ? 'Site' : '官网' })[kind] ?? kind
const kindClass = (kind: string) => `rn-kind--${kind}`
</script>

<template>
  <div class="cl">
    <header class="cl-head">
      <h1 class="cl-title">{{ isEn ? 'Releases & Updates' : '版本与动态' }}</h1>
      <p class="cl-sub">
        {{
          isEn
            ? 'Milestones of the framework and the site — every entry is traceable to commits in the repository.'
            : '框架与官网的工程里程碑——每一条都可追溯到仓库提交，不做不可验证的宣称。'
        }}
      </p>
    </header>

    <!-- npm 发布态（诚实口径：工作树领先 registry 时明确标注） -->
    <p-view class="cl-state">
      <p-stack direction="row" :gap="22" wrap class="cl-state-row">
        <span class="cl-state-item">
          <span class="cl-state-k">npm latest</span>
          <span class="cl-state-v">{{ releaseState.npmPackage }}@{{ releaseState.npmLatest }}</span>
        </span>
        <span class="cl-state-item">
          <span class="cl-state-k">{{ isEn ? 'worktree' : '工作树' }}</span>
          <span class="cl-state-v">{{ releaseState.worktree }}</span>
        </span>
        <a
          class="cl-state-link"
          href="https://www.npmjs.com/org/proteus-vue"
          target="_blank"
          rel="noreferrer"
        >npm ↗</a>
      </p-stack>
    </p-view>

    <!-- 时间线 -->
    <section v-for="note in releaseNotes" :key="note.date" class="cl-group">
      <h2 class="cl-date">{{ note.date }}</h2>
      <ul class="cl-list">
        <li v-for="(it, i) in note.items" :key="i" class="cl-item">
          <span class="rn-kind" :class="kindClass(it.kind)">{{ kindLabel(it.kind) }}</span>
          <span class="cl-text">{{ it.text }}</span>
        </li>
      </ul>
    </section>

    <p-view class="cl-foot">
      <a class="cl-foot-link" href="https://github.com/proteus-vue/proteus/commits/main" target="_blank" rel="noreferrer">
        {{ isEn ? 'Full commit history →' : '完整提交历史 →' }}
      </a>
    </p-view>
  </div>
</template>

<style scoped>
.cl { max-width: 860px; margin: 0 auto; padding: 14px 0 40px; }
.cl-title { color: var(--ink); font-size: 30px; font-weight: 800; margin: 0; }
.cl-sub { color: var(--muted); font-size: 14px; line-height: 1.7; margin: 10px 0 0; }

.cl-state {
  margin-top: 20px;
  padding: 14px 18px;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 12px;
}
.cl-state-row { align-items: center; }
.cl-state-item { display: inline-flex; align-items: baseline; gap: 8px; }
.cl-state-k { font-size: 11px; color: var(--dim); font-weight: 700; letter-spacing: 0.4px; }
.cl-state-v { font-family: var(--mono); font-size: 12.5px; color: var(--brand-ink); }
.cl-state-link { font-size: 12.5px; color: var(--brand-ink); text-decoration: none; margin-left: auto; }
.cl-state-link:hover { text-decoration: underline; }

.cl-group { margin-top: 30px; }
.cl-date {
  color: var(--ink);
  font-size: 17px;
  font-weight: 800;
  margin: 0 0 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--line);
}
.cl-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.cl-item { display: flex; align-items: flex-start; gap: 10px; }
.rn-kind {
  flex-shrink: 0;
  margin-top: 1px;
  font-size: 10.5px;
  font-weight: 800;
  letter-spacing: 0.4px;
  border-radius: 999px;
  padding: 2px 9px;
}
.rn-kind--feat { color: var(--ok, #3ddc97); background: rgba(61, 220, 151, 0.12); }
.rn-kind--fix { color: var(--warn, #ffb454); background: rgba(255, 180, 84, 0.12); }
.rn-kind--infra { color: var(--brand-ink); background: var(--brand-soft); }
.rn-kind--site { color: var(--brand2, #ab9bff); background: rgba(171, 155, 255, 0.1); }
.cl-text { color: var(--ink); font-size: 13.5px; line-height: 1.7; }

.cl-foot { margin-top: 34px; }
.cl-foot-link { font-size: 13px; font-weight: 700; color: var(--brand-ink); text-decoration: none; }
.cl-foot-link:hover { text-decoration: underline; }
</style>
