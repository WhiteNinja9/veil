/**
 * Tiny dependency-free PNG encoder for lab fixtures.
 *
 * Fixture images carry a colour "marker" in their top-left corner that the
 * deterministic test model maps to a verdict (see src/ml/providers/
 * test-providers.ts). No explicit media is needed — or included — to test
 * the full protection pipeline.
 */
import { deflateSync } from 'node:zlib';

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

export const MARKERS = {
  neutral: null,
  explicit: [255, 0, 255],
  illustrated: [0, 255, 255],
  suggestive: [255, 140, 0],
  borderline: [255, 255, 0],
  face: [0, 200, 0],
  // Faces whose apparent gender the test model reads from the face area
  // itself (painted in the same colour), exercising the real cropping path.
  woman: [0, 200, 120],
  man: [0, 110, 200],
};

/** Face area used by the test face detector (normalised x, y, w, h). */
const FACE_AREA = [0.35, 0.3, 0.3, 0.35];
const PAINTED_FACES = new Set(['woman', 'man']);

/** RGBA pixels for a fixture (shared by the PNG and JPEG encoders). */
export function fixturePixels(width, height, marker = 'neutral', seed = 0) {
  const png = fixtureRaw(width, height, marker, seed);
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const src = y * (width * 3 + 1) + 1 + x * 3;
      const dst = (y * width + x) * 4;
      rgba[dst] = png[src];
      rgba[dst + 1] = png[src + 1];
      rgba[dst + 2] = png[src + 2];
      rgba[dst + 3] = 255;
    }
  }
  return rgba;
}

/** Renders a width×height RGB image: soft neutral gradient, marker block top-left, optional hue seed. */
export function fixturePng(width, height, marker = 'neutral', seed = 0) {
  const raw = fixtureRaw(width, height, marker, seed);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function fixtureRaw(width, height, marker, seed) {
  const color = MARKERS[marker] ?? null;
  const markerSize = Math.max(16, Math.round(Math.min(width, height) / 4));
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x++) {
      const i = row + 1 + x * 3;
      const inFace =
        PAINTED_FACES.has(marker) &&
        x >= FACE_AREA[0] * width &&
        x < (FACE_AREA[0] + FACE_AREA[2]) * width &&
        y >= FACE_AREA[1] * height &&
        y < (FACE_AREA[1] + FACE_AREA[3]) * height;
      if (color && ((x < markerSize && y < markerSize) || inFace)) {
        raw[i] = color[0];
        raw[i + 1] = color[1];
        raw[i + 2] = color[2];
      } else {
        // Muted, low-saturation gradient: reads as a neutral "photo".
        const t = (x / width + y / height) / 2;
        raw[i] = 90 + Math.round(70 * t) + ((seed * 13) % 30);
        raw[i + 1] = 100 + Math.round(60 * (1 - t)) + ((seed * 7) % 20);
        raw[i + 2] = 110 + Math.round(50 * t);
      }
    }
  }
  return raw;
}
