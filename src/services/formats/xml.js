'use strict';

const { XMLParser, XMLBuilder, XMLValidator } = require('fast-xml-parser');

const { fileError } = require('../../utils/http-error');
const { decodeText, tooManyRowsError, pickFields } = require('./common');

const DTD_RE = /<!\s*(DOCTYPE|ENTITY)/i;

const builder = new XMLBuilder({ format: true, indentBy: '  ', suppressEmptyNode: false });

/** <Students><Student><Field>…</Field></Student></Students>; null → empty element. */
function writeXml(rows, columns) {
  const Student = rows.map((row) =>
    Object.fromEntries(columns.map((key) => [key, row[key] === null || row[key] === undefined ? '' : String(row[key])])),
  );
  const xml = builder.build({ Students: { Student } });
  return Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>\n${xml}`, 'utf8');
}

function createParser() {
  return new XMLParser({
    ignoreAttributes: true,
    parseTagValue: false, // every value stays a string
    trimValues: true,
    processEntities: true,
    htmlEntities: true, // decode numeric character references (&#233; &#x1EC5;)
    ignoreDeclaration: true,
    ignorePiTags: true,
    isArray: (name, jpath) => jpath === 'Students.Student',
  });
}

/**
 * Parses <Students><Student>…</Student></Students>. DOCTYPE/ENTITY declarations are refused
 * before parsing (no DTD, no entity expansion). Row number = 1-based <Student> index.
 */
function readXml(buffer, { fieldLookup, importFields, maxRows }) {
  const text = decodeText(buffer);
  if (DTD_RE.test(text)) {
    throw fileError('File XML không được chứa khai báo <!DOCTYPE> hoặc <!ENTITY> (lý do bảo mật).');
  }
  const validation = XMLValidator.validate(text);
  if (validation !== true) {
    const where = validation.err ? ` (dòng ${validation.err.line}, cột ${validation.err.col})` : '';
    throw fileError(`File XML không đúng cú pháp${where}.`);
  }

  let doc;
  try {
    doc = createParser().parse(text);
  } catch {
    throw fileError('Không đọc được file XML.');
  }

  const roots = Object.keys(doc);
  if (roots.length !== 1 || roots[0] !== 'Students') {
    throw fileError('File XML phải có cấu trúc <Students><Student>…</Student></Students>.');
  }
  const container = doc.Students;
  const list = container && typeof container === 'object' && Array.isArray(container.Student) ? container.Student : [];
  if (list.length > maxRows) throw tooManyRowsError(maxRows);

  return list.map((item, index) => {
    const row = index + 1;
    if (item === '' || item === null || item === undefined) return { row, raw: {}, errors: [] };
    if (typeof item !== 'object') {
      return {
        row,
        raw: {},
        invalid: true,
        errors: [{ field: null, message: 'Thẻ <Student> phải chứa các thẻ con như <FullName>, <Gender>, …' }],
      };
    }
    return { row, ...pickFields(item, { fieldLookup, importFields }) };
  });
}

module.exports = { writeXml, readXml };
