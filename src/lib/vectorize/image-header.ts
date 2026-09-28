// Reads an image's pixel size from its header, without decoding it. The tracer checks this
// before handing a file to the browser's decoder, so a small file that expands to a huge
// bitmap (a "decompression bomb") is refused before any pixel memory is allocated.

export type ImageFormat = "png" | "jpeg" | "gif" | "webp" | "bmp" | "avif";
export type ImageHeader = { format: ImageFormat; width: number; height: number };

/** Bytes to read from the start of a file. Enough for every format below in practice. */
export const HEADER_BYTES = 256 * 1024;

const ascii = (b: Uint8Array, at: number, s: string) =>
  at + s.length <= b.length && [...s].every((ch, i) => b[at + i] === ch.charCodeAt(0));

/**
 * Checks a file's header against the decode limits. Returns an error message, or null if the
 * file may be decoded. Used before accepting a file and again in the worker before decoding.
 */
export async function checkImageFile(
  file: Blob,
  limits: { maxPixels: number; maxSide: number }
): Promise<{ header: ImageHeader; error: null } | { header: null; error: string }> {
  const header = readImageHeader(new Uint8Array(await file.slice(0, HEADER_BYTES).arrayBuffer()));
  if (!header) return { header: null, error: "That isn't a supported image. Use PNG, JPEG, WebP, GIF, BMP or AVIF." };
  const { width, height } = header;
  if (!width || !height) return { header: null, error: "The image has no pixels." };
  if (width > limits.maxSide || height > limits.maxSide || width * height > limits.maxPixels) {
    return {
      header: null,
      error: `The image is too large (${width} × ${height}). The limit is ${limits.maxPixels / 1e6} megapixels.`,
    };
  }
  return { header, error: null };
}

export function readImageHeader(bytes: Uint8Array): ImageHeader | null {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const has = (n: number) => bytes.length >= n;

  // PNG: signature, then the IHDR chunk.
  if (has(24) && bytes[0] === 0x89 && ascii(bytes, 1, "PNG") && ascii(bytes, 12, "IHDR")) {
    return { format: "png", width: v.getUint32(16), height: v.getUint32(20) };
  }
  if (has(10) && ascii(bytes, 0, "GIF8")) {
    return { format: "gif", width: v.getUint16(6, true), height: v.getUint16(8, true) };
  }
  if (has(26) && ascii(bytes, 0, "BM")) {
    return { format: "bmp", width: Math.abs(v.getInt32(18, true)), height: Math.abs(v.getInt32(22, true)) };
  }
  if (has(16) && ascii(bytes, 0, "RIFF") && ascii(bytes, 8, "WEBP")) {
    if (has(30) && ascii(bytes, 12, "VP8 ")) {
      return { format: "webp", width: v.getUint16(26, true) & 0x3fff, height: v.getUint16(28, true) & 0x3fff };
    }
    if (has(25) && ascii(bytes, 12, "VP8L")) {
      const [b0, b1, b2, b3] = [bytes[21], bytes[22], bytes[23], bytes[24]];
      return {
        format: "webp",
        width: 1 + (((b1 & 0x3f) << 8) | b0),
        height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)),
      };
    }
    if (has(30) && ascii(bytes, 12, "VP8X")) {
      const u24 = (at: number) => bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16);
      return { format: "webp", width: 1 + u24(24), height: 1 + u24(27) };
    }
    return null;
  }
  if (has(4) && bytes[0] === 0xff && bytes[1] === 0xd8) return readJpeg(bytes, v);
  // AVIF (ISO-BMFF): the largest image-spatial-extents ("ispe") box.
  if (has(12) && ascii(bytes, 4, "ftyp") && (ascii(bytes, 8, "avif") || ascii(bytes, 8, "avis"))) {
    let best: ImageHeader | null = null;
    for (let i = 8; i + 16 <= bytes.length; i++) {
      if (!ascii(bytes, i, "ispe")) continue;
      const width = v.getUint32(i + 8);
      const height = v.getUint32(i + 12);
      if (!best || width * height > best.width * best.height) best = { format: "avif", width, height };
    }
    return best;
  }
  return null;
}

function readJpeg(bytes: Uint8Array, v: DataView): ImageHeader | null {
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1];
    if (marker === 0xff) {
      i++; // fill byte
      continue;
    }
    // Start-of-frame markers carry the size; C4 (DHT), C8 (JPG) and CC (DAC) share the range.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { format: "jpeg", height: v.getUint16(i + 5), width: v.getUint16(i + 7) };
    }
    if (marker === 0xd9 || marker === 0xda) return null; // end of image / start of scan
    i += 2 + v.getUint16(i + 2);
  }
  return null;
}
