//! The typed boundary between JavaScript and the tracer. `tsify` generates the matching
//! TypeScript declarations into the wasm-pack output, so the options and result shapes have a
//! single source of truth. Every numeric option is clamped by `TraceOptions::sanitized`, so a
//! bad value from the UI can never reach the tracer.

use serde::{Deserialize, Serialize};
use tsify::Tsify;

/// Largest side accepted, in pixels.
pub const MAX_SIDE: u32 = 8192;
/// Largest image accepted, in pixels (16 MP).
pub const MAX_PIXELS: u64 = 16 * 1024 * 1024;
/// Most points returned across all layers before the trace is refused as too detailed.
pub const MAX_POINTS: usize = 1_500_000;

#[derive(Tsify, Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ColorMode {
    /// Full colour, clustered hierarchically.
    Color,
    /// One ink colour, split from the background by a luminance threshold.
    Binary,
}

#[derive(Tsify, Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum Layering {
    /// Shapes don't overlap: each colour region has the regions above it cut out. Best for CAD.
    Cutout,
    /// Shapes sit on top of one another, like paper cut-outs. Fewer, simpler paths.
    Stacked,
}

#[derive(Tsify, Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum CurveFit {
    /// Smooth cubic Béziers.
    Spline,
    /// Straight segments.
    Polygon,
    /// Pixel-exact staircase outlines.
    Pixel,
}

#[derive(Tsify, Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TraceOptions {
    pub color_mode: ColorMode,
    /// Reduce the image to this many colours (k-means in OKLab) before tracing. 0 = don't.
    pub palette_size: u32,
    /// 1–8 significant bits per channel when clustering; lower merges more similar colours.
    pub color_precision: u32,
    /// 0–255 colour difference between hierarchical layers ("gradient step").
    pub layer_difference: u32,
    /// Binary mode: luminance 0–255 below which a pixel counts as ink.
    pub threshold: u32,
    /// Binary mode: trace the light areas instead of the dark ones.
    pub invert: bool,
    /// Pixels with alpha below this (0–255) are transparent and never traced.
    pub alpha_threshold: u32,
    /// Median filter radius in pixels, 0–3. Removes JPEG noise and anti-aliasing fringes.
    pub denoise: u32,
    /// Discard patches smaller than this many pixels across (0–128).
    pub filter_speckle: u32,
    pub layering: Layering,
    pub curve_fit: CurveFit,
    /// Degrees, 0–180. Turns sharper than this stay corners.
    pub corner_threshold: u32,
    /// Pixels, 3.5–10. Shorter segments are merged while fitting.
    pub segment_length: f64,
    /// Degrees, 0–180. Minimum angle change at which a spline is split.
    pub splice_threshold: u32,
}

impl Default for TraceOptions {
    fn default() -> Self {
        Self {
            color_mode: ColorMode::Color,
            palette_size: 8,
            color_precision: 6,
            layer_difference: 16,
            threshold: 128,
            invert: false,
            alpha_threshold: 128,
            denoise: 1,
            filter_speckle: 4,
            layering: Layering::Cutout,
            curve_fit: CurveFit::Spline,
            corner_threshold: 60,
            segment_length: 4.0,
            splice_threshold: 45,
        }
    }
}

impl TraceOptions {
    pub fn sanitized(&self) -> Self {
        let finite = |v: f64, lo: f64, hi: f64, fallback: f64| if v.is_finite() { v.clamp(lo, hi) } else { fallback };
        Self {
            color_mode: self.color_mode,
            palette_size: if self.palette_size == 0 { 0 } else { self.palette_size.clamp(2, 64) },
            color_precision: self.color_precision.clamp(1, 8),
            layer_difference: self.layer_difference.min(255),
            threshold: self.threshold.min(255),
            invert: self.invert,
            alpha_threshold: self.alpha_threshold.min(255),
            denoise: self.denoise.min(3),
            filter_speckle: self.filter_speckle.min(128),
            layering: self.layering,
            curve_fit: self.curve_fit,
            corner_threshold: self.corner_threshold.min(180),
            segment_length: finite(self.segment_length, 3.5, 10.0, 4.0),
            splice_threshold: self.splice_threshold.min(180),
        }
    }
}

#[derive(Tsify, Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum SubpathKind {
    /// `points` holds 1 + 3n points: a start point, then (control 1, control 2, end) per curve.
    Cubic,
    /// `points` holds the polygon's vertices; the closing edge back to the first is implied.
    Polygon,
}

/// One closed loop. Points are flat `[x0, y0, x1, y1, …]` in image pixels, Y down.
#[derive(Tsify, Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Subpath {
    pub kind: SubpathKind,
    pub points: Vec<f64>,
}

/// Everything traced for one colour cluster. Holes are separate subpaths; fill with even-odd.
#[derive(Tsify, Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct TraceLayer {
    /// sRGB, 0–255.
    pub color: [u8; 3],
    /// Pixel area of the cluster.
    pub area: u32,
    pub subpaths: Vec<Subpath>,
}

#[derive(Tsify, Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TraceResult {
    pub width: u32,
    pub height: u32,
    /// Bottom to top, in paint order.
    pub layers: Vec<TraceLayer>,
    /// The colours the image was reduced to, if a palette was used.
    pub palette: Vec<[u8; 3]>,
    pub point_count: u32,
}
