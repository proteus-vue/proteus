// live_stream.h —— 实时投屏读取（决策 #1174 / #1175）
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
//   ⑤ **把首个 AU 里的 SPS/PPS 抠出来**（`live_peek_params`）——VideoToolbox 硬解必须有
//      extradata，而裸流里参数集随第一个 IDR 才到，所以必须"先读到参数集、再开解码器"。
//
// 【三次实测踩坑（改之前先看这里）】
//   · 组 AU 时只拼 NAL 负载、丢了起始码 ⇒ `avcodec_send_packet` 直接 INVALIDDATA(-1094995529)，0 帧；
//   · 用"一个 VCL NAL = 一帧"⇒ 一帧多 slice 时被切成多个半帧 ⇒ **画面花屏**（块状拖影）；
//   · ★找不到下一个起始码时把**尾部不完整数据既当 NAL 又留在 carry** ⇒ 同一段字节被拼进 AU 两次
//     ⇒ 码流损坏 ⇒ 画面残留块状失真（决策 #1175 抓到的真 bug）。
#ifndef POC_LIVE_STREAM_H
#define POC_LIVE_STREAM_H

#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

#define LIVE_MAX_AU 120
#define LIVE_AU_MAX (1 << 20)
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

/** 起始码长度（调用前 s 必须是 live_find_start 的返回） */
static int live_sc_len(const unsigned char *b, int n, int s) {
  return (s + 3 < n && b[s + 2] == 0 && b[s + 3] == 1) ? 4 : 3;
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

/* ── AU 组装：把 NAL 拼成"给解码器的一帧" ── */
typedef struct {
  unsigned char *au;
  int au_len;
  unsigned char *pre; /* 攒着的 SPS/PPS/SEI/AUD，归下一帧 */
  int pre_len;
  int have_vcl;
} LiveAsm;

static void live_asm_nal(LiveAsm *a, const unsigned char *nal, int len) {
  if (len <= 0) return;
  static const unsigned char sc4[4] = {0, 0, 0, 1};
  int type = nal[0] & 0x1f;
  int is_vcl = (type == 1 || type == 5);
  int first_mb_zero = 0;
  if (is_vcl && len > 1) first_mb_zero = (live_ue(nal + 1, len - 1) == 0);

  /* 新一帧开始：先把上一帧推出去 */
  if (is_vcl && a->have_vcl && first_mb_zero) {
    live_push(a->au, a->au_len);
    a->au_len = 0;
    a->have_vcl = 0;
  }
  /* 参数集/SEI/AUD 归下一帧，不留在上一帧尾巴 */
  unsigned char *dst = a->au;
  int *dst_len = &a->au_len;
  if (type == 6 || type == 7 || type == 8 || type == 9) { dst = a->pre; dst_len = &a->pre_len; }
  int cap = (dst == a->au) ? LIVE_AU_MAX : LIVE_PRE_MAX;
  if (*dst_len + len + 4 < cap) {
    memcpy(dst + *dst_len, sc4, 4);
    *dst_len += 4;
    memcpy(dst + *dst_len, nal, (size_t)len);
    *dst_len += len;
  }
  if (is_vcl) {
    if (!a->have_vcl && a->pre_len > 0) { /* 把攒着的参数集搬到这一帧开头 */
      if (a->pre_len + a->au_len + 4 < LIVE_AU_MAX) {
        memmove(a->au + a->pre_len, a->au, (size_t)a->au_len);
        memcpy(a->au, a->pre, (size_t)a->pre_len);
        a->au_len += a->pre_len;
      }
      a->pre_len = 0;
    }
    a->have_vcl = 1;
  }
}

/* ── 参数集取证（给 VideoToolbox 的 extradata） ── */

/** 从一段 Annex-B 里抠出 SPS(7)+PPS(8)，拼成 extradata 形态；没凑齐返回 0 */
static int live_find_params(const unsigned char *au, int n, unsigned char *out, int cap) {
  static const unsigned char sc4[4] = {0, 0, 0, 1};
  int out_len = 0, sps = 0, pps = 0, pos = 0;
  for (;;) {
    int s = live_find_start(au, n, pos);
    if (s < 0) break;
    int body = s + live_sc_len(au, n, s);
    int e = live_find_start(au, n, body);
    int len = ((e < 0) ? n : e) - body;
    if (len > 0) {
      int type = au[body] & 0x1f;
      if ((type == 7 || type == 8) && out_len + len + 4 < cap) {
        memcpy(out + out_len, sc4, 4);
        out_len += 4;
        memcpy(out + out_len, au + body, (size_t)len);
        out_len += len;
        if (type == 7) sps++; else pps++;
      }
    }
    if (e < 0) break;
    pos = e;
  }
  return (sps && pps) ? out_len : 0;
}

/**
 * 在队列里**窥探**（不取走）第一个带 SPS+PPS 的 AU，把参数集写到 out。
 * 返回 1 = 找到；0 = 目前还没有（调用方自己 sleep 重试）。
 * ★不取走是故意的：那个 AU 是首个 IDR，丢了就得等下一个关键帧。
 */
static int live_peek_params(unsigned char *out, int cap, int *out_len) {
  int found = 0;
  pthread_mutex_lock(&g_live_lock);
  for (int i = 0; i < g_live_count && !found; i++) {
    LiveAu *au = &g_live_q[(g_live_head + i) % LIVE_MAX_AU];
    int n = live_find_params(au->data, au->size, out, cap);
    if (n > 0) { *out_len = n; found = 1; }
  }
  pthread_mutex_unlock(&g_live_lock);
  return found;
}

static void *live_reader(void *arg) {
  (void)arg;
  static unsigned char chunk[1 << 16];
  static unsigned char au_buf[LIVE_AU_MAX];
  static unsigned char pre_buf[LIVE_PRE_MAX];

  while (g_live_run) {
    FILE *p = popen(g_live_cmd, "r");
    if (!p) { usleep(300000); continue; }
    g_live_restarts++;
    LiveAsm a = {au_buf, 0, pre_buf, 0, 0};
    int carry = 0;

    while (g_live_run) {
      // ★用 read(fd) 而不是 fread：fread 会**把请求的字节数读满才返回**（glibc 对管道也循环读），
      //   64KB 缓冲在 8Mbps 下要攒 ~64ms ⇒ AU 变成"一坨一坨"到达：
      //   一半以上的渲染拍空转，投屏端到端延迟还平白多出最多 64ms（实测 ticks=309 里 empty=228）。
      //   read() 对管道是"当前有多少给多少"，延迟与到达抖动都小一个量级。
      ssize_t got = read(fileno(p), chunk + carry, sizeof(chunk) - carry);
      if (got <= 0) break;
      int n = carry + (int)got;
      int pos = 0;
      for (;;) {
        int s = live_find_start(chunk, n, pos);
        // ★找不到下一个起始码 ⇒ 剩下的字节可能是**被截断的 NAL**，本轮绝不能当完整 NAL 用。
        //   第一版在这里 `end = n` 就地处理、却没把 pos 推到 n，导致同一段字节既进 AU
        //   又被 carry 带到下一轮再进一次 ⇒ 码流损坏 ⇒ 画面残留块状失真。
        if (s < 0) break;
        live_asm_nal(&a, chunk + pos, s - pos);
        pos = s + live_sc_len(chunk, n, s);
      }
      int rest = n - pos;
      if (rest >= (int)sizeof(chunk) - 4) {
        // 缓冲塞满仍等不到起始码 ⇒ 单 NAL 超过 64KB，只能硬切（否则这里会卡死）
        live_asm_nal(&a, chunk + pos, rest);
        rest = 0;
        pos = n;
      }
      if (rest > 0) {
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
