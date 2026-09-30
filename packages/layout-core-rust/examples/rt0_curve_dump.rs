// 交叉验证：Rust 曲线求值 ⇄ TS 曲线求值必须同式（同 u 得同值）
use proteus_layout_core::anim::{curve_eval, CURVE_EASE_OUT_CUBIC, CURVE_EASE_IN_CUBIC, CURVE_EASE_IN_OUT_CUBIC, CURVE_LINEAR, CURVE_SPRING_APPROX};

fn main() {
    let us: Vec<f32> = (0..=10).map(|i| i as f32 / 10.0).collect();
    println!("linear: {:?}", us.iter().map(|u| (curve_eval(CURVE_LINEAR, *u) * 1e6).round() / 1e6).collect::<Vec<_>>());
    println!("easeOut: {:?}", us.iter().map(|u| (curve_eval(CURVE_EASE_OUT_CUBIC, *u) * 1e6).round() / 1e6).collect::<Vec<_>>());
    println!("easeIn: {:?}", us.iter().map(|u| (curve_eval(CURVE_EASE_IN_CUBIC, *u) * 1e6).round() / 1e6).collect::<Vec<_>>());
    println!("easeInOut: {:?}", us.iter().map(|u| (curve_eval(CURVE_EASE_IN_OUT_CUBIC, *u) * 1e6).round() / 1e6).collect::<Vec<_>>());
    println!("spring: {:?}", us.iter().map(|u| (curve_eval(CURVE_SPRING_APPROX, *u) * 1e6).round() / 1e6).collect::<Vec<_>>());
}
