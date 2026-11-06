/**
 * Minimal safe HTML templating.
 *
 * Every value interpolated into the `html` tagged template is HTML-escaped,
 * unless it is a SafeHtml instance (produced by `html` itself or explicitly by `raw`).
 * Arrays are rendered item by item; null / undefined / false render as nothing.
 * Always put interpolations inside quoted attribute values: attr="${value}".
 */
export class SafeHtml {
  constructor(value) {
    this.value = String(value);
  }

  toString() {
    return this.value;
  }
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };

export function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"'`]/g, (ch) => ESCAPES[ch]);
}

function toHtml(value) {
  if (value instanceof SafeHtml) return value.value;
  if (Array.isArray(value)) return value.map(toHtml).join('');
  if (value === null || value === undefined || value === false) return '';
  return escapeHtml(value);
}

export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i += 1) {
    out += toHtml(values[i]) + strings[i + 1];
  }
  return new SafeHtml(out);
}

/** Mark trusted, developer-written markup as safe. Never pass user data here. */
export function raw(markup) {
  return new SafeHtml(markup);
}

/** The only way views write markup: SafeHtml is inserted, anything else is escaped as text. */
export function setHtml(element, content) {
  element.innerHTML = content instanceof SafeHtml ? content.value : escapeHtml(content);
}

/** Only allow images served by our own /uploads route (blocks javascript:, data:, external URLs). */
export function safeUploadSrc(path) {
  return typeof path === 'string' && /^\/uploads\/[A-Za-z0-9._-]+$/.test(path) ? path : null;
}
