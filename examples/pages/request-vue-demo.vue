<!-- examples/pages/platform-api-demo.vue 之外的**请求库产品层示例**（#1394）
     ★这一页的存在意义：证明 `@proteus-vue/request` 能在真实 Vue 页面里跑起来，
       而不是只在单测里"看起来能用"。页面上每个按钮都对应一条判据里的语义。 -->
<template>
  <view class="req-demo">
    <text class="req-demo__title">请求库 · Vue 产品层</text>
    <text class="req-demo__hint">
      三个 composable 的分工：useQuery（进页面就拉）· useMutation（写 + 乐观更新）· useRequest（点了才查）
    </text>

    <!-- ① useQuery：进页面自动拉，模板直接绑 -->
    <view class="req-demo__card">
      <text class="req-demo__card-title">① useQuery（自动发起 · 竞态裁决）</text>
      <text class="req-demo__line">loading: {{ users.loading.value }}</text>
      <text class="req-demo__line">outcome: {{ users.outcome.value ?? '（还没跑）' }}</text>
      <text class="req-demo__line">数据条数: {{ users.data.value?.length ?? 0 }}</text>
      <view class="req-demo__row">
        <button class="req-demo__btn" data-testid="req-refresh" @click="onRefresh">刷新</button>
        <button class="req-demo__btn" data-testid="req-failing" @click="onFailOnce">制造一次失败</button>
      </view>
      <!-- ★失败时数据仍然在（本层语义：刷新失败不清空已有内容） -->
      <text v-if="users.error.value" class="req-demo__err">
        错误 {{ users.error.value.code }} —— 注意上方数据条数没有归零
      </text>
    </view>

    <!-- ② useMutation：乐观更新 + 三态回滚 -->
    <view class="req-demo__card">
      <text class="req-demo__card-title">② useMutation（乐观更新 · 三态回滚）</text>
      <text class="req-demo__line">outcome: {{ create.outcome.value ?? '（还没提交）' }}</text>
      <text class="req-demo__line">本地值: {{ create.data.value ? create.data.value.title : '（空）' }}</text>
      <view class="req-demo__row">
        <button class="req-demo__btn" data-testid="req-create-ok" @click="onCreateOk">提交（成功）</button>
        <button class="req-demo__btn" data-testid="req-create-fail" @click="onCreateFail">提交（确定失败）</button>
        <button class="req-demo__btn" data-testid="req-create-unknown" @click="onCreateUnknown">
          提交（结果未知）
        </button>
      </view>
      <!-- ★三态在这里分叉：failed 已回滚、unknown 保留且要求用户去确认 -->
      <text v-if="create.outcome.value === 'unknown'" class="req-demo__warn">
        结果未知 —— 请刷新列表确认，**不要**再次提交
      </text>
    </view>

    <!-- ③ useRequest：手动触发 -->
    <view class="req-demo__card">
      <text class="req-demo__card-title">③ useRequest（点了才查）</text>
      <text class="req-demo__line">outcome: {{ search.outcome.value ?? '（还没查）' }}</text>
      <text class="req-demo__line">结果: {{ search.data.value ?? '（空）' }}</text>
      <button class="req-demo__btn" data-testid="req-search" @click="onSearch">查询当前关键词</button>
    </view>

    <text class="req-demo__log">最近一条日志：{{ log }}</text>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue'
// ★★★#1394：这就是业务侧的**全部**接入代码（没有任何"内核配置"）
import { provideRequestClient, useQuery, useMutation, useRequest } from '@proteus-vue/request'

/**
 * ★为什么这一页用"假 client"而不是真网络：
 *   demo 页要能在任何环境（含无网络的 CI 截图/单测）稳定跑出三态效果。
 *   真实项目里这里是 `provideRequestClient({ baseURL: '/api', bizId: 'demo' })`，
 *   业务代码（下面的 useQuery/useMutation/useRequest 调用）**一个字都不用改**。
 */
const client = provideRequestClient({})

/** 让 demo 可复现：用一个可控的假 task 覆盖真实客户端（只在示例里这么做） */
function fakeTask<T>(result: { ok: true; data: T } | { ok: false; outcome: 'failed' | 'unknown'; code: string }) {
  const r = result.ok
    ? ({ ok: true, outcome: 'success', data: result.data, status: 200, headers: {}, config: {} } as never)
    : ({ ok: false, outcome: result.outcome, error: { code: result.code, message: 'demo 注入的失败' } } as never)
  return { id: 'demo', result: Promise.resolve(r), state: 'done' as const, abort: () => undefined }
}
let failNext = false
let mutateMode: 'ok' | 'fail' | 'unknown' = 'ok'
;(client as unknown as { task: unknown }).task = (url: string) => {
  if (url.startsWith('/api/users')) {
    if (failNext) {
      failNext = false
      return fakeTask({ ok: false, outcome: 'failed', code: 'fetch.failed' })
    }
    return fakeTask({ ok: true, data: [{ id: 1, name: 'Ada' }, { id: 2, name: 'Linus' }] })
  }
  if (url.startsWith('/api/todo')) {
    if (mutateMode === 'fail') return fakeTask({ ok: false, outcome: 'failed', code: 'fetch.failed' })
    if (mutateMode === 'unknown') return fakeTask({ ok: false, outcome: 'unknown', code: 'fetch.unknown' })
    return fakeTask({ ok: true, data: { id: 'real-1', title: '新任务' } })
  }
  return fakeTask({ ok: true, data: `结果：${url}` })
}

const log = ref('（等待操作）')

// ① useQuery：immediate 默认 true ⇒ 进页面自动拉
const users = useQuery<Array<{ id: number; name: string }>>('/api/users', { client })

function onRefresh() {
  log.value = '刷新（成功后数据条数应保持）'
  void users.refresh()
}
function onFailOnce() {
  failNext = true
  log.value = '制造失败 —— 观察"数据条数"是否归零（不应该归零）'
  void users.refresh()
}

// ② useMutation：乐观更新；failed 回滚、unknown 保留
const create = useMutation<{ id?: string; title: string }, { title: string }>('/api/todo', {
  client,
  optimistic: (v) => ({ title: v.title }),
  onError: (_e, outcome) => {
    log.value = outcome === 'unknown'
      ? '结果未知 —— 界面保留乐观值并要求用户确认（不回滚）'
      : '确定失败 —— 已回滚，界面回到提交前'
  },
  onSuccess: () => {
    log.value = '成功 —— 用服务端返回值覆盖乐观值'
  },
})
function onCreateOk() {
  mutateMode = 'ok'
  void create.mutate({ title: '新任务' })
}
function onCreateFail() {
  mutateMode = 'fail'
  void create.mutate({ title: '会被回滚的任务' })
}
function onCreateUnknown() {
  mutateMode = 'unknown'
  void create.mutate({ title: '可能已创建的任务' })
}

// ③ useRequest：不自动发
const search = useRequest<string>({ client })
function onSearch() {
  log.value = '手动查询（useRequest 的语义：点了才发）'
  void search.send('/api/search?q=proteus')
}
</script>

<style scoped>
.req-demo {
  display: flex;
  flex-direction: column;
  padding: 16px;
  gap: 12px;
}
.req-demo__title {
  font-size: 20px;
  font-weight: 600;
}
.req-demo__hint {
  font-size: 13px;
  color: #666;
}
.req-demo__card {
  display: flex;
  flex-direction: column;
  padding: 12px;
  gap: 6px;
  border-radius: 12px;
  background: #f7f8fa;
}
.req-demo__card-title {
  font-size: 15px;
  font-weight: 600;
}
.req-demo__row {
  display: flex;
  flex-direction: row;
  gap: 8px;
  flex-wrap: wrap;
}
.req-demo__btn {
  padding: 8px 12px;
  border-radius: 8px;
  background: #2563eb;
  color: #fff;
  font-size: 13px;
}
.req-demo__line {
  font-size: 13px;
  color: #333;
}
.req-demo__err {
  font-size: 13px;
  color: #b45309;
}
.req-demo__warn {
  font-size: 13px;
  color: #b91c1c;
}
.req-demo__log {
  font-size: 12px;
  color: #666;
}
</style>
