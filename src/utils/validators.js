'use strict';

const { GENDERS, LIMITS, MIN_DATE_OF_BIRTH } = require('../constants/student');
const { isKnownPermission, sortPermissionCodes } = require('../constants/permissions');
const { cleanText, charLength, normalizeText } = require('./text');
const { isValidDateOnly, todayIn } = require('./date');

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,}$/;
const PHONE_RE = /^0\d{9,10}$/;
const USERNAME_RE = /^[a-z0-9_.]+$/;
const ROLE_CODE_RE = /^[a-z0-9_]{2,30}$/;
const GPA_RE = /^(?:\d+(?:\.\d*)?|\.\d+)$/;
const GENDER_LOOKUP = new Map(GENDERS.map((g) => [normalizeText(g), g]));
const FILE_FORMATS = ['xlsx', 'json', 'xml'];

const hasOwn = (obj, key) => obj !== null && obj !== undefined && Object.prototype.hasOwnProperty.call(obj, key);

// ---------------------------------------------------------------------------
// Primitive parsers
// ---------------------------------------------------------------------------

/** First value of a query parameter that may be repeated (?q=a&q=b). */
function firstValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

/** Positive safe integer from a number or a digit string, otherwise null. */
function parseId(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? value : null;
  if (typeof value === 'string' && /^\d{1,15}$/.test(value.trim())) {
    const id = Number(value.trim());
    return id > 0 ? id : null;
  }
  return null;
}

/** true/false from booleans, 1/0 and common strings; undefined when unrecognized. */
function parseBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === 0) return value === 1;
  if (typeof value === 'string') {
    const s = value.trim().toLowerCase();
    if (['1', 'true', 'on', 'yes'].includes(s)) return true;
    if (['0', 'false', 'off', 'no'].includes(s)) return false;
  }
  return undefined;
}

/** Validates `ids` for bulk operations: 1..max positive integers, duplicates removed (order kept). */
function parseIdList(value, { field = 'ids', max = 1000 } = {}) {
  const fail = (message) => ({ ids: null, errors: [{ field, message }] });
  if (!Array.isArray(value)) return fail('Danh sách ids phải là một mảng các số nguyên dương.');
  if (value.length === 0) return fail('Vui lòng chọn ít nhất một bản ghi.');
  if (value.length > max) return fail(`Chỉ được xử lý tối đa ${max} bản ghi mỗi lần.`);
  const ids = [];
  const seen = new Set();
  for (const item of value) {
    const id = parseId(item);
    if (!id) return fail('Danh sách ids chỉ được chứa số nguyên dương.');
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return { ids, errors: [] };
}

/** xlsx | json | xml (case-insensitive); missing → fallback. Returns null when invalid. */
function parseFileFormat(value, fallback = 'xlsx') {
  const raw = firstValue(value);
  if (raw === undefined || raw === null || String(raw).trim() === '') return fallback;
  const format = String(raw).trim().toLowerCase();
  return FILE_FORMATS.includes(format) ? format : null;
}

// ---------------------------------------------------------------------------
// Field readers (push { field, message } into `errors`, return the clean value)
// ---------------------------------------------------------------------------

/** Scalar input → cleaned text. Empty → null. Objects/arrays → invalid. */
function readText(raw, { multiline = false } = {}) {
  if (raw === undefined || raw === null) return { value: null };
  if (typeof raw === 'string') {
    const text = cleanText(raw, { multiline });
    return { value: text === '' ? null : text };
  }
  if (typeof raw === 'number') return Number.isFinite(raw) ? { value: String(raw) } : { invalid: true };
  if (typeof raw === 'boolean') return { value: String(raw) };
  return { invalid: true };
}

function lengthMessage(label, min, max) {
  return min ? `${label} phải từ ${min} đến ${max} ký tự.` : `${label} tối đa ${max} ký tự.`;
}

function textField(errors, input, field, { label, required = false, min = 0, max, multiline = false }) {
  const result = readText(input[field], { multiline });
  if (result.invalid) {
    errors.push({ field, message: `${label} không hợp lệ.` });
    return undefined;
  }
  if (result.value === null) {
    if (required) errors.push({ field, message: `Vui lòng nhập ${label.toLowerCase()}.` });
    return null;
  }
  const length = charLength(result.value);
  if ((min && length < min) || (max && length > max)) {
    errors.push({ field, message: lengthMessage(label, min, max) });
    return undefined;
  }
  return result.value;
}

function emailField(errors, input, field = 'Email', max = LIMITS.Email.max) {
  const result = readText(input[field]);
  if (result.invalid) {
    errors.push({ field, message: 'Email không hợp lệ.' });
    return undefined;
  }
  if (result.value === null) return null;
  if (charLength(result.value) > max) {
    errors.push({ field, message: `Email tối đa ${max} ký tự.` });
    return undefined;
  }
  if (!EMAIL_RE.test(result.value)) {
    errors.push({ field, message: 'Email không đúng định dạng (ví dụ: ten@example.com).' });
    return undefined;
  }
  return result.value;
}

function genderField(errors, input) {
  const result = readText(input.Gender);
  if (!result.invalid && result.value === null) {
    errors.push({ field: 'Gender', message: 'Vui lòng chọn giới tính.' });
    return undefined;
  }
  const gender = result.invalid ? undefined : GENDER_LOOKUP.get(normalizeText(result.value));
  if (!gender) {
    errors.push({ field: 'Gender', message: 'Giới tính phải là Nam, Nữ hoặc Khác.' });
    return undefined;
  }
  return gender;
}

function dateOfBirthField(errors, input, today) {
  const field = 'DateOfBirth';
  const result = readText(input[field]);
  if (result.invalid) {
    errors.push({ field, message: 'Ngày sinh không hợp lệ.' });
    return undefined;
  }
  if (result.value === null) {
    errors.push({ field, message: 'Vui lòng nhập ngày sinh.' });
    return undefined;
  }
  const value = result.value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    errors.push({ field, message: 'Ngày sinh phải có dạng YYYY-MM-DD.' });
    return undefined;
  }
  if (!isValidDateOnly(value)) {
    errors.push({ field, message: 'Ngày sinh không phải là ngày hợp lệ.' });
    return undefined;
  }
  if (value < MIN_DATE_OF_BIRTH || value > today) {
    errors.push({ field, message: 'Ngày sinh phải trong khoảng từ 01/01/1950 đến hôm nay.' });
    return undefined;
  }
  return value;
}

function phoneField(errors, input) {
  const result = readText(input.Phone);
  if (result.invalid) {
    errors.push({ field: 'Phone', message: 'Số điện thoại không hợp lệ.' });
    return undefined;
  }
  if (result.value === null) return null;
  const phone = result.value.replace(/[\s.-]/g, '');
  if (!PHONE_RE.test(phone)) {
    errors.push({ field: 'Phone', message: 'Số điện thoại phải bắt đầu bằng 0 và gồm 10–11 chữ số.' });
    return undefined;
  }
  return phone;
}

function gpaField(errors, input) {
  const raw = input.GPA;
  const fail = () => {
    errors.push({ field: 'GPA', message: 'GPA phải là số từ 0 đến 4.' });
    return undefined;
  };
  if (raw === undefined || raw === null) return null;
  let gpa;
  if (typeof raw === 'number') {
    gpa = raw;
  } else if (typeof raw === 'string') {
    const text = raw.trim().replace(',', '.');
    if (text === '') return null;
    if (!GPA_RE.test(text)) return fail();
    gpa = Number(text);
  } else {
    return fail();
  }
  if (!Number.isFinite(gpa) || gpa < 0 || gpa > 4) return fail();
  return Math.round((gpa + Number.EPSILON) * 100) / 100;
}

// ---------------------------------------------------------------------------
// Entity validators
// ---------------------------------------------------------------------------

/**
 * Validates the editable student fields (create, update, import).
 * Returns { value, errors } where errors = [{ field, message }].
 */
function validateStudent(input, { today = todayIn() } = {}) {
  const data = input || {};
  const errors = [];
  const value = {
    FullName: textField(errors, data, 'FullName', { label: 'Họ tên', required: true, ...LIMITS.FullName }),
    Gender: genderField(errors, data),
    DateOfBirth: dateOfBirthField(errors, data, today),
    ClassName: textField(errors, data, 'ClassName', { label: 'Lớp', required: true, ...LIMITS.ClassName }),
    Major: textField(errors, data, 'Major', { label: 'Ngành', required: true, ...LIMITS.Major }),
    Email: emailField(errors, data),
    Phone: phoneField(errors, data),
    Address: textField(errors, data, 'Address', { label: 'Địa chỉ', ...LIMITS.Address }),
    GPA: gpaField(errors, data),
    Description: textField(errors, data, 'Description', { label: 'Ghi chú', multiline: true, ...LIMITS.Description }),
  };
  return { value, errors };
}

function validateLogin(input) {
  const data = input || {};
  const errors = [];
  const username = typeof data.username === 'string' ? data.username.trim().toLowerCase() : '';
  const password = typeof data.password === 'string' ? data.password : '';
  if (!username) errors.push({ field: 'username', message: 'Vui lòng nhập tên đăng nhập.' });
  if (!password) errors.push({ field: 'password', message: 'Vui lòng nhập mật khẩu.' });
  return { value: { username, password }, errors };
}

function usernameField(errors, input) {
  const raw = input.Username;
  if (raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')) {
    errors.push({ field: 'Username', message: 'Vui lòng nhập tên đăng nhập.' });
    return undefined;
  }
  const username = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (username.length < 3 || username.length > 30 || !USERNAME_RE.test(username)) {
    errors.push({
      field: 'Username',
      message: 'Tên đăng nhập dài 3–30 ký tự, chỉ gồm chữ thường a–z, chữ số, dấu chấm (.) và gạch dưới (_).',
    });
    return undefined;
  }
  return username;
}

function passwordField(errors, input, { required }) {
  const raw = input.Password;
  if (raw === undefined || raw === null || raw === '') {
    if (required) errors.push({ field: 'Password', message: 'Vui lòng nhập mật khẩu.' });
    return null;
  }
  if (typeof raw !== 'string' || raw.length < 6 || raw.length > 100 || !/\p{L}/u.test(raw) || !/\d/.test(raw)) {
    errors.push({
      field: 'Password',
      message: 'Mật khẩu phải có ít nhất 6 ký tự, gồm ít nhất 1 chữ cái và 1 chữ số.',
    });
    return undefined;
  }
  return raw;
}

function roleIdField(errors, input) {
  const raw = input.RoleID;
  if (raw === undefined || raw === null || raw === '') {
    errors.push({ field: 'RoleID', message: 'Vui lòng chọn vai trò.' });
    return undefined;
  }
  const id = parseId(raw);
  if (!id) {
    errors.push({ field: 'RoleID', message: 'Vai trò không hợp lệ.' });
    return undefined;
  }
  return id;
}

function isActiveField(errors, input) {
  const value = parseBoolean(input.IsActive);
  if (value === undefined) errors.push({ field: 'IsActive', message: 'Trạng thái hoạt động không hợp lệ.' });
  return value;
}

function validateUserCreate(input) {
  const data = input || {};
  const errors = [];
  const value = {
    Username: usernameField(errors, data),
    Password: passwordField(errors, data, { required: true }),
    FullName: textField(errors, data, 'FullName', { label: 'Họ tên', required: true, min: 2, max: 100 }),
    Email: emailField(errors, data),
    RoleID: roleIdField(errors, data),
    IsActive: hasOwn(data, 'IsActive') ? isActiveField(errors, data) : true,
  };
  return { value, errors };
}

/** Partial update: only fields present in the body are validated and returned. */
function validateUserUpdate(input) {
  const data = input || {};
  const errors = [];
  const value = {};
  if (hasOwn(data, 'FullName')) {
    value.FullName = textField(errors, data, 'FullName', { label: 'Họ tên', required: true, min: 2, max: 100 });
  }
  if (hasOwn(data, 'Email')) value.Email = emailField(errors, data);
  if (hasOwn(data, 'RoleID')) value.RoleID = roleIdField(errors, data);
  if (hasOwn(data, 'IsActive')) value.IsActive = isActiveField(errors, data);
  if (hasOwn(data, 'Password')) value.Password = passwordField(errors, data, { required: false });
  return { value, errors };
}

function permissionsField(errors, input) {
  const raw = input.Permissions;
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.some((code) => typeof code !== 'string')) {
    errors.push({ field: 'Permissions', message: 'Danh sách quyền phải là một mảng mã quyền (ví dụ: "student.read").' });
    return undefined;
  }
  const codes = raw.map((code) => code.trim());
  const unknown = [...new Set(codes.filter((code) => !isKnownPermission(code)))];
  if (unknown.length > 0) {
    errors.push({ field: 'Permissions', message: `Quyền không tồn tại: ${unknown.join(', ')}.` });
    return undefined;
  }
  return sortPermissionCodes(codes);
}

function roleCodeField(errors, input) {
  const raw = input.Code;
  if (raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')) {
    errors.push({ field: 'Code', message: 'Vui lòng nhập mã vai trò.' });
    return undefined;
  }
  const code = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (!ROLE_CODE_RE.test(code)) {
    errors.push({ field: 'Code', message: 'Mã vai trò dài 2–30 ký tự, chỉ gồm chữ thường a–z, chữ số và gạch dưới (_).' });
    return undefined;
  }
  return code;
}

function validateRoleCreate(input) {
  const data = input || {};
  const errors = [];
  const value = {
    Code: roleCodeField(errors, data),
    Name: textField(errors, data, 'Name', { label: 'Tên vai trò', required: true, min: 2, max: 100 }),
    Description: textField(errors, data, 'Description', { label: 'Mô tả', max: 255, multiline: true }),
    Permissions: permissionsField(errors, data),
  };
  return { value, errors };
}

/** Partial update: Name, Description, Permissions (Code is immutable). */
function validateRoleUpdate(input) {
  const data = input || {};
  const errors = [];
  const value = {};
  if (hasOwn(data, 'Name')) {
    value.Name = textField(errors, data, 'Name', { label: 'Tên vai trò', required: true, min: 2, max: 100 });
  }
  if (hasOwn(data, 'Description')) {
    value.Description = textField(errors, data, 'Description', { label: 'Mô tả', max: 255, multiline: true });
  }
  if (hasOwn(data, 'Permissions')) value.Permissions = permissionsField(errors, data);
  return { value, errors };
}

module.exports = {
  EMAIL_RE,
  PHONE_RE,
  hasOwn,
  firstValue,
  parseId,
  parseBoolean,
  parseIdList,
  parseFileFormat,
  readText,
  validateStudent,
  validateLogin,
  validateUserCreate,
  validateUserUpdate,
  validateRoleCreate,
  validateRoleUpdate,
};
