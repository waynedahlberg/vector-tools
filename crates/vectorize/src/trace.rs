//! Clustering and curve fitting, following VTracer's converter (visioncortex/vtracer 0.6,
//! MIT/Apache-2.0) but returning typed geometry instead of SVG text.

use visioncortex::color_clusters::{KeyingAction, Runner, RunnerConfig, HIERARCHICAL_MAX};
use visioncortex::{BinaryImage, Color, ColorImage, CompoundPath, CompoundPathElement, PathSimplifyMode};

use crate::preprocess;
use crate::types::*;

struct Fit {
    mode: PathSimplifyMode,
    corner: f64,
    length: f64,
    splice: f64,
}

const MAX_ITERATIONS: usize = 10;

fn rad(deg: u32) -> f64 {
    deg as f64 / 180.0 * std::f64::consts::PI
}

pub fn validate(len: usize, width: u32, height: u32) -> Result<(), String> {
    if width == 0 || height == 0 {
        return Err("The image is empty.".into());
    }
    if width > MAX_SIDE || height > MAX_SIDE || (width as u64) * (height as u64) > MAX_PIXELS {
        return Err(format!(
            "The image is too large to trace ({width} × {height}). The limit is {MAX_SIDE} px per side and {} megapixels.",
            MAX_PIXELS / (1024 * 1024)
        ));
    }
    if len as u64 != (width as u64) * (height as u64) * 4 {
        return Err("The pixel data doesn't match the image size.".into());
    }
    Ok(())
}

pub fn trace(mut rgba: Vec<u8>, width: u32, height: u32, options: &TraceOptions) -> Result<TraceResult, String> {
    validate(rgba.len(), width, height)?;
    let o = options.sanitized();
    let (w, h) = (width as usize, height as usize);

    preprocess::binarize_alpha(&mut rgba, o.alpha_threshold as u8);
    preprocess::median(&mut rgba, w, h, o.denoise as usize);

    let fit = Fit {
        mode: match o.curve_fit {
            CurveFit::Spline => PathSimplifyMode::Spline,
            CurveFit::Polygon => PathSimplifyMode::Polygon,
            CurveFit::Pixel => PathSimplifyMode::None,
        },
        corner: rad(o.corner_threshold),
        length: o.segment_length,
        splice: rad(o.splice_threshold),
    };
    let speckle_area = (o.filter_speckle * o.filter_speckle) as usize;
    let mut points = 0usize;

    let (layers, palette) = match o.color_mode {
        ColorMode::Binary => (trace_binary(&rgba, w, h, &o, &fit, speckle_area, &mut points)?, vec![]),
        ColorMode::Color => {
            let palette = if o.palette_size > 0 {
                let edges = preprocess::blend_mask(&rgba, w, h);
                preprocess::quantize(&mut rgba, o.palette_size as usize, Some(&edges))
            } else {
                vec![]
            };
            let img = ColorImage { pixels: rgba, width: w, height: h };
            let mut layers = trace_color(img, &o, !palette.is_empty(), &fit, speckle_area, &mut points)?;
            // Clusters report the average of the pixels they absorbed, which drifts slightly
            // from the palette where specks were merged. Snap back so the palette is exact.
            for layer in &mut layers {
                if let Some(c) = nearest(&palette, layer.color) {
                    layer.color = c;
                }
            }
            (layers, palette)
        }
    };

    Ok(TraceResult { width, height, layers, palette, point_count: points as u32 })
}

fn trace_binary(
    rgba: &[u8],
    w: usize,
    h: usize,
    o: &TraceOptions,
    fit: &Fit,
    speckle_area: usize,
    points: &mut usize,
) -> Result<Vec<TraceLayer>, String> {
    let mut ink = BinaryImage::new_w_h(w, h);
    let mut sum = [0u64; 3];
    let mut n = 0u64;
    for (i, px) in rgba.chunks_exact(4).enumerate() {
        let dark = preprocess::luma(px[0], px[1], px[2]) < o.threshold as u8;
        if px[3] != 0 && dark != o.invert {
            ink.set_pixel_index(i, true);
            for c in 0..3 {
                sum[c] += px[c] as u64;
            }
            n += 1;
        }
    }
    if n == 0 {
        return Ok(vec![]);
    }
    // Ink takes the average colour of the pixels it covers, so dark-blue line art stays blue.
    let color = [(sum[0] / n) as u8, (sum[1] / n) as u8, (sum[2] / n) as u8];

    let clusters = ink.to_clusters(false);
    let mut subpaths = vec![];
    let mut area = 0u32;
    for i in 0..clusters.len() {
        let cluster = clusters.get_cluster(i);
        if cluster.size() < speckle_area.max(1) {
            continue;
        }
        area += cluster.size() as u32;
        let path = cluster.to_compound_path(fit.mode, fit.corner, fit.length, MAX_ITERATIONS, fit.splice);
        collect(&path, &mut subpaths, points)?;
    }
    Ok(if subpaths.is_empty() { vec![] } else { vec![TraceLayer { color, area, subpaths }] })
}

fn trace_color(
    mut img: ColorImage,
    o: &TraceOptions,
    quantized: bool,
    fit: &Fit,
    speckle_area: usize,
    points: &mut usize,
) -> Result<Vec<TraceLayer>, String> {
    let (w, h) = (img.width, img.height);

    // Transparent pixels are painted in a colour the image doesn't use, which the clustering
    // then drops. The all-zero default colour means "no keying".
    let key_color = if img.pixels.chunks_exact(4).any(|p| p[3] == 0) {
        let key = unused_color(&img.pixels).ok_or("Couldn't find a free colour to mask transparency with.")?;
        for px in img.pixels.chunks_exact_mut(4) {
            if px[3] == 0 {
                px.copy_from_slice(&[key.r, key.g, key.b, 255]);
            }
        }
        key
    } else {
        Color::default()
    };

    let cutout = o.layering == Layering::Cutout;
    let runner = Runner::new(
        RunnerConfig {
            diagonal: o.layer_difference == 0,
            hierarchical: HIERARCHICAL_MAX,
            batch_size: 25600,
            good_min_area: speckle_area,
            good_max_area: w * h,
            // A quantized image already has exact colours; don't blur them together again.
            is_same_color_a: if quantized { 0 } else { 8 - o.color_precision as i32 },
            is_same_color_b: 1,
            deepen_diff: o.layer_difference as i32,
            hollow_neighbours: 1,
            key_color,
            keying_action: if cutout { KeyingAction::Keep } else { KeyingAction::Discard },
        },
        img,
    );
    let mut clusters = runner.run();

    if cutout {
        // Re-cluster the flattened result so every region is disjoint.
        let image = clusters.view().to_color_image();
        let runner = Runner::new(
            RunnerConfig {
                diagonal: false,
                hierarchical: 64,
                batch_size: 25600,
                good_min_area: 0,
                good_max_area: image.width * image.height,
                is_same_color_a: 0,
                is_same_color_b: 1,
                deepen_diff: 0,
                hollow_neighbours: 0,
                key_color,
                keying_action: KeyingAction::Discard,
            },
            image,
        );
        clusters = runner.run();
    }

    let view = clusters.view();
    let mut layers = vec![];
    for &index in view.clusters_output.iter().rev() {
        let cluster = view.get_cluster(index);
        let path = cluster.to_compound_path(&view, false, fit.mode, fit.corner, fit.length, MAX_ITERATIONS, fit.splice);
        let mut subpaths = vec![];
        collect(&path, &mut subpaths, points)?;
        if subpaths.is_empty() {
            continue;
        }
        let c = cluster.residue_color();
        layers.push(TraceLayer { color: [c.r, c.g, c.b], area: cluster.area() as u32, subpaths });
    }
    Ok(layers)
}

fn nearest(palette: &[[u8; 3]], c: [u8; 3]) -> Option<[u8; 3]> {
    let d = |p: &[u8; 3]| (0..3).map(|i| (p[i] as i32 - c[i] as i32).pow(2)).sum::<i32>();
    palette.iter().min_by_key(|p| d(p)).copied()
}

/// A colour absent from the image, found with a 2 MB bitmap of all 24-bit colours.
fn unused_color(rgba: &[u8]) -> Option<Color> {
    let mut used = vec![0u64; (1 << 24) / 64];
    for p in rgba.chunks_exact(4) {
        if p[3] != 0 {
            let i = (p[0] as usize) << 16 | (p[1] as usize) << 8 | p[2] as usize;
            used[i / 64] |= 1 << (i % 64);
        }
    }
    let free = |i: usize| used[i / 64] & (1 << (i % 64)) == 0;
    // Saturated colours first (easy to spot if ever leaked), then anything free. Never black,
    // which visioncortex treats as "no key".
    [0xFF0000usize, 0x00FF00, 0x0000FF, 0xFFFF00, 0x00FFFF, 0xFF00FF]
        .into_iter()
        .chain(1..1 << 24)
        .find(|&i| free(i))
        .map(|i| Color::new((i >> 16) as u8, (i >> 8) as u8, i as u8))
}

fn round(v: f64) -> f64 {
    (v * 1000.0).round() / 1000.0
}

/// Converts visioncortex paths into subpaths, enforcing the output budget.
fn collect(path: &CompoundPath, out: &mut Vec<Subpath>, points: &mut usize) -> Result<(), String> {
    for element in path.iter() {
        let (kind, mut pts): (SubpathKind, Vec<(f64, f64)>) = match element {
            CompoundPathElement::PathI32(p) => (SubpathKind::Polygon, p.path.iter().map(|q| (q.x as f64, q.y as f64)).collect()),
            CompoundPathElement::PathF64(p) => (SubpathKind::Polygon, p.path.iter().map(|q| (q.x, q.y)).collect()),
            CompoundPathElement::Spline(s) => (SubpathKind::Cubic, s.points.iter().map(|q| (q.x, q.y)).collect()),
        };
        match kind {
            SubpathKind::Polygon => {
                // Closed polygons repeat their first point at the end.
                if pts.len() > 1 && pts.first() == pts.last() {
                    pts.pop();
                }
                if pts.len() < 3 {
                    continue;
                }
            }
            SubpathKind::Cubic => {
                if pts.len() < 4 || (pts.len() - 1) % 3 != 0 {
                    continue;
                }
            }
        }
        *points += pts.len();
        if *points > MAX_POINTS {
            return Err(
                "The trace is too detailed (over 1.5 million points). Try fewer colours, more speckle filtering or a lower resolution."
                    .into(),
            );
        }
        out.push(Subpath { kind, points: pts.into_iter().flat_map(|(x, y)| [round(x), round(y)]).collect() });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A white image with a black square and a red disc.
    fn sample(w: usize, h: usize) -> Vec<u8> {
        let mut img = vec![255u8; w * h * 4];
        for y in 0..h {
            for x in 0..w {
                let i = (y * w + x) * 4;
                if (10..30).contains(&x) && (10..30).contains(&y) {
                    img[i..i + 3].copy_from_slice(&[0, 0, 0]);
                }
                let (dx, dy) = (x as f64 - 48.0, y as f64 - 40.0);
                if dx * dx + dy * dy < 100.0 {
                    img[i..i + 3].copy_from_slice(&[220, 20, 20]);
                }
            }
        }
        img
    }

    #[test]
    fn rejects_bad_sizes() {
        assert!(trace(vec![0; 16], 0, 4, &TraceOptions::default()).is_err());
        assert!(trace(vec![0; 15], 2, 2, &TraceOptions::default()).is_err());
        assert!(validate(0, MAX_SIDE + 1, 1).is_err());
    }

    #[test]
    fn traces_colour_regions() {
        let r = trace(sample(64, 64), 64, 64, &TraceOptions::default()).unwrap();
        assert!(r.layers.len() >= 3, "background, square, disc: {:?}", r.layers.len());
        assert!(r.layers.iter().any(|l| l.color[0] > 180 && l.color[1] < 60));
        assert!(r.point_count > 0);
        for l in &r.layers {
            for s in &l.subpaths {
                assert_eq!(s.points.len() % 2, 0);
                if s.kind == SubpathKind::Cubic {
                    assert_eq!((s.points.len() / 2 - 1) % 3, 0);
                }
            }
        }
    }

    #[test]
    fn layer_colours_come_from_the_palette() {
        let o = TraceOptions { palette_size: 3, ..Default::default() };
        let r = trace(sample(64, 64), 64, 64, &o).unwrap();
        assert!(!r.palette.is_empty());
        assert!(r.layers.iter().all(|l| r.palette.contains(&l.color)));
    }

    #[test]
    fn binary_mode_traces_ink_only() {
        let o = TraceOptions { color_mode: ColorMode::Binary, ..Default::default() };
        let r = trace(sample(64, 64), 64, 64, &o).unwrap();
        // The black square and the dark red disc are both ink; the white background isn't.
        assert_eq!(r.layers.len(), 1);
        assert!(r.layers[0].area < 64 * 64 / 2);
        let inverted = trace(sample(64, 64), 64, 64, &TraceOptions { invert: true, ..o }).unwrap();
        assert!(inverted.layers[0].color.iter().all(|&c| c > 200), "inverted traces the white");
    }

    #[test]
    fn transparent_pixels_are_not_traced() {
        let mut img = sample(64, 64);
        for px in img.chunks_exact_mut(4) {
            if px[0] == 255 && px[1] == 255 {
                px[3] = 0;
            }
        }
        let r = trace(img, 64, 64, &TraceOptions::default()).unwrap();
        assert!(r.layers.iter().all(|l| l.color != [255, 255, 255]));
        assert_eq!(r.layers.len(), 2);
    }

    #[test]
    fn polygon_and_pixel_modes() {
        for fit in [CurveFit::Polygon, CurveFit::Pixel] {
            let o = TraceOptions { curve_fit: fit, ..Default::default() };
            let r = trace(sample(64, 64), 64, 64, &o).unwrap();
            assert!(r.layers.iter().flat_map(|l| &l.subpaths).all(|s| s.kind == SubpathKind::Polygon));
        }
    }
}
