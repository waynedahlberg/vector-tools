//! Image clean-up before tracing. Most of a trace's quality is decided here: fewer, cleaner
//! colour regions give fewer, smoother paths.

/// Makes alpha binary: below `threshold` becomes fully transparent, otherwise fully opaque.
pub fn binarize_alpha(rgba: &mut [u8], threshold: u8) {
    for px in rgba.chunks_exact_mut(4) {
        px[3] = if px[3] < threshold.max(1) { 0 } else { 255 };
    }
}

/// Median filter on the RGB channels of opaque pixels, `radius` 1–3. Transparent pixels are
/// neither changed nor sampled, so edges against transparency stay put.
pub fn median(rgba: &mut [u8], width: usize, height: usize, radius: usize) {
    if radius == 0 || width == 0 || height == 0 {
        return;
    }
    let src = rgba.to_vec();
    let r = radius as isize;
    let mut window: [Vec<u8>; 3] = Default::default();
    for w in window.iter_mut() {
        w.reserve((2 * radius + 1).pow(2));
    }
    for y in 0..height {
        for x in 0..width {
            let i = (y * width + x) * 4;
            if src[i + 3] == 0 {
                continue;
            }
            for w in window.iter_mut() {
                w.clear();
            }
            for dy in -r..=r {
                let yy = (y as isize + dy).clamp(0, height as isize - 1) as usize;
                for dx in -r..=r {
                    let xx = (x as isize + dx).clamp(0, width as isize - 1) as usize;
                    let j = (yy * width + xx) * 4;
                    if src[j + 3] == 0 {
                        continue;
                    }
                    for c in 0..3 {
                        window[c].push(src[j + c]);
                    }
                }
            }
            for c in 0..3 {
                let w = &mut window[c];
                let mid = w.len() / 2;
                rgba[i + c] = *w.select_nth_unstable(mid).1;
            }
        }
    }
}

// --- OKLab ---------------------------------------------------------------------------------------

#[derive(Clone, Copy, Debug, Default, PartialEq)]
struct Lab {
    l: f32,
    a: f32,
    b: f32,
}

impl Lab {
    fn dist2(self, o: Lab) -> f32 {
        let (dl, da, db) = (self.l - o.l, self.a - o.a, self.b - o.b);
        dl * dl + da * da + db * db
    }
}

fn to_linear(c: u8) -> f32 {
    let c = c as f32 / 255.0;
    if c <= 0.04045 {
        c / 12.92
    } else {
        ((c + 0.055) / 1.055).powf(2.4)
    }
}

fn to_srgb(c: f32) -> u8 {
    let c = c.clamp(0.0, 1.0);
    let v = if c <= 0.003_130_8 { c * 12.92 } else { 1.055 * c.powf(1.0 / 2.4) - 0.055 };
    (v * 255.0).round().clamp(0.0, 255.0) as u8
}

fn rgb_to_lab(lut: &[f32; 256], r: u8, g: u8, b: u8) -> Lab {
    let (r, g, b) = (lut[r as usize], lut[g as usize], lut[b as usize]);
    let l = (0.412_221_46 * r + 0.536_332_55 * g + 0.051_445_995 * b).cbrt();
    let m = (0.211_903_5 * r + 0.680_699_5 * g + 0.107_396_96 * b).cbrt();
    let s = (0.088_302_46 * r + 0.281_718_85 * g + 0.629_978_7 * b).cbrt();
    Lab {
        l: 0.210_454_26 * l + 0.793_617_8 * m - 0.004_072_047 * s,
        a: 1.977_998_5 * l - 2.428_592_2 * m + 0.450_593_7 * s,
        b: 0.025_904_037 * l + 0.782_771_77 * m - 0.808_675_77 * s,
    }
}

fn lab_to_rgb(c: Lab) -> [u8; 3] {
    let l = (c.l + 0.396_337_78 * c.a + 0.215_803_76 * c.b).powi(3);
    let m = (c.l - 0.105_561_346 * c.a - 0.063_854_17 * c.b).powi(3);
    let s = (c.l - 0.089_484_18 * c.a - 1.291_485_5 * c.b).powi(3);
    [
        to_srgb(4.076_741_7 * l - 3.307_711_6 * m + 0.230_969_94 * s),
        to_srgb(-1.268_438 * l + 2.609_757_4 * m - 0.341_319_38 * s),
        to_srgb(-0.004_196_086_3 * l - 0.703_418_6 * m + 1.707_614_7 * s),
    ]
}

/// Small deterministic PRNG, so the same image and settings always give the same palette.
struct XorShift(u64);

impl XorShift {
    fn next_f32(&mut self) -> f32 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        (self.0 >> 40) as f32 / (1u64 << 24) as f32
    }
}

const MAX_SAMPLES: usize = 65_536;
const ITERATIONS: usize = 16;

/// Marks anti-aliasing blends: pixels whose colour lies between two clearly different
/// neighbours on opposite sides (1 or 2 px away, along either axis or diagonal). They carry no
/// colour of their own, so the palette shouldn't spend a slot on them.
pub fn blend_mask(rgba: &[u8], width: usize, height: usize) -> Vec<bool> {
    let mut mask = vec![false; width * height];
    let at = |x: isize, y: isize| -> Option<[f32; 3]> {
        if x < 0 || y < 0 || x >= width as isize || y >= height as isize {
            return None;
        }
        let i = (y as usize * width + x as usize) * 4;
        (rgba[i + 3] != 0).then(|| [rgba[i] as f32, rgba[i + 1] as f32, rgba[i + 2] as f32])
    };
    const AXES: [(isize, isize); 4] = [(1, 0), (0, 1), (1, 1), (1, -1)];
    for y in 0..height as isize {
        for x in 0..width as isize {
            let Some(p) = at(x, y) else { continue };
            'axes: for (dx, dy) in AXES {
                for r in 1..=2 {
                    let (Some(a), Some(b)) = (at(x - dx * r, y - dy * r), at(x + dx * r, y + dy * r)) else { continue };
                    let ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
                    let len2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
                    if len2 < 48.0 * 48.0 {
                        continue;
                    }
                    let ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
                    let t = (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / len2;
                    if !(0.1..=0.9).contains(&t) {
                        continue;
                    }
                    let off2 = (0..3).map(|c| (ap[c] - ab[c] * t).powi(2)).sum::<f32>();
                    if off2 < (0.15f32 * 0.15 * len2).max(36.0) {
                        mask[y as usize * width + x as usize] = true;
                        break 'axes;
                    }
                }
            }
        }
    }
    mask
}

/// Reduces opaque pixels to at most `k` colours with k-means in OKLab (k-means++ seeding on a
/// sample), then maps every pixel to its nearest centre. Returns the palette, most used first.
/// Pixels flagged in `skip` (anti-aliasing blends) are left out of the sample but still mapped.
pub fn quantize(rgba: &mut [u8], k: usize, skip: Option<&[bool]>) -> Vec<[u8; 3]> {
    let mut lut = [0f32; 256];
    for (i, v) in lut.iter_mut().enumerate() {
        *v = to_linear(i as u8);
    }
    let opaque = rgba.chunks_exact(4).filter(|p| p[3] != 0).count();
    if opaque == 0 || k == 0 {
        return vec![];
    }
    // Sample solid pixels; fall back to all of them if nearly everything is an edge.
    let solid = |i: usize| skip.is_none_or(|m| !m[i]);
    let solid_count = rgba.chunks_exact(4).enumerate().filter(|(i, p)| p[3] != 0 && solid(*i)).count();
    let use_skip = solid_count * 4 >= opaque;
    let candidates = if use_skip { solid_count } else { opaque };
    let stride = candidates.div_ceil(MAX_SAMPLES).max(1);
    let samples: Vec<Lab> = rgba
        .chunks_exact(4)
        .enumerate()
        .filter(|(i, p)| p[3] != 0 && (!use_skip || solid(*i)))
        .step_by(stride)
        .map(|(_, p)| rgb_to_lab(&lut, p[0], p[1], p[2]))
        .collect();

    // k-means++ seeding.
    let mut rng = XorShift(0x9E37_79B9_7F4A_7C15);
    let mut centres = vec![samples[samples.len() / 2]];
    let mut d2: Vec<f32> = samples.iter().map(|s| s.dist2(centres[0])).collect();
    while centres.len() < k {
        let total: f32 = d2.iter().sum();
        if total <= f32::EPSILON {
            break; // fewer distinct colours than k
        }
        let mut target = rng.next_f32() * total;
        let mut pick = samples.len() - 1;
        for (i, d) in d2.iter().enumerate() {
            target -= d;
            if target <= 0.0 {
                pick = i;
                break;
            }
        }
        let c = samples[pick];
        centres.push(c);
        for (d, s) in d2.iter_mut().zip(&samples) {
            *d = d.min(s.dist2(c));
        }
    }

    let nearest = |c: Lab, centres: &[Lab]| -> usize {
        let mut best = 0;
        let mut best_d = f32::MAX;
        for (i, k) in centres.iter().enumerate() {
            let d = c.dist2(*k);
            if d < best_d {
                best_d = d;
                best = i;
            }
        }
        best
    };

    // Lloyd iterations on the sample.
    for _ in 0..ITERATIONS {
        let mut sums = vec![(0f32, 0f32, 0f32, 0u32); centres.len()];
        for s in &samples {
            let i = nearest(*s, &centres);
            let e = &mut sums[i];
            e.0 += s.l;
            e.1 += s.a;
            e.2 += s.b;
            e.3 += 1;
        }
        let mut moved = 0f32;
        for (c, (l, a, b, n)) in centres.iter_mut().zip(sums) {
            if n == 0 {
                continue;
            }
            let next = Lab { l: l / n as f32, a: a / n as f32, b: b / n as f32 };
            moved = moved.max(c.dist2(next));
            *c = next;
        }
        if moved < 1e-8 {
            break;
        }
    }

    // Label every pixel. A small cache avoids repeating the search for runs of the same colour.
    let mut labels = vec![u8::MAX; rgba.len() / 4];
    let mut counts = vec![0u32; centres.len()];
    let mut last: Option<([u8; 3], u8)> = None;
    for (px, label) in rgba.chunks_exact(4).zip(labels.iter_mut()) {
        if px[3] == 0 {
            continue;
        }
        let key = [px[0], px[1], px[2]];
        let i = match last {
            Some((k, i)) if k == key => i,
            _ => {
                let i = nearest(rgb_to_lab(&lut, px[0], px[1], px[2]), &centres) as u8;
                last = Some((key, i));
                i
            }
        };
        counts[i as usize] += 1;
        *label = i;
    }

    // Anti-aliased edges between two colours form a third, "blend" colour of thin slivers,
    // which traces as a double outline. Drop small colours that lie between two larger ones
    // and give their pixels to whichever of the remaining colours is nearest.
    let keep = blend_free(&centres, &counts, opaque as u32);
    if keep.iter().any(|k| !k) {
        let kept: Vec<usize> = (0..centres.len()).filter(|&i| keep[i]).collect();
        let kept_centres: Vec<Lab> = kept.iter().map(|&i| centres[i]).collect();
        for (px, label) in rgba.chunks_exact(4).zip(labels.iter_mut()) {
            if *label == u8::MAX || keep[*label as usize] {
                continue;
            }
            counts[*label as usize] -= 1;
            let j = kept[nearest(rgb_to_lab(&lut, px[0], px[1], px[2]), &kept_centres)];
            counts[j] += 1;
            *label = j as u8;
        }
    }

    let rgb: Vec<[u8; 3]> = centres.iter().map(|c| lab_to_rgb(*c)).collect();
    for (px, label) in rgba.chunks_exact_mut(4).zip(&labels) {
        if *label != u8::MAX {
            px[..3].copy_from_slice(&rgb[*label as usize]);
        }
    }

    let mut order: Vec<usize> = (0..rgb.len()).filter(|&i| counts[i] > 0).collect();
    order.sort_by(|a, b| counts[*b].cmp(&counts[*a]));
    order.into_iter().map(|i| rgb[i]).collect()
}

/// Colours covering less than this share of the image may be blends.
const BLEND_MAX_SHARE: f32 = 0.03;
/// Centres closer than this (OKLab) look the same; k-means makes them when asked for more
/// colours than the image has.
const SAME_COLOUR: f32 = 0.04;

/// Marks which centres to keep. Drops the smaller of two centres that look the same, and small
/// centres that are a mix of two larger ones (measured in sRGB, where anti-aliasing blends are
/// straight lines).
fn blend_free(centres: &[Lab], counts: &[u32], total: u32) -> Vec<bool> {
    let rgb: Vec<[f32; 3]> = centres.iter().map(|c| lab_to_rgb(*c).map(|v| v as f32)).collect();
    let mut keep = vec![true; centres.len()];
    let mut order: Vec<usize> = (0..centres.len()).collect();
    order.sort_by_key(|&i| counts[i]);
    for &c in &order {
        let alive = keep.iter().filter(|k| **k).count();
        let twin = (0..centres.len())
            .any(|i| i != c && keep[i] && counts[i] >= counts[c] && centres[i].dist2(centres[c]) < SAME_COLOUR * SAME_COLOUR);
        if twin && alive > 1 {
            keep[c] = false;
            continue;
        }
        if counts[c] as f32 > total as f32 * BLEND_MAX_SHARE {
            continue;
        }
        let p = rgb[c];
        let parents: Vec<usize> = (0..centres.len()).filter(|&i| i != c && keep[i] && counts[i] > counts[c]).collect();
        let is_blend = parents.iter().enumerate().any(|(k, &a)| {
            parents[k + 1..].iter().any(|&b| {
                let (ca, cb) = (rgb[a], rgb[b]);
                let ab = [cb[0] - ca[0], cb[1] - ca[1], cb[2] - ca[2]];
                let len2 = ab.iter().map(|v| v * v).sum::<f32>();
                if len2 < 32.0 * 32.0 {
                    return false;
                }
                let ap = [p[0] - ca[0], p[1] - ca[1], p[2] - ca[2]];
                let t = (0..3).map(|i| ap[i] * ab[i]).sum::<f32>() / len2;
                if !(0.05..=0.95).contains(&t) {
                    return false;
                }
                let off2 = (0..3).map(|i| (ap[i] - ab[i] * t).powi(2)).sum::<f32>();
                off2 < (0.1f32 * 0.1 * len2).max(64.0)
            })
        });
        if is_blend && keep.iter().filter(|k| **k).count() > 2 {
            keep[c] = false;
        }
    }
    keep
}

/// Rec. 709 luma, 0–255.
pub fn luma(r: u8, g: u8, b: u8) -> u8 {
    (0.2126 * r as f32 + 0.7152 * g as f32 + 0.0722 * b as f32).round() as u8
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn oklab_round_trips() {
        let mut lut = [0f32; 256];
        for (i, v) in lut.iter_mut().enumerate() {
            *v = to_linear(i as u8);
        }
        for c in [[0, 0, 0], [255, 255, 255], [200, 30, 90], [12, 180, 240]] {
            let back = lab_to_rgb(rgb_to_lab(&lut, c[0], c[1], c[2]));
            for i in 0..3 {
                assert!((back[i] as i32 - c[i] as i32).abs() <= 1, "{c:?} -> {back:?}");
            }
        }
    }

    #[test]
    fn quantize_limits_colours() {
        // A horizontal gradient reduced to 4 colours.
        let (w, h) = (64, 4);
        let mut img = vec![0u8; w * h * 4];
        for y in 0..h {
            for x in 0..w {
                let i = (y * w + x) * 4;
                img[i..i + 4].copy_from_slice(&[(x * 4) as u8, 0, 255 - (x * 4) as u8, 255]);
            }
        }
        let palette = quantize(&mut img, 4, None);
        assert_eq!(palette.len(), 4);
        let mut seen: Vec<[u8; 3]> = img.chunks_exact(4).map(|p| [p[0], p[1], p[2]]).collect();
        seen.sort();
        seen.dedup();
        assert_eq!(seen.len(), 4);
    }

    #[test]
    fn identical_looking_colours_are_merged() {
        let mut img = vec![0u8; 100 * 4];
        for (i, px) in img.chunks_exact_mut(4).enumerate() {
            let v = if i < 50 { [17, 24, 39] } else if i < 70 { [21, 28, 43] } else { [250, 250, 250] };
            px.copy_from_slice(&[v[0], v[1], v[2], 255]);
        }
        assert_eq!(quantize(&mut img, 3, None).len(), 2);
    }

    #[test]
    fn edge_blends_are_merged() {
        // Black and white halves with a one-pixel grey seam, as anti-aliasing leaves.
        let (w, h) = (100, 20);
        let mut img = vec![255u8; w * h * 4];
        for y in 0..h {
            for x in 0..w {
                let i = (y * w + x) * 4;
                let v = if x < 50 { 0 } else if x == 50 { 128 } else { 255 };
                img[i..i + 3].copy_from_slice(&[v, v, v]);
            }
        }
        let palette = quantize(&mut img, 3, None);
        assert_eq!(palette.len(), 2, "{palette:?}");
    }

    #[test]
    fn blend_mask_finds_antialiased_edges_only() {
        // Left half dark blue, right half cream, with a two-pixel blended seam.
        let (w, h) = (40, 6);
        let (a, b) = ([29u8, 78, 216], [248u8, 245, 238]);
        let mut img = vec![255u8; w * h * 4];
        for y in 0..h {
            for x in 0..w {
                let t = match x {
                    0..=19 => 0.0,
                    20 => 0.33,
                    21 => 0.66,
                    _ => 1.0,
                };
                let i = (y * w + x) * 4;
                for c in 0..3 {
                    img[i + c] = (a[c] as f32 + (b[c] as f32 - a[c] as f32) * t).round() as u8;
                }
            }
        }
        let mask = blend_mask(&img, w, h);
        for y in 0..h {
            for x in 0..w {
                assert_eq!(mask[y * w + x], x == 20 || x == 21, "({x}, {y})");
            }
        }
        let palette = quantize(&mut img, 4, Some(&mask));
        assert_eq!(palette.len(), 2, "{palette:?}");
    }

    #[test]
    fn median_removes_single_pixel_noise() {
        let (w, h) = (5, 5);
        let mut img = vec![255u8; w * h * 4];
        let c = (2 * w + 2) * 4;
        img[c..c + 3].copy_from_slice(&[0, 0, 0]);
        median(&mut img, w, h, 1);
        assert_eq!(&img[c..c + 3], &[255, 255, 255]);
    }
}
