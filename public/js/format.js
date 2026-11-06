/* Display formatters (all output is plain text; escape when rendering). */

const VN_TIME_ZONE = 'Asia/Ho_Chi_Minh';

const dateTimeFormatter = new Intl.DateTimeFormat('vi-VN', {
  timeZone: VN_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const numberFormatter = new Intl.NumberFormat('vi-VN');
const sizeFormatter = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 });

const pad2 = (n) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' -> 'dd/mm/yyyy' (pure string transform, no time zone shift). */
export function formatDate(value) {
  if (!value) return '';
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
  return match ? `${match[3]}/${match[2]}/${match[1]}` : String(value);
}

/** ISO-8601 UTC -> 'dd/mm/yyyy HH:mm' in Asia/Ho_Chi_Minh. */
export function formatDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const parts = {};
  for (const part of dateTimeFormatter.formatToParts(date)) parts[part.type] = part.value;
  return `${pad2(parts.day)}/${pad2(parts.month)}/${parts.year} ${pad2(parts.hour)}:${pad2(parts.minute)}`;
}

export function formatGpa(value) {
  if (value === null || value === undefined || value === '') return '';
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(2) : String(value);
}

export function formatNumber(value) {
  return numberFormatter.format(Number(value) || 0);
}

export function formatFileSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${sizeFormatter.format(n / 1024)} KB`;
  return `${sizeFormatter.format(n / (1024 * 1024))} MB`;
}

/** Today's date in the browser's local calendar as 'YYYY-MM-DD'. */
export function todayYmd() {
  const now = new Date();
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

export function studentCode(id) {
  return `SV${String(id ?? '').padStart(6, '0')}`;
}

/** 'Nguyễn Văn An' -> 'NA' (first letter of the first and the last word). */
export function initials(name) {
  const words = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  const first = words[0][0] ?? '';
  const last = words.length > 1 ? words[words.length - 1][0] ?? '' : '';
  return (first + last).toLocaleUpperCase('vi-VN');
}

/** Stable colour slot (0..5) for placeholder avatars. */
export function colorSlot(seed) {
  const text = String(seed ?? '');
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  return hash % 6;
}
