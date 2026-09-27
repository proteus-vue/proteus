// packages/layout-core-rust/src/recycle.rs
// ★★M3 `recycle/` 模块：**列表复用池 + 生命周期状态机**（方案 §5.1 / §12.6）。
//
// 定位：本模块是**平台无关**的纯逻辑（方案 §1：「布局算法、节点树、文本度量、拍平判定、
//   复用池——这些逻辑与平台无关，写一遍」）→ 平台侧（Android/iOS）只需按状态机执行动作。
//
// 三个子问题（各自对应方案里的一条硬要求）：
//   ① **对象复用**（§12.7 P1「layer 复用池」）：滚动时不反复创建/销毁 → 复用池
//      ——「节点分配池化：列表复用由 `recycle/` 统一管理，滚动时不触发堆分配」（§5.3）
//   ② **可见区与预加载区**（§12.6 关键细节）：**滚动方向变化时动态交换前后预加载区域**，
//      leading（前进方向）区域远大于 following（离开方向）——纯为内存服务
//   ③ **三档生命周期**（§12.6 移植 Texture `ASRangeController`）：
//      Preload（缓存显示数据）→ Display（保持渲染缓存）→ Visible（保持高质量缓存）→ 退出可见（释放资源）
//
// ★为什么「方向敏感的预加载区」值得单独设计（而非对称预留）：
//   对称预留 = 前后各留 N 行 = 2N 行内存常驻；
//   方向敏感 = 前进方向留 N、离开方向留 N/4（可回收）→ 常驻行数与「即将用到的」更匹配，
//   且**回滚**（本项验收的核心场景）时方向反转，交换立刻生效，不会出现「刚滚过就没了」的重复构建。

use std::collections::HashMap;

/// 列表项的生命周期状态（§12.6 三档 + 已释放）
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Lifecycle {
    /// 未创建（尚无资源）
    None,
    /// 数据已加载（缓存显示数据）
    Preload,
    /// 已渲染（保持渲染缓存——如文本已光栅化）
    Display,
    /// 可见（保持高质量资源）
    Visible,
}

impl Lifecycle {
    /// 该状态是否持有「渲染缓存」级别的资源（用于降级时判断要不要释放）
    pub fn holds_render_cache(self) -> bool {
        matches!(self, Lifecycle::Display | Lifecycle::Visible)
    }

    /// 该状态是否持有「高质量」资源（图片高分辨率位图等）
    pub fn holds_high_quality(self) -> bool {
        self == Lifecycle::Visible
    }
}

/// 滚动方向（决定 leading/following 哪边是「前进方向」）
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ScrollDirection {
    Forward,
    Backward,
    Idle,
}

/// 可见区与预加载区（**行号区间**，闭区间语义更贴近列表实现）
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct VisibleRange {
    /// 可见区首行
    pub first_visible: usize,
    /// 可见区末行（含）
    pub last_visible: usize,
    /// 预加载区首行（含）
    pub first_preload: usize,
    /// 预加载区末行（含）
    pub last_preload: usize,
}

impl VisibleRange {
    pub fn visible_count(&self) -> usize {
        self.last_visible.saturating_sub(self.first_visible) + 1
    }

    pub fn total_count(&self) -> usize {
        self.last_preload.saturating_sub(self.first_preload) + 1
    }

    pub fn contains_visible(&self, row: usize) -> bool {
        row >= self.first_visible && row <= self.last_visible
    }
}

/// 复用池配置（可调；默认值按「内存与流畅度的平衡」定）
#[derive(Debug, Clone, Copy)]
pub struct RecycleConfig {
    /// 前进方向预加载的行数（leading）
    pub leading_rows: usize,
    /// 离开方向保留的行数（following）—— ★刻意小于 leading（§12.6）
    pub following_rows: usize,
    /// 池容量上限（防止池本身成为内存泄漏源）
    pub max_pool_entries: usize,
}

impl Default for RecycleConfig {
    fn default() -> Self {
        Self {
            leading_rows: 8,     // 前进方向多留：即将进入可见区，提前做好
            following_rows: 2,   // 离开方向少留：已滚过，尽快释放（★非对称是关键）
            max_pool_entries: 64,
        }
    }
}

/// ★复用池（对象复用，避免滚动时的堆分配）
///
/// 用法：`acquire()` 取一个可复用对象（没有则新建）；`release(obj)` 归还。
/// 池满时归还的对象被丢弃（有界，不成为泄漏源）。
#[derive(Debug)]
pub struct RecyclePool<T> {
    free: Vec<T>,
    created: usize,
    reused: usize,
    discarded: usize,
    max_entries: usize,
}

impl<T> RecyclePool<T> {
    pub fn new(max_entries: usize) -> Self {
        Self { free: Vec::new(), created: 0, reused: 0, discarded: 0, max_entries }
    }

    /// 取一个对象：优先复用，否则用 `make` 新建
    pub fn acquire<F: FnOnce() -> T>(&mut self, make: F) -> T {
        match self.free.pop() {
            Some(v) => {
                self.reused += 1;
                v
            }
            None => {
                self.created += 1;
                make()
            }
        }
    }

    /// 归还对象（池满则丢弃——有界）
    pub fn release(&mut self, value: T) {
        if self.free.len() < self.max_entries {
            self.free.push(value);
        } else {
            self.discarded += 1;
        }
    }

    /// 清空池（如列表数据源整体更换）
    pub fn clear(&mut self) {
        self.free.clear();
    }

    // ── 可观测读数（验收用：真实复用率是「滚动不触发堆分配」的直接证据）──
    pub fn created_count(&self) -> usize {
        self.created
    }
    pub fn reused_count(&self) -> usize {
        self.reused
    }
    pub fn discarded_count(&self) -> usize {
        self.discarded
    }
    pub fn pooled_count(&self) -> usize {
        self.free.len()
    }
    /// 复用率 = 复用次数 / 总获取次数（越高越好；理想情况稳态接近 1）
    pub fn reuse_ratio(&self) -> f64 {
        let total = self.created + self.reused;
        if total == 0 {
            0.0
        } else {
            self.reused as f64 / total as f64
        }
    }
}

/// ★列表窗口求解器（可见区 + 方向敏感的预加载区）
///
/// 这是 §12.6「用户改变滚动方向时动态交换前后预加载区域」的实现：
///   · Forward：预加载区 = [first_visible - following, last_visible + leading]
///   · Backward（含**回滚**）：预加载区 = [first_visible - leading, last_visible + following]
///   · Idle：两侧对称（用 following 值），因为不知道用户接下来往哪滚
#[derive(Debug)]
pub struct ListWindow {
    config: RecycleConfig,
    direction: ScrollDirection,
    /// 上一帧的首行（用于判断方向）
    last_first_visible: usize,
    /// 是否已完成首次布局
    ///
    /// ★为何需要（本仓实测暴露）：首次 `update_visible` 时 `last_first_visible` 还是初值 0，
    ///   「首行 100 > 0」会被误判为**向下滚动 Forward** → 首次布局就按方向多留 8 行。
    ///   首次布局不是滚动，应判 Idle（两侧对称），否则初始内存高于必要。
    initialized: bool,
    /// 可见区首末行（由平台侧的滚动位置 + 行高算出后喂进来）
    first_visible: usize,
    last_visible: usize,
    item_count: usize,
}

impl ListWindow {
    pub fn new(config: RecycleConfig, item_count: usize) -> Self {
        Self {
            config,
            direction: ScrollDirection::Idle,
            last_first_visible: 0,
            initialized: false,
            first_visible: 0,
            last_visible: 0,
            item_count,
        }
    }

    pub fn config(&self) -> &RecycleConfig {
        &self.config
    }

    pub fn direction(&self) -> ScrollDirection {
        self.direction
    }

    /// 更新可见区（平台侧每次滚动/布局变化时调用）
    ///
    /// ★方向由「首行相对上一帧的位移」推断：不变 → Idle（静止时收回预加载区，省内存）
    pub fn update_visible(&mut self, first_visible: usize, last_visible: usize) {
        // ★首次布局 → Idle（不是滚动）；之后才按位移判方向
        self.direction = if !self.initialized {
            ScrollDirection::Idle
        } else if first_visible > self.last_first_visible {
            ScrollDirection::Forward
        } else if first_visible < self.last_first_visible {
            ScrollDirection::Backward
        } else {
            ScrollDirection::Idle
        };
        self.initialized = true;
        self.last_first_visible = first_visible;
        self.first_visible = first_visible.min(self.item_count.saturating_sub(1));
        self.last_visible = last_visible.min(self.item_count.saturating_sub(1));
    }

    /// 当前应处于「预加载区」的行范围
    pub fn range(&self) -> VisibleRange {
        // ★★方向敏感的核心：`leading` 归给**前进方向**，`following` 归给**离开方向**。
        //   注意两个方向下「前进方向」在行号的哪一侧是**相反**的：
        //     · Forward（向下滚）：前进方向 = 行号增大侧（下方）→ 下方多留
        //     · Backward（回滚）：前进方向 = 行号减小侧（上方）→ 上方多留
        //   本仓实测教训：初版把两个分支写成同一组参数（都「下方多留」）→
        //   回滚时前进方向（上方）只留了 2 行，**刚滚过的行立刻被释放** → 回滚要重建。
        let (above, below) = match self.direction {
            ScrollDirection::Forward => (self.config.following_rows, self.config.leading_rows),
            ScrollDirection::Backward => (self.config.leading_rows, self.config.following_rows),
            ScrollDirection::Idle => (self.config.following_rows, self.config.following_rows),
        };
        let first_pre = self.first_visible.saturating_sub(above);
        let last_pre = (self.last_visible + below).min(self.item_count.saturating_sub(1));
        VisibleRange { first_visible: self.first_visible, last_visible: self.last_visible, first_preload: first_pre, last_preload: last_pre }
    }

    /// 给定当前应存在的行集合，返回「需要创建/升级」与「需要释放」的行
    ///
    /// ★这是状态机的驱动入口：平台侧拿到 `to_release` 即释放对应资源（§12.6「退出可见 → 释放」）
    pub fn diff(&self, current: &HashMap<usize, Lifecycle>) -> (Vec<usize>, Vec<usize>) {
        let r = self.range();
        let mut to_acquire = Vec::new();
        let mut to_release = Vec::new();
        for row in r.first_preload..=r.last_preload {
            if !current.contains_key(&row) {
                to_acquire.push(row);
            }
        }
        for (&row, _) in current.iter() {
            if row < r.first_preload || row > r.last_preload {
                to_release.push(row);
            }
        }
        to_acquire.sort_unstable();
        to_release.sort_unstable();
        (to_acquire, to_release)
    }
}

/// 列表状态机（把「行 → 生命周期」的迁移规则集中在一处，平台侧只执行动作）
#[derive(Debug, Default)]
pub struct ListStateMachine {
    /// 行 → 当前状态
    pub states: HashMap<usize, Lifecycle>,
}

impl ListStateMachine {
    pub fn new() -> Self {
        Self { states: HashMap::new() }
    }

    /// 新增一行（进入预加载区）→ Preload
    pub fn on_acquire(&mut self, row: usize) {
        self.states.insert(row, Lifecycle::Preload);
    }

    /// 渲染完成 → Display
    pub fn on_displayed(&mut self, row: usize) {
        if let Some(s) = self.states.get_mut(&row) {
            if *s < Lifecycle::Display {
                *s = Lifecycle::Display;
            }
        }
    }

    /// 进入可见 → Visible
    pub fn on_visible(&mut self, row: usize) {
        if let Some(s) = self.states.get_mut(&row) {
            *s = Lifecycle::Visible;
        }
    }

    /// 退出预加载区 → 释放（§12.6「退出可见 → 释放非必要资源 / 回收 layer」）
    pub fn on_release(&mut self, row: usize) -> Option<Lifecycle> {
        self.states.remove(&row)
    }

    /// 行数（可观测）
    pub fn len(&self) -> usize {
        self.states.len()
    }

    pub fn is_empty(&self) -> bool {
        self.states.is_empty()
    }

    /// 各状态计数（诊断：能看到「有多少行停在 Display 却没升级」这类异常）
    pub fn count_by_state(&self) -> (usize, usize, usize) {
        let mut pre = 0;
        let mut disp = 0;
        let mut vis = 0;
        for s in self.states.values() {
            match s {
                Lifecycle::Preload => pre += 1,
                Lifecycle::Display => disp += 1,
                Lifecycle::Visible => vis += 1,
                Lifecycle::None => {}
            }
        }
        (pre, disp, vis)
    }

    /// 降级扫描（§12.6「退出可见 → 逐步降级」）：把可见区外的行从 Visible 降到 Display
    ///
    /// ★为什么需要它：滚出可见区的行若仍保持 Visible，会一直持有高质量资源（内存不收敛）。
    pub fn demote_outside_visible(&mut self, range: &VisibleRange) -> usize {
        let mut demoted = 0;
        for (&row, s) in self.states.iter_mut() {
            if *s == Lifecycle::Visible && !range.contains_visible(row) {
                *s = Lifecycle::Display;
                demoted += 1;
            }
        }
        demoted
    }
}

/// ★§9.3 长列表验收的**纯逻辑跑批**：模拟「4000 行、滚动到底再回滚到顶」的全过程，
/// 返回复用池与状态机的读数。
///
/// 关键读数（回答「滚动是否触发堆分配」与「内存是否收敛」）：
///   · `created`  —— 整个滚动过程**真正新建**的对象数（理想：≈ 可见区+预加载区行数，与滚动距离无关）
///   · `reused`   —— 复用次数
///   · `reuse_ratio` —— 稳态复用率
///   · `max_live` —— 状态机中同时存活的最大行数（内存上界的直接度量）
///   · `demoted`  —— 降级次数（滚出可见区被降级的行——不降级则高质量资源不释放）
pub fn run_recycle_bench(rows: usize, frames: usize) -> Result<String, String> {
    if rows == 0 || frames == 0 {
        return Err("rows 与 frames 必须 > 0".into());
    }
    let config = RecycleConfig::default();
    let mut window = ListWindow::new(config, rows);
    let mut pool: RecyclePool<usize> = RecyclePool::new(config.max_pool_entries);
    let mut sm = ListStateMachine::new();

    // 可见区固定 12 行（模拟一屏）
    const VISIBLE: usize = 12;
    let max_first = rows.saturating_sub(VISIBLE);

    let mut max_live = 0usize;
    let mut demoted_total = 0usize;
    let mut scrolled = 0usize;

    for f in 0..frames {
        // 轨迹：先滚到底，再**回滚到顶**（§9.3 的核心场景）
        let progress = f as f64 / frames.max(1) as f64;
        let first = if progress < 0.5 {
            ((progress * 2.0) * max_first as f64) as usize
        } else {
            ((1.0 - (progress - 0.5) * 2.0) * max_first as f64) as usize
        };
        let first = first.min(max_first);
        window.update_visible(first, (first + VISIBLE - 1).min(rows - 1));
        scrolled = first;

        // ★顺序很重要（本仓实测踩到）：必须**先降级、后释放**——
        //   若先 `on_release` 删除行，它们就没机会经历「Visible → Display」的降级，
        //   于是 `demoted` 恒为 0（首次跑批就是这个结果）。
        //   真实语义：行离开可见区时**先降级**（释放高质量资源），离开预加载区才**释放**。
        let r_before = window.range();
        demoted_total += sm.demote_outside_visible(&r_before);

        let (to_acquire, to_release) = window.diff(&sm.states);
        for row in to_acquire {
            // ★池化：先从池里复用一个「对象」，没有才新建
            let _obj = pool.acquire(|| row);
            sm.on_acquire(row);
        }
        for row in to_release {
            sm.on_release(row);
            // 归还占位对象（真实场景归还的是 layer / RenderNode 等）
            pool.release(row);
        }
        // 可见区内的行 → Visible
        let r = window.range();
        for row in r.first_visible..=r.last_visible {
            sm.on_visible(row);
        }
        max_live = max_live.max(sm.len());
    }

    let out = format!(
        "{{\"ok\":true,\"rows\":{},\"frames\":{},\"final_first_visible\":{},\"created\":{},\"reused\":{},\"discarded\":{},\"reuse_ratio\":{:.4},\"max_live_rows\":{},\"final_live_rows\":{},\"demoted_total\":{},\"pooled\":{}}}",
        rows,
        frames,
        scrolled,
        pool.created_count(),
        pool.reused_count(),
        pool.discarded_count(),
        pool.reuse_ratio(),
        max_live,
        sm.len(),
        demoted_total,
        pool.pooled_count()
    );
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pool_reuses_objects_without_creating() {
        let mut pool: RecyclePool<Vec<u8>> = RecyclePool::new(4);
        // 首轮：4 次全部新建
        let mut objs: Vec<Vec<u8>> = (0..4).map(|_| pool.acquire(|| Vec::with_capacity(8))).collect();
        assert_eq!(pool.created_count(), 4);
        assert_eq!(pool.reused_count(), 0);
        // 归还后再取：应全部复用（★这就是「滚动不触发堆分配」的机制）
        for o in objs.drain(..) {
            pool.release(o);
        }
        for _ in 0..4 {
            let _ = pool.acquire(|| Vec::with_capacity(8));
        }
        assert_eq!(pool.created_count(), 4, "★归还后不应再新建");
        assert_eq!(pool.reused_count(), 4);
        assert_eq!(pool.reuse_ratio(), 0.5);
    }

    #[test]
    fn pool_is_bounded() {
        let mut pool: RecyclePool<u32> = RecyclePool::new(2);
        for i in 0..5 {
            pool.release(i);
        }
        assert_eq!(pool.pooled_count(), 2, "池容量有界");
        assert_eq!(pool.discarded_count(), 3, "超出部分被丢弃（不成为泄漏源）");
    }

    #[test]
    fn preload_range_is_asymmetric_by_direction() {
        let cfg = RecycleConfig { leading_rows: 8, following_rows: 2, max_pool_entries: 64 };
        let mut w = ListWindow::new(cfg, 4000);

        // ★首次布局：必须是 Idle（对称），不能按「100 > 初值 0」误判为滚动
        //   （本仓实测暴露：初版漏了 initialized 标志 → 首次布局多留 8 行）
        w.update_visible(100, 110);
        let idle = w.range();
        assert_eq!(w.direction(), ScrollDirection::Idle, "★首次布局不是滚动");
        assert_eq!(idle.first_preload, 98);
        assert_eq!(idle.last_preload, 112);

        // 同一位置再更新一次：仍是 Idle（无位移）
        w.update_visible(100, 110);
        assert_eq!(w.direction(), ScrollDirection::Idle);

        // 向前：前进方向多留（leading=8）
        w.update_visible(120, 130);
        assert_eq!(w.direction(), ScrollDirection::Forward);
        let fwd = w.range();
        assert_eq!(fwd.first_preload, 118, "向下滚：离开方向（上方）只留 2 行");
        assert_eq!(fwd.last_preload, 138, "向下滚：前进方向（下方）留 8 行");

        // ★回滚：方向反转，预加载区跟着交换（刚滚过的行被重新纳入 → 无需重建）
        w.update_visible(100, 110);
        assert_eq!(w.direction(), ScrollDirection::Backward);
        let back = w.range();
        assert_eq!(back.first_preload, 92, "★回滚时前进方向是**上方** → 上方多留 8 行（前方 92）");
        assert_eq!(back.last_preload, 112);

        // ★核心断言：回滚后，之前滚过的行 [92, 98) 仍在预加载区 → 直接复用
        for row in 92..98 {
            assert!(
                row >= back.first_preload && row <= back.last_preload,
                "★回滚时行 {row} 应仍在预加载区（这正是「方向敏感」要保住的内存复用）"
            );
        }
    }

    #[test]
    fn range_clamps_to_item_count() {
        let w_cfg = RecycleConfig { leading_rows: 8, following_rows: 2, max_pool_entries: 64 };
        let mut w = ListWindow::new(w_cfg, 100);
        w.update_visible(0, 5);
        let r = w.range();
        assert_eq!(r.first_preload, 0, "首行不能为负");
        w.update_visible(95, 99);
        let r2 = w.range();
        assert_eq!(r2.last_preload, 99, "末行不能越界");
    }

    #[test]
    fn diff_reports_acquire_and_release() {
        let cfg = RecycleConfig { leading_rows: 4, following_rows: 1, max_pool_entries: 64 };
        let mut w = ListWindow::new(cfg, 1000);
        w.update_visible(100, 105);
        let mut states: HashMap<usize, Lifecycle> = HashMap::new();
        // 初始：全部需要 acquire
        let (acq, rel) = w.diff(&states);
        // 可见 [100,105] + Idle 对称（following=1，两侧各 1）→ 预加载区 [99,106] 共 8 行
        assert_eq!(acq, vec![99, 100, 101, 102, 103, 104, 105, 106], "静止时对称预加载（两侧各 1 行）");
        assert!(rel.is_empty());
        for r in &acq {
            states.insert(*r, Lifecycle::Preload);
        }
        // 向前滚 → 下方新增、上方释放
        w.update_visible(110, 115);
        let (acq2, rel2) = w.diff(&states);
        assert!(acq2.contains(&116) && acq2.contains(&119), "前进方向应新增");
        assert!(rel2.contains(&99), "离开方向应释放");
    }

    #[test]
    fn state_machine_transitions_and_demotes() {
        let mut sm = ListStateMachine::new();
        sm.on_acquire(1);
        assert_eq!(sm.states[&1], Lifecycle::Preload);
        sm.on_displayed(1);
        assert_eq!(sm.states[&1], Lifecycle::Display);
        sm.on_visible(1);
        assert_eq!(sm.states[&1], Lifecycle::Visible);

        // 降级：可见区外 → Display
        sm.on_acquire(2);
        sm.on_displayed(2);
        sm.on_visible(2);
        let range = VisibleRange { first_visible: 1, last_visible: 1, first_preload: 1, last_preload: 2 };
        let demoted = sm.demote_outside_visible(&range);
        assert_eq!(demoted, 1);
        assert_eq!(sm.states[&2], Lifecycle::Display, "★滚出可见区应降级（否则高质量资源不释放）");
        assert_eq!(sm.states[&1], Lifecycle::Visible);

        // 释放
        assert_eq!(sm.on_release(2), Some(Lifecycle::Display));
        assert_eq!(sm.len(), 1);
    }

    /// ★★§9.3 核心断言：4000 行、滚到底再回滚，**对象创建数与行数无关**（只与窗口大小相关）
    #[test]
    fn long_list_scroll_does_not_allocate_per_row() {
        let report = run_recycle_bench(4000, 400).expect("跑批应成功");
        let v: serde_json::Value = serde_json::from_str(&report).unwrap();
        let created = v["created"].as_u64().unwrap();
        let reused = v["reused"].as_u64().unwrap();
        let max_live = v["max_live_rows"].as_u64().unwrap();
        let final_live = v["final_live_rows"].as_u64().unwrap();

        // ★① 创建数与「行数」无关：4000 行滚 400 帧，创建的对象应远少于行数
        //   （理想 = 窗口峰值大小；真实场景窗口会略微增长，故留宽松上界）
        assert!(
            created < 200,
            "★滚动不应为每行新建对象：created={created}（4000 行、400 帧）"
        );
        assert!(reused > created, "复用次数应远大于新建次数（created={created} reused={reused}）");

        // ★② 内存有界：状态机同时存活行数不超过「窗口 + 余量」，不随滚动累积
        assert!(max_live < 100, "★存活行数应有界：max_live={max_live}");

        // ★③ 回滚到顶后收敛：末尾存活 ≈ 窗口大小（不残留滚到底时的行）
        assert!(final_live < 100, "★回滚到顶后应收敛：final_live={final_live}");

        // ★④ 降级确实发生（否则高质量资源不释放）
        assert!(v["demoted_total"].as_u64().unwrap() > 0, "应发生降级");
    }

    /// ★ 长列表规模 × 多帧的稳定性（更大规模不改变结论）
    #[test]
    fn long_list_scales_without_growth() {
        let small = run_recycle_bench(1000, 200).unwrap();
        let large = run_recycle_bench(8000, 200).unwrap();
        let s: serde_json::Value = serde_json::from_str(&small).unwrap();
        let l: serde_json::Value = serde_json::from_str(&large).unwrap();
        let sc = s["created"].as_u64().unwrap();
        let lc = l["created"].as_u64().unwrap();
        // 行数 8 倍 → 创建数不应显著增长（窗口大小决定上限，行数不决定）
        assert!(
            lc <= sc + 80,
            "★创建数应与行数无关：1000 行 {sc} vs 8000 行 {lc}"
        );
    }

    #[test]
    fn lifecycle_ordering_is_monotonic() {
        assert!(Lifecycle::None < Lifecycle::Preload);
        assert!(Lifecycle::Preload < Lifecycle::Display);
        assert!(Lifecycle::Display < Lifecycle::Visible);
        assert!(Lifecycle::Visible.holds_high_quality());
        assert!(!Lifecycle::Preload.holds_render_cache());
    }
}
