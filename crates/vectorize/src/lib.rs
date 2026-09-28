//! Raster-to-vector tracing compiled to WebAssembly. Runs inside a dedicated Web Worker; the
//! browser decodes the image and passes raw RGBA, so no image decoder runs in this module.

mod preprocess;
mod trace;
mod types;

pub use types::*;
use tsify::{Ts, Tsify};
use wasm_bindgen::prelude::*;

/// Traces `pixels` (RGBA, row-major, `width * height * 4` bytes) into coloured layers.
///
/// `Ts<T>` passes plain JS objects through serde, avoiding the leak in tsify's deprecated
/// `into_wasm_abi` path.
#[wasm_bindgen]
pub fn trace(pixels: Vec<u8>, width: u32, height: u32, options: Ts<TraceOptions>) -> Result<Ts<TraceResult>, JsError> {
    let options = options.to_rust()?;
    let result = trace::trace(pixels, width, height, &options).map_err(|e| JsError::new(&e))?;
    Ok(result.into_ts()?)
}

#[wasm_bindgen(js_name = defaultOptions)]
pub fn default_options() -> Result<Ts<TraceOptions>, JsError> {
    Ok(TraceOptions::default().into_ts()?)
}

/// Clamps every option to its valid range.
#[wasm_bindgen(js_name = sanitizeOptions)]
pub fn sanitize_options(options: Ts<TraceOptions>) -> Result<Ts<TraceOptions>, JsError> {
    Ok(options.to_rust()?.sanitized().into_ts()?)
}

#[wasm_bindgen(js_name = maxSide)]
pub fn max_side() -> u32 {
    MAX_SIDE
}

#[wasm_bindgen(js_name = maxPixels)]
pub fn max_pixels() -> f64 {
    MAX_PIXELS as f64
}
