'use strict';

const path = require('node:path');

const {
  EXPORT_COLUMNS,
  IMPORT_COLUMNS,
  REQUIRED_IMPORT_COLUMNS,
  IGNORED_IMPORT_COLUMNS,
  TEMPLATE_ROWS,
} = require('../constants/student');
const { transaction } = require('../db');
const { validationError, fileError } = require('../utils/http-error');
const { buildStudentSearchText } = require('../utils/text');
const { nowIso, todayIn, fileTimestamp, utcDateOnly, excelSerialToDateOnly } = require('../utils/date');
const { parseFileFormat, validateStudent } = require('../utils/validators');
const { parseSearchQuery } = require('../utils/pagination');
const { toStudentDto } = require('./mappers');
const { writeXlsx, readXlsx } = require('./formats/xlsx');
const { writeJson, readJson } = require('./formats/json');
const { writeXml, readXml } = require('./formats/xml');

const CONTENT_TYPES = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  json: 'application/json; charset=utf-8',
  xml: 'application/xml; charset=utf-8',
};
const FORMAT_BY_EXTENSION = { '.xlsx': 'xlsx', '.json': 'json', '.xml': 'xml' };
const TEXT_COLUMNS = ['Phone', 'DateOfBirth'];

// Header/key lookup (case-insensitive) for every column an import file may contain.
const FIELD_LOOKUP = new Map([...IMPORT_COLUMNS, ...IGNORED_IMPORT_COLUMNS].map((f) => [f.toLowerCase(), f]));

const TEMPLATE_HELP_SHEET = {
  name: 'Hướng dẫn',
  columns: [
    { header: 'Cột', width: 14 },
    { header: 'Bắt buộc', width: 10 },
    { header: 'Quy tắc', width: 90 },
  ],
  rows: [
    ['FullName', 'Có', 'Họ tên, 2–100 ký tự'],
    ['PathImage', 'Không', 'Để trống, hoặc /uploads/<tên file> của ảnh đã có trên máy chủ'],
    ['Gender', 'Có', 'Nam, Nữ hoặc Khác'],
    ['DateOfBirth', 'Có', 'YYYY-MM-DD (chấp nhận cả dd/mm/yyyy hoặc ô kiểu ngày), từ 01/01/1950 đến hôm nay'],
    ['ClassName', 'Có', 'Tối đa 50 ký tự, ví dụ CNTT-K18A'],
    ['Major', 'Có', 'Tối đa 100 ký tự, ví dụ Công nghệ thông tin'],
    ['Email', 'Không', 'Email hợp lệ, tối đa 100 ký tự'],
    ['Phone', 'Không', 'Bắt đầu bằng 0, gồm 10–11 chữ số'],
    ['Address', 'Không', 'Tối đa 255 ký tự'],
    ['GPA', 'Không', 'Số từ 0 đến 4, làm tròn 2 chữ số thập phân'],
    ['Description', 'Không', 'Ghi chú, tối đa 1000 ký tự'],
    [],
    ['Lưu ý', '', 'Dữ liệu nằm ở sheet "Students": dòng 1 là tên cột, dữ liệu bắt đầu từ dòng 2.'],
    ['', '', 'Tối đa 1000 dòng mỗi lần nhập. Không dùng công thức (formula) trong ô.'],
    ['', '', 'Nếu có bất kỳ dòng nào lỗi thì không dòng nào được nhập. Hãy sửa theo danh sách lỗi rồi nhập lại.'],
  ],
};

/** DateOfBirth from Excel/JSON/XML → "YYYY-MM-DD" where possible (validation happens afterwards). */
function coerceDate(value) {
  if (value instanceof Date) return utcDateOnly(value);
  if (typeof value === 'number') return value > 0 && value < 2958466 ? excelSerialToDateOnly(value) : String(value);
  if (typeof value !== 'string') return value;
  const text = value.trim();
  const isoDateTime = /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/.exec(text);
  if (isoDateTime) return isoDateTime[1];
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  return text;
}

/** Numeric phone (Excel drops the leading zero) → string with the "0" restored. */
function coercePhone(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    const digits = String(value);
    return digits.startsWith('0') ? digits : `0${digits}`;
  }
  return value;
}

function coerceRecord(raw) {
  const data = {};
  for (const field of IMPORT_COLUMNS) {
    let value = raw[field];
    if (value === undefined) continue;
    if (field === 'DateOfBirth') value = coerceDate(value);
    else if (field === 'Phone') value = coercePhone(value);
    else if (value instanceof Date) value = value.toISOString();
    data[field] = value;
  }
  return data;
}

function createStudentIoService({ db, studentRepository, imageService, config }) {
  const { limits } = config;
  const readerOptions = {
    fieldLookup: FIELD_LOOKUP,
    importFields: IMPORT_COLUMNS,
    requiredFields: REQUIRED_IMPORT_COLUMNS,
    maxRows: limits.importMaxRows,
    maxUncompressedBytes: limits.xlsxMaxUncompressedBytes,
    maxZipEntries: limits.xlsxMaxZipEntries,
  };
  const readers = { xlsx: readXlsx, json: readJson, xml: readXml };

  function requireFormat(value) {
    const format = parseFileFormat(value);
    if (!format) {
      throw validationError([{ field: 'format', message: 'Định dạng phải là xlsx, json hoặc xml.' }], 'Định dạng file không hợp lệ.');
    }
    return format;
  }

  async function serialize(format, rows, columns, extraSheet) {
    let body;
    if (format === 'json') body = writeJson(rows, columns);
    else if (format === 'xml') body = writeXml(rows, columns);
    else body = await writeXlsx({ columns, rows, textColumns: TEXT_COLUMNS, extraSheet });
    return { body, contentType: CONTENT_TYPES[format] };
  }

  /** GET /api/students/export — every row matching q (all pages), ascending StudentID. */
  async function exportStudents(query = {}) {
    const format = requireFormat(query.format);
    const q = parseSearchQuery(query.q, limits.searchMaxLength);
    const rows = studentRepository.findAll({ q }).map(toStudentDto);
    const file = await serialize(format, rows, EXPORT_COLUMNS, null);
    return { ...file, filename: `sinh-vien-${fileTimestamp(new Date(), config.timeZone)}.${format}` };
  }

  /** GET /api/students/template — import columns + 2 example rows. */
  async function buildTemplate(query = {}) {
    const format = requireFormat(query.format);
    const file = await serialize(format, TEMPLATE_ROWS, IMPORT_COLUMNS, TEMPLATE_HELP_SHEET);
    return { ...file, filename: `mau-nhap-sinh-vien.${format}` };
  }

  function checkImagePath(value) {
    if (value === undefined || value === null) return { value: null };
    if (typeof value !== 'string' && typeof value !== 'number') return { error: 'Đường dẫn ảnh không hợp lệ.' };
    const text = String(value).trim();
    if (!text) return { value: null };
    if (!imageService.resolvePublicPath(text)) return { error: 'Đường dẫn ảnh phải có dạng /uploads/<tên file>.' };
    if (!imageService.exists(text)) return { error: 'Không tìm thấy file ảnh này trên máy chủ.' };
    return { value: text };
  }

  /**
   * POST /api/students/import — validates every row first; any error → 400 with
   * details [{ row, field, message }] and nothing inserted. Inserts in one transaction.
   */
  async function importStudents(file) {
    if (!file) {
      const message = 'Vui lòng chọn file cần nhập (.xlsx, .json hoặc .xml).';
      throw fileError(message, { details: [{ field: 'file', message }] });
    }
    const format = FORMAT_BY_EXTENSION[path.extname(file.originalname || '').toLowerCase()];
    if (!format) throw fileError('Định dạng file không được hỗ trợ. Chỉ chấp nhận .xlsx, .json hoặc .xml.');
    if (!file.buffer || file.buffer.length === 0) throw fileError('File rỗng.');

    const records = await readers[format](file.buffer, readerOptions);
    if (records.length === 0) throw fileError('File không có dòng dữ liệu nào để nhập.');

    const today = todayIn(config.timeZone);
    const details = [];
    const rows = [];
    for (const record of records) {
      const rowErrors = [...record.errors];
      if (!record.invalid) {
        const data = coerceRecord(record.raw);
        const blocked = new Set(rowErrors.map((e) => e.field)); // fields that already have a cell-level error
        const { value, errors } = validateStudent(data, { today });
        for (const e of errors) if (!blocked.has(e.field)) rowErrors.push(e);
        const image = blocked.has('PathImage') ? { value: null } : checkImagePath(data.PathImage);
        if (image.error) rowErrors.push({ field: 'PathImage', message: image.error });
        if (rowErrors.length === 0) rows.push({ ...value, PathImage: image.value });
      }
      for (const e of rowErrors) details.push({ row: record.row, field: e.field, message: e.message });
    }

    if (details.length > 0) {
      const badRows = new Set(details.map((d) => d.row)).size;
      const shown = details.slice(0, limits.importMaxErrorDetails);
      const note = details.length > shown.length ? ` (hiển thị ${shown.length} lỗi đầu tiên)` : '';
      throw validationError(shown, `File có ${details.length} lỗi ở ${badRows} dòng${note}. Chưa có dòng nào được nhập.`);
    }

    const now = nowIso();
    transaction(db, () => {
      for (const row of rows) {
        studentRepository.insert({ ...row, CreateDate: now, UpdateDate: now, SearchText: buildStudentSearchText(row) });
      }
    });
    return { imported: rows.length };
  }

  return { exportStudents, buildTemplate, importStudents };
}

module.exports = { createStudentIoService, coerceDate, coercePhone };
