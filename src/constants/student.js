'use strict';

const GENDERS = Object.freeze(['Nam', 'Nữ', 'Khác']);

/** Page sizes accepted by GET /api/students (anything else falls back to the first one). */
const STUDENT_PAGE_SIZES = Object.freeze([10, 15]);

/** Columns of exported files, in API field order. */
const EXPORT_COLUMNS = Object.freeze([
  'StudentID',
  'StudentCode',
  'FullName',
  'PathImage',
  'Gender',
  'DateOfBirth',
  'ClassName',
  'Major',
  'Email',
  'Phone',
  'Address',
  'GPA',
  'Description',
  'CreateDate',
  'UpdateDate',
]);

/** Columns read by the import (and written to the template). */
const IMPORT_COLUMNS = Object.freeze([
  'FullName',
  'PathImage',
  'Gender',
  'DateOfBirth',
  'ClassName',
  'Major',
  'Email',
  'Phone',
  'Address',
  'GPA',
  'Description',
]);

/** Columns that must exist in the header row of an Excel import. */
const REQUIRED_IMPORT_COLUMNS = Object.freeze(['FullName', 'Gender', 'DateOfBirth', 'ClassName', 'Major']);

/** Columns present in exported files but ignored by the import. */
const IGNORED_IMPORT_COLUMNS = Object.freeze(['StudentID', 'StudentCode', 'CreateDate', 'UpdateDate']);

const COPY_SUFFIX = ' (bản sao)';
const MIN_DATE_OF_BIRTH = '1950-01-01';

const LIMITS = Object.freeze({
  FullName: { min: 2, max: 100 },
  ClassName: { max: 50 },
  Major: { max: 100 },
  Email: { max: 100 },
  Address: { max: 255 },
  Description: { max: 1000 },
});

/** Two example rows for the import template (PathImage left empty on purpose). */
const TEMPLATE_ROWS = Object.freeze([
  {
    FullName: 'Nguyễn Văn Mẫu',
    PathImage: null,
    Gender: 'Nam',
    DateOfBirth: '2003-05-20',
    ClassName: 'CNTT-K21A',
    Major: 'Công nghệ thông tin',
    Email: 'mau.nguyenvan@sv.qlsv.edu.vn',
    Phone: '0912345678',
    Address: 'Cầu Giấy, Hà Nội',
    GPA: 3.25,
    Description: 'Dòng ví dụ, có thể xóa trước khi nhập',
  },
  {
    FullName: 'Trần Thị Ví Dụ',
    PathImage: null,
    Gender: 'Nữ',
    DateOfBirth: '2004-11-02',
    ClassName: 'KTPM-K22B',
    Major: 'Kỹ thuật phần mềm',
    Email: null,
    Phone: '0987654321',
    Address: 'TP. Thủ Đức, TP. Hồ Chí Minh',
    GPA: 3.6,
    Description: null,
  },
]);

module.exports = {
  GENDERS,
  STUDENT_PAGE_SIZES,
  EXPORT_COLUMNS,
  IMPORT_COLUMNS,
  REQUIRED_IMPORT_COLUMNS,
  IGNORED_IMPORT_COLUMNS,
  COPY_SUFFIX,
  MIN_DATE_OF_BIRTH,
  LIMITS,
  TEMPLATE_ROWS,
};
