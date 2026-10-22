// live_stream.h —— 实时投屏读取（决策 #1174）
//
// 【为什么不能直接喂 ffmpeg】`adb exec-out screenrecord --output-format=h264 -` 出的是**裸 Annex-B**，
//   没有容器时间戳。ffmpeg 的 raw h264 demuxer 只能按默认帧率猜（实测报 25fps），
//   而设备实际是 ~120fps ⇒ 播成慢动作。（PoC C 的发现③）
//
// 【本文件做的事】自己当"传输层"：
//   ① popen 拉流（进程退出后自动重连，screenrecord 有 180s 上限）
//   ② Annex-B 拆 NAL；**按 `first_mb_in_slice == 0` 判新帧**（一帧可能有多个 slice）
//      SPS/PPS/SEI 归给**下一帧**，不留在上一帧尾巴上
//   ③ **到帧时刻 = PTS**（CLOCK_MONOTONIC），这是实时投屏唯一可用的时间基准
//   ④ 环形队列交给主线程消费（读取线程只做 IO+拆包，不碰 GL）
//
// 【两次实测踩坑（改之前先看这里）】
//   · 组 AU 时只拼 NAL 负载、丢了起始码 ⇒ `avcodec_send_packet` 直接 INVALIDDATA(-1094995529)，0 帧；
//   · 用"一个 VCL NAL = 一帧"⇒ 一帧多 slice 时被切成多个半帧 ⇒ **画面花屏**（块状拖影）。
#ifndef POC_LIVE_STREAM_H
#define POC_LIVE_STREAM_H

#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

#define LIVE_MAX_AU 120
#define LIVE_PRE_MAX (64 * 1024)

typedef struct {
  unsigned char *data;
  int size;
  double t_ms;
} LiveAu;

static pthread_mutex_t g_live_lock = PTHREAD_MUTEX_INITIALIZER;
static LiveAu g_live_q[LIVE_MAX_AU];
static int g_live_head = 0, g_live_tail = 0, g_live_count = 0;
static pthread_t g_live_thread;
static volatile int g_live_run = 0;
static volatile int g_live_restarts = 0;
static volatile long g_live_aus = 0;
static char g_live_cmd[512];

static double live_now_ms(void) {
  struct timespec ts;
  clock_gettime(CLOCK_MONOTONIC, &ts);
  return ts.tv_sec * 1e3 + ts.tv_nsec / 1e6;
}

static void live_push(const unsigned char *buf, int n) {
  if (n <= 0) return;
  pthread_mutex_lock(&g_live_lock);
  if (g_live_count == LIVE_MAX_AU) { /* 实时优先：积压就丢最旧的 */
    free(g_live_q[g_live_head].data);
    g_live_head = (g_live_head + 1) % LIVE_MAX_AU;
    g_live_count--;
  }
  LiveAu *au = &g_live_q[g_live_tail];
  au->data = (unsigned char *)malloc((size_t)n);
  memcpy(au->data, buf, (size_t)n);
  au->size = n;
  au->t_ms = live_now_ms();
  g_live_tail = (g_live_tail + 1) % LIVE_MAX_AU;
  g_live_count++;
  g_live_aus++;
  pthread_mutex_unlock(&g_live_lock);
}

/** 取一帧；没有就返回 0（调用方不阻塞——渲染在主线程，不能等） */
static int live_pop(LiveAu *out) {
  pthread_mutex_lock(&g_live_lock);
  if (g_live_count == 0) { pthread_mutex_unlock(&g_live_lock); return 0; }
  *out = g_live_q[g_live_head];
  g_live_head = (g_live_head + 1) % LIVE_MAX_AU;
  g_live_count--;
  pthread_mutex_unlock(&g_live_lock);
  return 1;
}

/** 下一个起始码位置（3 或 4 字节），无则 -1 */
static int live_find_start(const unsigned char *b, int n, int from) {
  for (int i = from; i + 2 < n; i++) {
    if (b[i] == 0 && b[i + 1] == 0) {
      if (b[i + 2] == 1) return i;
      if (i + 3 < n && b[i + 2] == 0 && b[i + 3] == 1) return i;
    }
  }
  return -1;
}

/** 读无符号指数哥伦布（只用来判 first_mb_in_slice 是否为 0） */
static int live_ue(const unsigned char *p, int n) {
  int zeros = 0;
  for (;;) {
    if (zeros > 31 || zeros >= n * 8) return -1;
    int bit = (p[zeros >> 3] >> (7 - (zeros & 7))) & 1;
    if (bit) break;
    zeros++;
  }
  int idx = zeros + 1, val = 0;
  for (int k = 0; k < zeros; k++, idx++) {
    if (idx >= n * 8) return -1;
    val = (val << 1) | ((p[idx >> 3] >> (7 - (idx & 7))) & 1);
  }
  return (1 << zeros) - 1 + val;
}

static void *live_reader(void *arg) {
  (void)arg;
  static unsigned char chunk[1 << 16];
  static unsigned char au[1 << 20];
  static unsigned char pre[LIVE_PRE_MAX];
  static const unsigned char sc4[4] = {0, 0, 0, 1};

  int au_len = 0, pre_len = 0, have_vcl = 0;

  while (g_live_run) {
    FILE *p = popen(g_live_cmd, "r");
    if (!p) { usleep(300000); continue; }
    g_live_restarts++;
    au_len = pre_len = have_vcl = 0;
    int carry = 0;

    while (g_live_run) {
      size_t got = fread(chunk + carry, 1, sizeof(chunk) - carry, p);
      if (got == 0) break;
      int n = carry + (int)got;
      int pos = 0;
      for (;;) {
        int s = live_find_start(chunk, n, pos);
        int end = (s < 0) ? n : s;
        if (end > pos) {
          const unsigned char *nal = chunk + pos; /* pos 指向起始码之后 */
          int len = end - pos;
          int type = nal[0] & 0x1f;
          int is_vcl = (type == 1 || type == 5);
          int first_mb_zero = 0;
          if (is_vcl && len > 1) first_mb_zero = (live_ue(nal + 1, len - 1) == 0);

          /* 新一帧开始：先把上一帧推出去 */
          if (is_vcl && have_vcl && first_mb_zero) {
            live_push(au, au_len);
            au_len = 0;
            have_vcl = 0;
          }
          /* 参数集/SEI/AUD 归下一帧，不留在上一帧尾巴 */
          unsigned char *dst = au;
          int *dst_len = &au_len;
          if (type == 6 || type == 7 || type == 8 || type == 9) { dst = pre; dst_len = &pre_len; }
          if (*dst_len + len + 4 < (int)((dst == au) ? sizeof(au) : LIVE_PRE_MAX)) {
            memcpy(dst + *dst_len, sc4, 4);
            *dst_len += 4;
            memcpy(dst + *dst_len, nal, (size_t)len);
            *dst_len += len;
          }
          if (is_vcl) {
            if (!have_vcl && pre_len > 0) { /* 把攒着的参数集搬到这一帧开头 */
              if (pre_len + au_len + 4 < (int)sizeof(au)) {
                memmove(au + pre_len, au, (size_t)au_len);
                memcpy(au, pre, (size_t)pre_len);
                au_len += pre_len;
              }
              pre_len = 0;
            }
            have_vcl = 1;
          }
        }
        if (s < 0) break;
        pos = s + ((s + 3 < n && chunk[s + 2] == 0) ? 4 : 3);
      }
      int rest = n - pos;
      if (rest > 0 && rest < (int)sizeof(chunk)) {
        memmove(chunk, chunk + pos, (size_t)rest);
        carry = rest;
      } else {
        carry = 0;
      }
    }
    pclose(p);
    if (g_live_run) usleep(200000);
  }
  return NULL;
}

static int live_start(const char *cmd) {
  snprintf(g_live_cmd, sizeof(g_live_cmd), "%s", cmd);
  g_live_run = 1;
  if (pthread_create(&g_live_thread, NULL, live_reader, NULL) != 0) {
    g_live_run = 0;
    return -1;
  }
  return 0;
}

static void live_stop(void) {
  g_live_run = 0;
  pthread_join(g_live_thread, NULL);
  pthread_mutex_lock(&g_live_lock);
  while (g_live_count) {
    free(g_live_q[g_live_head].data);
    g_live_head = (g_live_head + 1) % LIVE_MAX_AU;
    g_live_count--;
  }
  pthread_mutex_unlock(&g_live_lock);
}

#endif /* POC_LIVE_STREAM_H */
