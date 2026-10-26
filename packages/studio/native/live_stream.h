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
  double t_ms;   /* 这一帧**第一个字节到达**的时刻（不是凑齐时刻）——延迟统计的起点 */
} LiveAu;

static pthread_mutex_t g_live_lock = PTHREAD_MUTEX_INITIALIZER;
static LiveAu g_live_q[LIVE_MAX_AU];
static int g_live_head = 0, g_live_tail = 0, g_live_count = 0;
static pthread_t g_live_thread;
static volatile int g_live_run = 0;
static volatile int g_live_restarts = 0;
static volatile long g_live_aus = 0;
static volatile long long g_live_bytes = 0;   /* 累加入队 AU 的字节数（码率估算用） */

static char g_live_cmd[512];

static int live_nal_ok(const unsigned char *p, int len);   /* 定义在下方：文本垃圾过滤器 */
static int live_nal_hdr_ok(const unsigned char *p);        /* 定义在下方：NAL 头合法性 */

static double live_now_ms(void) {
  struct timespec ts;
  clock_gettime(CLOCK_MONOTONIC, &ts);
  return ts.tv_sec * 1e3 + ts.tv_nsec / 1e6;
}

/* 自检（决策 #1259）：一帧 AU 内部的 NAL 之间只该有**我们写进去的**起始码。
 *   如果 payload 里又出现 `00 00 01`，说明输入流被脏数据拼接坏了 —— 这种包喂给解码器
 *   就会报 `Invalid NAL unit 0` 并把整段画面糊掉。命中时（POC_DUMP_BAD_AU 设置）落盘取证。 */
static void live_check_au(const unsigned char *buf, int n, long idx) {
  const char *dp = getenv("POC_DUMP_BAD_AU");
  { /* 逐帧落盘（取证）：POC_DUMP_AU_DIR=<dir> 前 200 帧各存一个文件 */
    const char *dd = getenv("POC_DUMP_AU_DIR");
    if (dd && idx < 200) {
      char path[512];
      snprintf(path, sizeof(path), "%s/au-%04ld.h264", dd, idx);
      FILE *f = fopen(path, "wb");
      if (f) { fwrite(buf, 1, (size_t)n, f); fclose(f); }
    }
  }
  const char *bad = NULL;
  int badtype = -1, at = -1, nals = 0;
  for (int i = 0; i + 3 < n; i++) {
    if (!(buf[i] == 0 && buf[i + 1] == 0 && buf[i + 2] == 1)) continue;
    int h = buf[i + 3];
    int t = h & 0x1f;
    nals++;
    /* 只认我们真的会写进去的类型；出现别的 ⇒ 有脏数据被拼进了这一帧 */
    if (!(t == 1 || t == 5 || t == 6 || t == 7 || t == 8 || t == 9)) {
      bad = "非法 NAL 类型"; badtype = t; at = i; break;
    }
    if (h & 0x80) { bad = "forbidden_zero_bit=1"; badtype = t; at = i; break; }
    i += 2;
  }
  if (!bad) return;
  fprintf(stderr, "AU#%ld 脏（%s=%d @%d，共 %d 个 NAL，%d 字节）⇒ 这帧必然花\n", idx, bad, badtype, at, nals, n);
  if (!dp) return;
  char path[512];
  snprintf(path, sizeof(path), "%s.%ld.h264", dp, idx);
  FILE *f = fopen(path, "wb");
  if (f) { fwrite(buf, 1, (size_t)n, f); fclose(f); }
}

static void live_push(const unsigned char *buf, int n, double t_first) {
  if (n <= 0) return;
  live_check_au(buf, n, g_live_aus);
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
  au->t_ms = t_first;
  g_live_tail = (g_live_tail + 1) % LIVE_MAX_AU;
  g_live_count++;
  g_live_aus++;
  g_live_bytes += n;
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
  int started;    /* 当前 AU 是否已开始（用来只记一次首字节时刻） */
  double t_first; /* 当前 AU 首字节到达时刻 */
} LiveAsm;

static void live_asm_nal(LiveAsm *a, const unsigned char *nal, int len) {
  if (len <= 0) return;
  /* 设备日志文本混进 stdout 时会被误认成 **SPS**（实测小米那行 "getCotaRegion..." 首字节 0x67
     ⇒ 0x67 & 0x1f == 7）⇒ **只对参数集**用这条判据，别对 VCL 用。
     ★第一版把所有 NAL 都过 ASCII 判据 —— 整屏都是文字时真 IDR（26KB）也被当垃圾丢掉，frames 直接归零。
       教训：启发式只能用在"本该很短很干净"的东西上（决策 #1256）。 */
  if ((nal[0] & 0x1f) == 7 || (nal[0] & 0x1f) == 8) {
    if (!live_nal_ok(nal, len)) return;
  }
  static const unsigned char sc4[4] = {0, 0, 0, 1};
  // ★延迟统计的起点 = 这一帧**第一个 NAL 的到达时刻**，不是"凑齐一整帧"的时刻。
  //   凑齐时刻会把"等下一帧第一个 VCL 才知道上帧结束"的那一帧时间算进延迟（虚高 ~8ms@120fps）。
  if (!a->started) { a->t_first = live_now_ms(); a->started = 1; }
  int type = nal[0] & 0x1f;
  int is_vcl = (type == 1 || type == 5);
  int first_mb_zero = 0;
  if (is_vcl && len > 1) first_mb_zero = (live_ue(nal + 1, len - 1) == 0);

  /* 新一帧开始：先把上一帧推出去 */
  if (is_vcl && a->have_vcl && first_mb_zero) {
    live_push(a->au, a->au_len, a->t_first);
    a->au_len = 0;
    a->have_vcl = 0;
    a->started = 0;
  }
  /* 参数集/SEI/AUD 归下一帧，不留在上一帧尾巴 */
  unsigned char *dst = a->au;
  int *dst_len = &a->au_len;
  if (type == 6 || type == 7 || type == 8 || type == 9) { dst = a->pre; dst_len = &a->pre_len; }
  int cap = (dst == a->au) ? LIVE_AU_MAX : LIVE_PRE_MAX;
  if (*dst_len + len + 4 >= cap) {
    fprintf(stderr, "⚠︎ AU 缓冲满，丢弃一个 NAL（type=%d len=%d 已用=%d/%d）——这帧将缺片\n", type, len, *dst_len, cap);
  } else {
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
/* NAL 合法性快速判定（决策 #1256）。
 * 【为什么必须有】`adb exec-out screenrecord` 的输出里会**混进设备侧的日志文本**
 *   （实测小米：`getCotaRegionCustIntFeature do not exist with the carrier or region : 0`）。
 *   那行字首字节是 0x67 ⇒ `& 0x1f == 7` ⇒ **被当成 SPS**，73 字节 ASCII 进了 extradata，
 *   于是 VideoToolbox 拿到一份坏参数集：`Clipping illegal num_reorder_frames` /
 *   `Error decoding the extradata`，接下来逐帧硬解被拒、画面只剩零星几帧。
 * 【判据】真实 SPS/PPS/VCL 是二进制，且为防竞争字节会插入 0x03 —— **绝不会出现
 *   连续 ≥8 个可打印 ASCII**；再夹一个长度上限。两条都过才认为是真 NAL。 */
/* NAL **头字节**合法性（决策 #1259）：只认我们真的会处理的那几种。
 * 【为什么必须有】设备往 stdout 里混的日志文本可能自带 `00 00 01`，于是紧跟的那个字节
 *   被当成 NAL 头——常见是 0x00（type 0，**合法类型里没有 0**）。这类假 NAL 会让解码器
 *   报 `Invalid NAL unit 0`，更糟的是它一旦落在参数集位置，就把 PPS 污染成
 *   "data partitioning" 之类，之后整段画面糊成竖条（实测第 150 帧：上面正常、下面全花）。
 * 【只放行】1 非IDR片 / 5 IDR / 6 SEI / 7 SPS / 8 PPS / 9 AUD；且 forbidden_zero_bit 必须为 0。
 *   其余（0、2~4、10~31）一律丢弃——本工具不需要它们，而放进来就是给解码器投毒。 */
static int live_nal_hdr_ok(const unsigned char *p) {
  if (p[0] & 0x80) return 0;              /* forbidden_zero_bit 必须 0 */
  int t = p[0] & 0x1f;
  return t == 1 || t == 5 || t == 6 || t == 7 || t == 8 || t == 9;
}

static int live_nal_ok(const unsigned char *p, int len) {
  if (len <= 0 || len > LIVE_AU_MAX) return 0;
  /* ★长度上限（决策 #1259）：真 SPS ≤64B、PPS ≤32B（本机实测 19B / 5B）。
     设备日志那行是 73B —— 单靠这条就能挡住它，ASCII 那条是第二道锁。 */
  int t = p[0] & 0x1f;
  if (t == 7 && len > 64) return 0;
  if (t == 8 && len > 32) return 0;
  int run = 0;
  for (int i = 0; i < len; i++) {
    unsigned char c = p[i];
    if (c >= 0x20 && c <= 0x7e) {
      if (++run >= 8) return 0;   /* 连续 8 个可打印字符 ⇒ 这是文本，不是码流 */
    } else {
      run = 0;
    }
  }
  return 1;
}

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
      if ((type == 7 || type == 8) && live_nal_ok(au + body, len) && out_len + len + 4 < cap) {
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
/* ★★读缓冲必须装得下**一个完整 NAL**（决策 #1259）。
     原来是 64KB，而 884x1920 @13Mbps 的**关键帧 NAL 实测 18 万字节** ⇒ 超缓冲后走"硬切"分支，
     一帧 IDR 被切成两截、当两个 NAL 拼进 AU（自检日志：非法 NAL 类型=4 @65541，正是 64K+5）
     ⇒ 关键帧作废，之后所有 P 帧都参考一帧不存在的图像 ⇒ **画面糊成竖条、内容错位**。
     ⇒ 放到 4MB：常见分辨率的关键帧都能整装；真超过时仍有"硬切"兜底（并打日志）。 */
  static unsigned char chunk[4 << 20];
  static unsigned char au_buf[LIVE_AU_MAX];
  static unsigned char pre_buf[LIVE_PRE_MAX];

  while (g_live_run) {
    FILE *p = popen(g_live_cmd, "r");
    if (!p) { usleep(300000); continue; }
    g_live_restarts++;
    LiveAsm a = {au_buf, 0, pre_buf, 0, 0, 0, 0};
    int carry = 0;

    while (g_live_run) {
      // ★用 read(fd) 而不是 fread：fread 会**把请求的字节数读满才返回**（glibc 对管道也循环读），
      //   64KB 缓冲在 8Mbps 下要攒 ~64ms ⇒ AU 变成"一坨一坨"到达：
      //   一半以上的渲染拍空转，投屏端到端延迟还平白多出最多 64ms（实测 ticks=309 里 empty=228）。
      //   read() 对管道是"当前有多少给多少"，延迟与到达抖动都小一个量级。
      ssize_t got = read(fileno(p), chunk + carry, sizeof(chunk) - carry);
      if (got <= 0) break;
      { /* 取证钩子：POC_DUMP_STREAM=<path> 把**管道原始字节**落盘（分析脏数据用，决策 #1259） */
        static FILE *dfs = NULL; static int dinit = 0;
        if (!dinit) { dinit = 1; const char *dp = getenv("POC_DUMP_STREAM"); if (dp) dfs = fopen(dp, "wb"); }
        if (dfs) { fwrite(chunk + carry, 1, (size_t)got, dfs); fflush(dfs); }
      }
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
        /* 走到这里说明**单个 NAL 比 4MB 还大**（正常码流不该发生）⇒ 只能硬切，并喊出来：
           切开的 NAL 一定解不出正确画面，静默切就是在制造"读数正常、画面很花"。 */
        fprintf(stderr, "⚠︎ 单个 NAL 超过读缓冲（%d 字节）⇒ 硬切，这一段画面必然坏\n", rest);
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

/* 启动前清掉**上一次**留下的设备侧采集（决策 #1257 附带修的）。
 * 【为什么必须有】Android 同时只允许**一个** screenrecord 会话。app 被 kill/crash 后
 *   设备上那条 `screenrecord` 仍然活着（实测：杀掉 Studio 后 `adb shell ps -A` 里还在），
 *   于是下次启动的那条**抢不到采集权** ⇒ 现象是"运行中 / 入队 AU 一直在涨 / 出帧 0 / 画面全黑"，
 *   而且**不报错**（又是本仓最讨厌的静默无操作）。
 * 【只对 adb 命令做】iOS 那条腿是 `nc -l`（下行推流），被杀进程不会残留在设备上。
 * 【为什么用 `pkill -x`】按**进程名精确匹配**：`-f` 会匹配命令行，会把执行这条 pkill 的
 *   shell 自己也匹配上（命令行里含 "screenrecord"），出现自己杀自己的怪状。 */
static void live_kill_stale_capture(const char *cmd) {
  const char *at = strstr(cmd, "exec-out");
  if (!at) return;                       /* 不是 adb 采集命令 */
  char prefix[256], kill[512];
  size_t n = (size_t)(at - cmd);
  if (n >= sizeof(prefix)) n = sizeof(prefix) - 1;
  memcpy(prefix, cmd, n);
  prefix[n] = 0;
  snprintf(kill, sizeof(kill), "%s shell pkill -x screenrecord 2>/dev/null", prefix);
  int rc = system(kill);
  if (rc == 0) fprintf(stderr, "实时：已清理上一次残留的 screenrecord（新会话才有采集权）\n");
}

static int live_start(const char *cmd) {
  live_kill_stale_capture(cmd);
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
