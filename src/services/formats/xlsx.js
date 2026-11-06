'use strict';

const ExcelJS = require('exceljs');

const { fileError } = require('../../utils/http-error');
const { inspectZip } = require('../../utils/file-type');
const { tooManyRowsError } = require('./common');

const SHEET_NAME = 'Students';

const COLUMN_WIDTHS = {
  StudentID: 10,
  StudentCode: 12,
  FullName: 28,
  PathImage: 46,
  Gender: 9,
  DateOfBirth: 13,
  ClassName: 13,
  Major: 26,
  Email: 30,
  Phone: 14,
  Address: 34,
  GPA: 7,
  Description: 40,
  CreateDate: 26,
  UpdateDate: 26,
};

function columnLetter(columnNumber) {
  let n = columnNumber;
  let letters = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

/**
 * Workbook with a "Students" sheet (row 1 = field names). `textColumns` get the Text (@) number
 * format so values such as phone numbers keep their leading zero when edited in Excel.
 * `extraSheet` = { name, columns: [{ header, width }], rows: [[…]] } (e.g. instructions).
 */
async function writeXlsx({ columns, rows, textColumns = [], extraSheet = null }) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Quản lý sinh viên';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(SHEET_NAME, { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = columns.map((key) => ({
    header: key,
    key,
    width: COLUMN_WIDTHS[key] ?? 16,
    ...(textColumns.includes(key) ? { style: { numFmt: '@' } } : {}),
  }));
  for (const row of rows) {
    sheet.addRow(columns.map((key) => (row[key] === undefined || row[key] === null ? null : row[key])));
  }
  sheet.getRow(1).font = { bold: true };
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };

  if (extraSheet) {
    const help = workbook.addWorksheet(extraSheet.name);
    help.columns = extraSheet.columns.map((c) => ({ header: c.header, width: c.width }));
    for (const r of extraSheet.rows) help.addRow(r);
    help.getRow(1).font = { bold: true };
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function richTextToString(parts) {
  return parts.map((part) => (part && part.text !== undefined ? String(part.text) : '')).join('');
}

/**
 * Plain value of a cell: { value } | { formula: true } | { error: true }.
 * Rich text and hyperlinks become plain text; dates stay Date objects.
 */
function readCell(cell) {
  if (cell.type === ExcelJS.ValueType.Formula) return { formula: true };
  if (cell.type === ExcelJS.ValueType.Merge) return { value: null }; // only the master cell of a merge counts
  const value = cell.value;
  if (value === null || value === undefined) return { value: null };
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? { error: true } : { value };
  if (typeof value === 'object') {
    if ('formula' in value || 'sharedFormula' in value) return { formula: true };
    if ('error' in value) return { error: true };
    if (Array.isArray(value.richText)) return { value: richTextToString(value.richText) };
    if ('text' in value) {
      const text = value.text;
      if (text && typeof text === 'object' && Array.isArray(text.richText)) return { value: richTextToString(text.richText) };
      return { value: text === null || text === undefined ? null : String(text) };
    }
    return { error: true };
  }
  return { value };
}

const isBlank = (value) => value === null || value === undefined || (typeof value === 'string' && value.trim() === '');

/**
 * Reads sheet "Students" (fallback: first sheet). Row 1 = field names (case-insensitive).
 * Formula cells → row error. Fully empty rows are skipped; row = Excel row number.
 * Returns [{ row, raw, errors }].
 */
async function readXlsx(buffer, { fieldLookup, importFields, requiredFields, maxRows, maxUncompressedBytes, maxZipEntries }) {
  const zip = inspectZip(buffer);
  if (!zip.ok) throw fileError('File Excel (.xlsx) không hợp lệ hoặc bị hỏng.');
  if (zip.entries > maxZipEntries || zip.totalUncompressed > maxUncompressedBytes) {
    throw fileError('File Excel quá lớn sau khi giải nén. Vui lòng chia nhỏ file.');
  }

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch {
    throw fileError('Không đọc được file Excel. File có thể bị hỏng hoặc không phải định dạng .xlsx.');
  }
  const sheet =
    workbook.worksheets.find((ws) => ws.name.trim().toLowerCase() === SHEET_NAME.toLowerCase()) || workbook.worksheets[0];
  if (!sheet) throw fileError('File Excel không có sheet dữ liệu nào.');

  // Header row → column map.
  const columns = new Map();
  sheet.getRow(1).eachCell({ includeEmpty: false }, (cell, columnNumber) => {
    const result = readCell(cell);
    if (result.formula) throw fileError('Dòng tiêu đề (dòng 1) không được chứa công thức.');
    const label = isBlank(result.value) || result.error ? '' : String(result.value).trim();
    columns.set(columnNumber, {
      field: label ? fieldLookup.get(label.toLowerCase()) || null : null,
      label: label || columnLetter(columnNumber),
    });
  });
  const mapped = new Set([...columns.values()].map((c) => c.field).filter((f) => f && importFields.includes(f)));
  if (mapped.size === 0) {
    throw fileError(
      'Không tìm thấy dòng tiêu đề hợp lệ. Dòng 1 phải chứa tên cột: FullName, Gender, DateOfBirth, ClassName, Major, …',
    );
  }
  const missing = requiredFields.filter((f) => !mapped.has(f));
  if (missing.length > 0) throw fileError(`File Excel thiếu cột bắt buộc: ${missing.join(', ')}.`);

  const records = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const raw = {};
    const errors = [];
    let hasContent = false;
    row.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
      const column = columns.get(columnNumber);
      const field = column ? column.field : null;
      const label = column ? column.field || column.label : columnLetter(columnNumber);
      const result = readCell(cell);
      if (result.formula) {
        hasContent = true;
        errors.push({ field: label, message: 'Ô chứa công thức (formula) không được chấp nhận. Hãy dán dưới dạng giá trị.' });
        return;
      }
      if (result.error) {
        hasContent = true;
        errors.push({ field: label, message: 'Ô chứa giá trị lỗi hoặc không đọc được.' });
        return;
      }
      if (isBlank(result.value)) return;
      hasContent = true;
      if (field && importFields.includes(field)) raw[field] = result.value;
    });
    if (!hasContent) return;
    records.push({ row: rowNumber, raw, errors });
    if (records.length > maxRows) throw tooManyRowsError(maxRows);
  });
  return records;
}

module.exports = { writeXlsx, readXlsx, readCell, columnLetter, SHEET_NAME };
