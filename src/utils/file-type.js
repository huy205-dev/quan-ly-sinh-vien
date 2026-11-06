'use strict';

/**
 * Content sniffing helpers: image magic bytes and a ZIP (xlsx) central-directory check.
 */

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Detects PNG / JPEG / WebP from the first bytes (the client's mimetype is ignored).
 * Returns { ext, mime } or null.
 */
function detectImageType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;

  // PNG: 8-byte signature followed by the IHDR chunk.
  if (buffer.subarray(0, 8).equals(PNG_SIGNATURE) && buffer.length >= 16 && buffer.toString('latin1', 12, 16) === 'IHDR') {
    return { ext: 'png', mime: 'image/png' };
  }

  // JPEG: SOI marker FF D8 followed by another marker (FF xx).
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff && buffer[3] >= 0xc0 && buffer[3] !== 0xff) {
    return { ext: 'jpg', mime: 'image/jpeg' };
  }

  // WebP: "RIFF" <size> "WEBP" then a VP8 / VP8L / VP8X chunk.
  if (
    buffer.toString('latin1', 0, 4) === 'RIFF' &&
    buffer.toString('latin1', 8, 12) === 'WEBP' &&
    buffer.length >= 16 &&
    ['VP8 ', 'VP8L', 'VP8X'].includes(buffer.toString('latin1', 12, 16))
  ) {
    return { ext: 'webp', mime: 'image/webp' };
  }

  return null;
}

const LOCAL_FILE_HEADER = 0x04034b50;
const CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;

/**
 * Reads the ZIP central directory without decompressing anything.
 * Returns { ok: true, entries, totalUncompressed } or { ok: false, reason }.
 * Used to refuse non-zip files and zip bombs before handing an .xlsx to ExcelJS.
 */
function inspectZip(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22 || buffer.readUInt32LE(0) !== LOCAL_FILE_HEADER) {
    return { ok: false, reason: 'not-zip' };
  }
  const minOffset = Math.max(0, buffer.length - (0xffff + 22));
  let eocd = -1;
  for (let i = buffer.length - 22; i >= minOffset; i -= 1) {
    if (buffer.readUInt32LE(i) === END_OF_CENTRAL_DIRECTORY) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return { ok: false, reason: 'no-central-directory' };

  const entries = buffer.readUInt16LE(eocd + 10);
  const directorySize = buffer.readUInt32LE(eocd + 12);
  const directoryOffset = buffer.readUInt32LE(eocd + 16);
  if (entries === 0xffff || directoryOffset === 0xffffffff) return { ok: false, reason: 'zip64' };
  if (directoryOffset + directorySize > eocd) return { ok: false, reason: 'bad-central-directory' };

  let offset = directoryOffset;
  let totalUncompressed = 0;
  for (let n = 0; n < entries; n += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== CENTRAL_DIRECTORY_HEADER) {
      return { ok: false, reason: 'bad-entry' };
    }
    const uncompressed = buffer.readUInt32LE(offset + 24);
    if (uncompressed === 0xffffffff) return { ok: false, reason: 'zip64' };
    totalUncompressed += uncompressed;
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return { ok: true, entries, totalUncompressed };
}

module.exports = { detectImageType, inspectZip };
