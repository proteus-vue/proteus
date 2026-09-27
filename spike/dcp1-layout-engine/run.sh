#!/usr/bin/env bash
# DCP-1 spike 复跑入口（★CARGO_TARGET_DIR 指向 data1——避免写入内置盘）
set -euo pipefail
cd "$(dirname "$0")"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$(cd .. && pwd)/target}"
echo "═══ DCP-1 spike：Taffy（Rust）═══"
cargo run --release --quiet --bin dcp1
echo
echo "═══ depth sweep（measure 是否随深度退化）═══"
cargo run --release --quiet --bin sweep
echo
echo "═══ 规避方案验证（为何不能靠工程手段绕过）═══"
cargo run --release --quiet --bin mitigations
