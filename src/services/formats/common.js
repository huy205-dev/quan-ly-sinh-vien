'use strict';

const { fileError } = require('../../utils/http-error');

const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

/** Buffer → string. Accepts UTF-8 (with or without BOM) and UTF-16 LE/BE with BOM. */
function decodeText(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    buffer = buffer.subarray(3);
  } else if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.subarray(2).toString('utf16le');
  } else if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    const swapped = Buffer.from(buffer.subarray(2));
    swapped.swap16();
    return swapped.toString('utf16le');
  }
  try {
    return utf8Decoder.decode(buffer);
  } catch {
    throw fileError('File phải được mã hóa UTF-8.');
  }
}

function tooManyRowsError(maxRows) {
  return fileError(`File có nhiều hơn ${maxRows} dòng dữ liệu. Mỗi lần chỉ được nhập tối đa ${maxRows} dòng.`);
}

/**
 * Picks import fields from a parsed JSON/XML record (keys matched case-insensitively).
 * Non-scalar values become row errors. Returns { raw, errors }.
 */
function pickFields(item, { fieldLookup, importFields }) {
  const raw = {};
  const errors = [];
  for (const [key, value] of Object.entries(item)) {
    const field = fieldLookup.get(key.trim().toLowerCase());
    if (!field || !importFields.includes(field)) continue;
    if (value !== null && typeof value === 'object') {
      errors.push({ field, message: 'Giá trị không hợp lệ (phải là chữ hoặc số, không phải đối tượng/mảng).' });
      continue;
    }
    raw[field] = value;
  }
  return { raw, errors };
}

module.exports = { decodeText, tooManyRowsError, pickFields };
