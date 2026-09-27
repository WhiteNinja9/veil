// Minimal, dependency-free reader for gzipped npm tarballs (ustar format).
// Only regular files are returned; paths are relative to the archive root.
import { gunzipSync } from 'node:zlib';

export function readTarGz(buffer) {
  const data = gunzipSync(buffer);
  const files = new Map();
  let offset = 0;
  while (offset + 512 <= data.length) {
    const header = data.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break;
    const name = cString(header.subarray(0, 100));
    const prefix = cString(header.subarray(345, 500));
    const size = parseInt(cString(header.subarray(124, 136)).trim() || '0', 8);
    const type = String.fromCharCode(header[156] || 48);
    const fullName = prefix ? `${prefix}/${name}` : name;
    offset += 512;
    if (type === '0' || type === '\0') {
      files.set(fullName, data.subarray(offset, offset + size));
    }
    offset += Math.ceil(size / 512) * 512;
  }
  return files;
}

function cString(bytes) {
  const end = bytes.indexOf(0);
  return Buffer.from(end === -1 ? bytes : bytes.subarray(0, end)).toString('utf8');
}
