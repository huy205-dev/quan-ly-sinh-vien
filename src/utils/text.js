'use strict';

const COMBINING_MARKS = /[̀-ͯ]/g;
// C0 control characters except TAB, LF, CR, plus DEL. They break XML exports and are never meaningful input.
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/**
 * Vietnamese search normalization: NFD, strip diacritics, lowercase, đ → d,
 * collapse whitespace, trim. "Nguyễn  Văn Đạt" → "nguyen van dat".
 */
function normalizeText(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(/đ/g, 'd')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Escapes LIKE wildcards for use with `ESCAPE '\'`. */
function escapeLike(value) {
  return String(value).replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * Cleans user text: NFC, removes control characters, trims.
 * Single-line values also collapse inner whitespace (tabs/newlines → one space).
 */
function cleanText(value, { multiline = false } = {}) {
  let text = String(value).normalize('NFC').replace(CONTROL_CHARS, '');
  if (multiline) {
    text = text.replace(/\r\n?/g, '\n');
  } else {
    text = text.replace(/\s+/g, ' ');
  }
  return text.trim();
}

/** Length in Unicode code points (not UTF-16 units). */
function charLength(text) {
  return [...text].length;
}

function truncateChars(text, max) {
  const chars = [...text];
  return chars.length <= max ? text : chars.slice(0, max).join('');
}

function formatStudentCode(id) {
  return `SV${String(id).padStart(6, '0')}`;
}

const SEARCH_FIELDS = ['FullName', 'ClassName', 'Major', 'Email', 'Phone', 'Address', 'Description'];

/** Normalized FullName + ClassName + Major + Email + Phone + Address + Description. */
function buildStudentSearchText(student) {
  return normalizeText(
    SEARCH_FIELDS.map((field) => student[field])
      .filter((v) => v !== null && v !== undefined && v !== '')
      .join(' '),
  );
}

module.exports = {
  normalizeText,
  escapeLike,
  cleanText,
  charLength,
  truncateChars,
  formatStudentCode,
  buildStudentSearchText,
  SEARCH_FIELDS,
};
