'use strict';

const DEFAULT_TIME_ZONE = 'Asia/Ho_Chi_Minh';
const DAY_MS = 24 * 60 * 60 * 1000;

const formatterCache = new Map();

function getParts(date, timeZone) {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    formatterCache.set(timeZone, formatter);
  }
  const parts = {};
  for (const part of formatter.formatToParts(date)) parts[part.type] = part.value;
  return parts;
}

/** ISO-8601 UTC timestamp used for CreateDate/UpdateDate/LastLoginDate. */
function nowIso() {
  return new Date().toISOString();
}

/** Today's date (YYYY-MM-DD) in the given time zone (Vietnam by default). */
function todayIn(timeZone = DEFAULT_TIME_ZONE, date = new Date()) {
  const p = getParts(date, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

/** "YYYYMMDD-HHmmss" in the given time zone, for download file names. */
function fileTimestamp(date = new Date(), timeZone = DEFAULT_TIME_ZONE) {
  const p = getParts(date, timeZone);
  return `${p.year}${p.month}${p.day}-${p.hour}${p.minute}${p.second}`;
}

/** True for a real calendar date written as YYYY-MM-DD (rejects 2023-02-30). */
function isValidDateOnly(text) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** Formats the UTC calendar date of a Date (rounded to the nearest day) as YYYY-MM-DD. */
function utcDateOnly(date) {
  const rounded = new Date(Math.round(date.getTime() / DAY_MS) * DAY_MS);
  return rounded.toISOString().slice(0, 10);
}

/** Excel serial day number → YYYY-MM-DD (1900 date system). */
function excelSerialToDateOnly(serial) {
  return utcDateOnly(new Date((serial - 25569) * DAY_MS));
}

module.exports = {
  DEFAULT_TIME_ZONE,
  nowIso,
  todayIn,
  fileTimestamp,
  isValidDateOnly,
  utcDateOnly,
  excelSerialToDateOnly,
};
