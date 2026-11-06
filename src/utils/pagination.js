'use strict';

const { firstValue } = require('./validators');
const { normalizeText } = require('./text');

function parsePositiveInt(value) {
  const n = Number.parseInt(String(firstValue(value) ?? ''), 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Requested page number (invalid → 1). */
function parsePageNumber(value) {
  return parsePositiveInt(value) ?? 1;
}

/** Page size restricted to an allow-list (anything else → first allowed size). */
function parsePageSizeFromList(value, allowed) {
  const size = parsePositiveInt(value);
  return allowed.includes(size) ? size : allowed[0];
}

/** Page size within [min, max] (invalid → fallback, too large → max). */
function parsePageSizeInRange(value, { min = 1, max = 100, fallback = 10 } = {}) {
  const size = parsePositiveInt(value);
  if (size === null || size < min) return fallback;
  return Math.min(size, max);
}

/**
 * Clamps the requested page into [1, totalPages] (totalPages ≥ 1) and computes the offset.
 */
function resolvePage({ page, pageSize, total }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const effectivePage = Math.min(Math.max(1, page), totalPages);
  return { page: effectivePage, pageSize, total, totalPages, offset: (effectivePage - 1) * pageSize };
}

/** Normalized (diacritic-insensitive) search text, capped in length. */
function parseSearchQuery(value, maxLength = 200) {
  const raw = firstValue(value);
  if (raw === undefined || raw === null) return '';
  return normalizeText(String(raw).slice(0, maxLength));
}

module.exports = {
  parsePageNumber,
  parsePageSizeFromList,
  parsePageSizeInRange,
  resolvePage,
  parseSearchQuery,
};
