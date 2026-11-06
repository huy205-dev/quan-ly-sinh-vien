'use strict';

const { fileError } = require('../../utils/http-error');
const { decodeText, tooManyRowsError, pickFields } = require('./common');

/** Array of objects with the given columns, pretty-printed UTF-8 JSON. */
function writeJson(rows, columns) {
  const data = rows.map((row) => Object.fromEntries(columns.map((key) => [key, row[key] ?? null])));
  return Buffer.from(`${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

/**
 * Accepts an array of objects or { "Students": [...] }. Row number = 1-based record index.
 * Returns [{ row, raw, errors, invalid? }].
 */
function readJson(buffer, { fieldLookup, importFields, maxRows }) {
  let data;
  try {
    data = JSON.parse(decodeText(buffer));
  } catch (err) {
    if (err && err.code === 'FILE_ERROR') throw err;
    throw fileError('File JSON không đúng cú pháp.');
  }

  let list = null;
  if (Array.isArray(data)) {
    list = data;
  } else if (data && typeof data === 'object') {
    const key = Object.keys(data).find((k) => k.toLowerCase() === 'students');
    if (key && Array.isArray(data[key])) list = data[key];
  }
  if (!list) {
    throw fileError('File JSON phải là một mảng các đối tượng sinh viên, hoặc có dạng { "Students": [ … ] }.');
  }
  if (list.length > maxRows) throw tooManyRowsError(maxRows);

  return list.map((item, index) => {
    const row = index + 1;
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return { row, raw: {}, invalid: true, errors: [{ field: null, message: 'Bản ghi phải là một đối tượng JSON.' }] };
    }
    return { row, ...pickFields(item, { fieldLookup, importFields }) };
  });
}

module.exports = { writeJson, readJson };
