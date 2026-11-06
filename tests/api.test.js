'use strict';

/**
 * API tests (node:test + global fetch). The app runs in-process on an ephemeral port with a
 * temporary SQLite database and upload directory, so the real data/ and uploads/ are untouched.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const ExcelJS = require('exceljs');

const { createApp } = require('../src/app');
const { ALL_PERMISSION_CODES } = require('../src/constants/permissions');
const { normalizeText } = require('../src/utils/text');

// A real 1×1 PNG.
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

const STUDENT_FIELDS = ['FullName', 'PathImage', 'Gender', 'DateOfBirth', 'ClassName', 'Major', 'Email', 'Phone', 'Address', 'GPA', 'Description'];
const API_FIELD_ORDER = ['StudentID', 'StudentCode', ...STUDENT_FIELDS, 'CreateDate', 'UpdateDate'];

const VALID_STUDENT = {
  FullName: 'Kiểm Thử Viên',
  Gender: 'Nữ',
  DateOfBirth: '2002-02-02',
  ClassName: 'TEST-K01',
  Major: 'Kiểm thử phần mềm',
  Email: 'kiem.thu@example.com',
  Phone: '0911222333',
  Address: 'Cầu Giấy, Hà Nội',
  GPA: '3.456',
  Description: 'Ghi chú kiểm thử',
};

let app;
let server;
let baseUrl;
let tmpDir;
const tokens = {};

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

async function request(method, url, { token, json, form, body, headers = {} } = {}) {
  const init = { method, headers: { ...headers } };
  if (token) init.headers.authorization = `Bearer ${token}`;
  if (json !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(json);
  }
  if (form) init.body = form;
  if (body !== undefined) init.body = body;
  const res = await fetch(baseUrl + url, init);
  const type = res.headers.get('content-type') || '';
  const isDownload = (res.headers.get('content-disposition') || '').startsWith('attachment');
  const data = type.includes('application/json') && !isDownload ? await res.json() : Buffer.from(await res.arrayBuffer());
  return { status: res.status, headers: res.headers, body: data };
}

const get = (url, token) => request('GET', url, { token });

async function login(username, password) {
  const res = await request('POST', '/api/auth/login', { json: { username, password } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.token;
}

function expectError(res, status, code) {
  assert.equal(res.status, status, `expected ${status} ${code}, got ${res.status} ${JSON.stringify(res.body)}`);
  assert.ok(res.body && res.body.error, 'error envelope');
  assert.equal(res.body.error.code, code);
  assert.equal(typeof res.body.error.message, 'string');
  assert.ok(res.body.error.message.length > 0);
}

function detailFields(res) {
  return new Set(res.body.error.details.map((d) => d.field));
}

function studentForm(fields, image) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && value !== null) form.append(key, String(value));
  }
  if (image) form.append('image', new Blob([image.buffer], { type: image.type }), image.name);
  return form;
}

function fileForm(buffer, filename, type = 'application/octet-stream') {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type }), filename);
  return form;
}

const pngImage = () => ({ buffer: TINY_PNG, type: 'image/png', name: 'anh.png' });

async function createStudent(fields = {}, image) {
  const res = await request('POST', '/api/students', {
    token: tokens.admin,
    form: studentForm({ ...VALID_STUDENT, ...fields }, image),
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body;
}

async function search(q, { pageSize = 15, page = 1 } = {}) {
  const res = await get(`/api/students?page=${page}&pageSize=${pageSize}&q=${encodeURIComponent(q)}`, tokens.admin);
  assert.equal(res.status, 200);
  return res.body;
}

async function importFile(buffer, filename, token = tokens.admin) {
  return request('POST', '/api/students/import', { token, form: fileForm(buffer, filename) });
}

async function xlsxBuffer(build) {
  const workbook = new ExcelJS.Workbook();
  build(workbook);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function countExportRows(format, buffer) {
  if (format === 'json') return JSON.parse(buffer.toString('utf8')).length;
  if (format === 'xml') return (buffer.toString('utf8').match(/<Student>/g) || []).length;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  return workbook.getWorksheet('Students').actualRowCount - 1;
}

async function getRoleId(code) {
  const res = await get('/api/roles', tokens.admin);
  return res.body.items.find((r) => r.Code === code).RoleID;
}

// ---------------------------------------------------------------------------
// lifecycle
// ---------------------------------------------------------------------------

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qlsv-test-'));
  app = createApp({ dbPath: path.join(tmpDir, 'app.db'), uploadDir: path.join(tmpDir, 'uploads') });
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  tokens.admin = await login('admin', 'Admin@123');
  tokens.giaovu = await login('giaovu', 'Giaovu@123');
  tokens.giangvien = await login('giangvien', 'Giangvien@123');
  tokens.viewer = await login('viewer', 'Viewer@123');
});

after(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  if (app) app.locals.close();
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------

describe('Seed data', () => {
  it('creates 36 students, 4 roles and 4 users on an empty database', async () => {
    assert.equal((await search('')).total, 36);
    const roles = await get('/api/roles', tokens.admin);
    assert.deepEqual(
      roles.body.items.map((r) => [r.Code, r.IsSystem, r.UserCount]),
      [
        ['admin', true, 1],
        ['giaovu', false, 1],
        ['giangvien', false, 1],
        ['viewer', false, 1],
      ],
    );
    const users = await get('/api/users', tokens.admin);
    assert.deepEqual(
      users.body.items.map((u) => u.Username),
      ['admin', 'giaovu', 'giangvien', 'viewer'],
    );
    if (!process.env.JWT_SECRET) {
      assert.ok(fs.existsSync(path.join(tmpDir, 'jwt-secret.txt')), 'JWT secret generated next to the DB');
    }
  });
});

describe('Auth', () => {
  it('login ok → token, user (no PasswordHash), permissions, X-User', async () => {
    const res = await request('POST', '/api/auth/login', { json: { username: 'ADMIN ', password: 'Admin@123' } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-user'), 'admin');
    assert.match(res.body.token, /^[\w-]+\.[\w-]+\.[\w-]+$/);
    assert.deepEqual(Object.keys(res.body.user), [
      'UserID', 'Username', 'FullName', 'Email', 'RoleID', 'RoleCode', 'RoleName', 'IsActive', 'LastLoginDate', 'CreateDate', 'UpdateDate',
    ]);
    assert.equal(res.body.user.RoleCode, 'admin');
    assert.equal(res.body.user.IsActive, true);
    assert.ok(res.body.user.LastLoginDate);
    assert.deepEqual(res.body.permissions, ALL_PERMISSION_CODES);
    assert.ok(!JSON.stringify(res.body).includes('PasswordHash'));
    assert.ok(!JSON.stringify(res.body).includes('scrypt$'));

    const payload = JSON.parse(Buffer.from(res.body.token.split('.')[1], 'base64url').toString());
    assert.equal(payload.sub, res.body.user.UserID);
    assert.equal(payload.exp - payload.iat, 8 * 60 * 60);
  });

  it('wrong password / unknown user → 401, missing fields → 400', async () => {
    expectError(await request('POST', '/api/auth/login', { json: { username: 'admin', password: 'sai-mat-khau1' } }), 401, 'UNAUTHORIZED');
    expectError(await request('POST', '/api/auth/login', { json: { username: 'khong.ton.tai', password: 'Abc12345' } }), 401, 'UNAUTHORIZED');
    const missing = await request('POST', '/api/auth/login', { json: {} });
    expectError(missing, 400, 'VALIDATION_ERROR');
    assert.deepEqual(detailFields(missing), new Set(['username', 'password']));
  });

  it('locked account → 403 ACCOUNT_LOCKED (only with the right password)', async () => {
    const created = await request('POST', '/api/users', {
      token: tokens.admin,
      json: { Username: 'bi.khoa', Password: 'Khoa1234', FullName: 'Tài Khoản Bị Khóa', RoleID: await getRoleId('viewer'), IsActive: false },
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.IsActive, false);
    expectError(await request('POST', '/api/auth/login', { json: { username: 'bi.khoa', password: 'Khoa1234' } }), 403, 'ACCOUNT_LOCKED');
    expectError(await request('POST', '/api/auth/login', { json: { username: 'bi.khoa', password: 'SaiMatKhau9' } }), 401, 'UNAUTHORIZED');
  });

  it('no token / bad token / tampered token → 401 without X-User', async () => {
    const noToken = await get('/api/students');
    expectError(noToken, 401, 'UNAUTHORIZED');
    assert.equal(noToken.headers.get('x-user'), null);
    expectError(await get('/api/students', 'abc.def.ghi'), 401, 'UNAUTHORIZED');
    const [h, p] = tokens.viewer.split('.');
    const forgedPayload = Buffer.from(JSON.stringify({ sub: 1, iat: 1, exp: 9999999999 })).toString('base64url');
    expectError(await get('/api/students', `${h}.${forgedPayload}.${tokens.viewer.split('.')[2]}`), 401, 'UNAUTHORIZED');
    const noneAlg = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    expectError(await get('/api/students', `${noneAlg}.${p}.`), 401, 'UNAUTHORIZED');
    expectError(await get('/api/auth/me'), 401, 'UNAUTHORIZED');
  });

  it('GET /api/auth/me → { user, permissions } and X-User', async () => {
    const res = await get('/api/auth/me', tokens.giangvien);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-user'), 'giangvien');
    assert.equal(res.body.user.Username, 'giangvien');
    assert.equal(res.body.user.RoleName, 'Giảng viên');
    assert.deepEqual(res.body.permissions, ['student.read', 'student.update', 'student.export']);
  });

  it('locking a logged-in user takes effect on the next request', async () => {
    const created = await request('POST', '/api/users', {
      token: tokens.admin,
      json: { Username: 'sap.bi.khoa', Password: 'MatKhau1', FullName: 'Sắp Bị Khóa', RoleID: await getRoleId('viewer') },
    });
    assert.equal(created.status, 201);
    const token = await login('sap.bi.khoa', 'MatKhau1');
    assert.equal((await get('/api/students', token)).status, 200);
    const locked = await request('PUT', `/api/users/${created.body.UserID}`, { token: tokens.admin, json: { IsActive: false } });
    assert.equal(locked.status, 200, JSON.stringify(locked.body));
    expectError(await get('/api/students', token), 401, 'UNAUTHORIZED');
  });
});

describe('RBAC', () => {
  it('viewer: 403 on create and delete (with permission code), list allowed', async () => {
    assert.equal((await get('/api/students', tokens.viewer)).status, 200);
    const create = await request('POST', '/api/students', { token: tokens.viewer, form: studentForm(VALID_STUDENT) });
    expectError(create, 403, 'FORBIDDEN');
    assert.equal(create.body.error.permission, 'student.create');
    assert.equal(create.headers.get('x-user'), 'viewer');
    const del = await request('DELETE', '/api/students/1', { token: tokens.viewer });
    expectError(del, 403, 'FORBIDDEN');
    assert.equal(del.body.error.permission, 'student.delete');
    const bulk = await request('POST', '/api/students/bulk-delete', { token: tokens.viewer, json: { ids: [1] } });
    expectError(bulk, 403, 'FORBIDDEN');
    expectError(await get('/api/students/export?format=json', tokens.viewer), 403, 'FORBIDDEN');
    expectError(await get('/api/users', tokens.viewer), 403, 'FORBIDDEN');
    expectError(await get('/api/roles/options', tokens.viewer), 403, 'FORBIDDEN');
    assert.equal((await get('/api/students/1', tokens.viewer)).status, 200);
  });

  it('giangvien: 403 on delete, update allowed', async () => {
    const target = await createStudent({ FullName: 'Giảng Viên Sửa' });
    const del = await request('DELETE', `/api/students/${target.StudentID}`, { token: tokens.giangvien });
    expectError(del, 403, 'FORBIDDEN');
    assert.equal(del.body.error.permission, 'student.delete');
    const put = await request('PUT', `/api/students/${target.StudentID}`, {
      token: tokens.giangvien,
      form: studentForm({ ...VALID_STUDENT, FullName: 'Giảng Viên Đã Sửa' }),
    });
    assert.equal(put.status, 200, JSON.stringify(put.body));
    assert.equal(put.body.FullName, 'Giảng Viên Đã Sửa');
    assert.equal(put.headers.get('x-user'), 'giangvien');
  });

  it('giaovu: role options via user.read, but no role.read', async () => {
    const options = await get('/api/roles/options', tokens.giaovu);
    assert.equal(options.status, 200);
    assert.deepEqual(Object.keys(options.body.items[0]), ['RoleID', 'Code', 'Name']);
    const roles = await get('/api/roles', tokens.giaovu);
    expectError(roles, 403, 'FORBIDDEN');
    assert.equal(roles.body.error.permission, 'role.read');
    expectError(await get('/api/permissions', tokens.giaovu), 403, 'FORBIDDEN');
  });

  it('role permission change applies immediately to a logged-in user', async () => {
    const target = await createStudent({ FullName: 'Sẽ Bị Xóa Bởi Giảng Viên' });
    const roleId = await getRoleId('giangvien');
    const before = (await get(`/api/roles/${roleId}`, tokens.admin)).body.Permissions;
    expectError(await request('DELETE', `/api/students/${target.StudentID}`, { token: tokens.giangvien }), 403, 'FORBIDDEN');

    const granted = await request('PUT', `/api/roles/${roleId}`, {
      token: tokens.admin,
      json: { Permissions: [...before, 'student.delete'] },
    });
    assert.equal(granted.status, 200, JSON.stringify(granted.body));
    assert.deepEqual(granted.body.Permissions, ['student.read', 'student.update', 'student.delete', 'student.export']);

    const del = await request('DELETE', `/api/students/${target.StudentID}`, { token: tokens.giangvien });
    assert.equal(del.status, 200);
    assert.deepEqual(del.body, { deleted: 1 });
    assert.ok((await get('/api/auth/me', tokens.giangvien)).body.permissions.includes('student.delete'));

    const restored = await request('PUT', `/api/roles/${roleId}`, { token: tokens.admin, json: { Permissions: before } });
    assert.equal(restored.status, 200);
    expectError(await request('DELETE', '/api/students/2', { token: tokens.giangvien }), 403, 'FORBIDDEN');
  });

  it('system role: permissions cannot be edited (409), name can', async () => {
    const adminRoleId = await getRoleId('admin');
    expectError(
      await request('PUT', `/api/roles/${adminRoleId}`, { token: tokens.admin, json: { Permissions: ['student.read'] } }),
      409,
      'CONFLICT',
    );
    const renamed = await request('PUT', `/api/roles/${adminRoleId}`, {
      token: tokens.admin,
      json: { Name: 'Quản trị hệ thống', Description: 'Toàn quyền', Permissions: [...ALL_PERMISSION_CODES].reverse() },
    });
    assert.equal(renamed.status, 200, JSON.stringify(renamed.body));
    assert.equal(renamed.body.Name, 'Quản trị hệ thống');
    assert.deepEqual(renamed.body.Permissions, ALL_PERMISSION_CODES);
    expectError(await request('DELETE', `/api/roles/${adminRoleId}`, { token: tokens.admin }), 409, 'CONFLICT');
  });

  it('roles: validation, duplicate code, cannot delete a role in use, delete unused role', async () => {
    const invalid = await request('POST', '/api/roles', {
      token: tokens.admin,
      json: { Code: 'Mã Sai!', Name: '', Permissions: ['student.read', 'student.fly'] },
    });
    expectError(invalid, 400, 'VALIDATION_ERROR');
    assert.deepEqual(detailFields(invalid), new Set(['Code', 'Name', 'Permissions']));

    expectError(
      await request('POST', '/api/roles', { token: tokens.admin, json: { Code: 'viewer', Name: 'Trùng mã', Permissions: [] } }),
      409,
      'CONFLICT',
    );
    expectError(await request('DELETE', `/api/roles/${await getRoleId('viewer')}`, { token: tokens.admin }), 409, 'CONFLICT');

    const created = await request('POST', '/api/roles', {
      token: tokens.admin,
      json: { Code: 'thu_tam', Name: 'Thử tạm', Description: 'Vai trò tạm', Permissions: ['student.export', 'student.read'] },
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.deepEqual(Object.keys(created.body), [
      'RoleID', 'Code', 'Name', 'Description', 'IsSystem', 'UserCount', 'Permissions', 'CreateDate', 'UpdateDate',
    ]);
    assert.deepEqual(created.body.Permissions, ['student.read', 'student.export']);
    assert.equal(created.body.UserCount, 0);
    const deleted = await request('DELETE', `/api/roles/${created.body.RoleID}`, { token: tokens.admin });
    assert.equal(deleted.status, 200);
    expectError(await get(`/api/roles/${created.body.RoleID}`, tokens.admin), 404, 'NOT_FOUND');
  });

  it('permission catalog lists actions in matrix order and every module', async () => {
    const res = await get('/api/permissions', tokens.admin);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.actions.map((a) => a.action), ['read', 'create', 'update', 'delete', 'import', 'export']);
    assert.deepEqual(res.body.modules.map((m) => m.module), ['student', 'user', 'role']);
    const studentDelete = res.body.modules[0].permissions.find((p) => p.code === 'student.delete');
    assert.deepEqual(Object.keys(studentDelete), ['code', 'action', 'name', 'description']);
    assert.equal(studentDelete.name, 'Xóa');
  });
});

describe('Users', () => {
  it('cannot delete yourself; cannot lock yourself or change your own role', async () => {
    const me = (await get('/api/auth/me', tokens.admin)).body.user;
    expectError(await request('DELETE', `/api/users/${me.UserID}`, { token: tokens.admin }), 409, 'CONFLICT');
    expectError(await request('PUT', `/api/users/${me.UserID}`, { token: tokens.admin, json: { IsActive: false } }), 409, 'CONFLICT');
    expectError(
      await request('PUT', `/api/users/${me.UserID}`, { token: tokens.admin, json: { RoleID: await getRoleId('viewer') } }),
      409,
      'CONFLICT',
    );
    const ok = await request('PUT', `/api/users/${me.UserID}`, { token: tokens.admin, json: { FullName: 'Nguyễn Quản Trị', Email: 'admin@qlsv.edu.vn' } });
    assert.equal(ok.status, 200);
  });

  it('cannot remove the last active admin', async () => {
    const role = await request('POST', '/api/roles', {
      token: tokens.admin,
      json: { Code: 'quan_ly_nd', Name: 'Quản lý người dùng', Permissions: ['user.read', 'user.update', 'user.delete'] },
    });
    assert.equal(role.status, 201);
    const user = await request('POST', '/api/users', {
      token: tokens.admin,
      json: { Username: 'ql.nguoidung', Password: 'QuanLy123', FullName: 'Quản Lý Người Dùng', RoleID: role.body.RoleID },
    });
    assert.equal(user.status, 201);
    const token = await login('ql.nguoidung', 'QuanLy123');
    const adminId = (await get('/api/auth/me', tokens.admin)).body.user.UserID;
    expectError(await request('DELETE', `/api/users/${adminId}`, { token }), 409, 'CONFLICT');
    expectError(await request('PUT', `/api/users/${adminId}`, { token, json: { IsActive: false } }), 409, 'CONFLICT');
    expectError(await request('PUT', `/api/users/${adminId}`, { token, json: { RoleID: role.body.RoleID } }), 409, 'CONFLICT');
  });

  it('create: validation details, duplicate username → 409, password reset works', async () => {
    const invalid = await request('POST', '/api/users', {
      token: tokens.admin,
      json: { Username: 'A b', Password: 'abc', FullName: '', Email: 'khong-hop-le', RoleID: 99999 },
    });
    expectError(invalid, 400, 'VALIDATION_ERROR');
    assert.deepEqual(detailFields(invalid), new Set(['Username', 'Password', 'FullName', 'Email', 'RoleID']));

    expectError(
      await request('POST', '/api/users', {
        token: tokens.admin,
        json: { Username: 'Viewer', Password: 'Viewer123', FullName: 'Trùng tên', RoleID: await getRoleId('viewer') },
      }),
      409,
      'CONFLICT',
    );

    const created = await request('POST', '/api/users', {
      token: tokens.admin,
      json: { Username: 'Tran.Moi', Password: 'MatKhau1', FullName: 'Trần Mới', Email: 'moi@example.com', RoleID: await getRoleId('viewer') },
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.Username, 'tran.moi');
    const reset = await request('PUT', `/api/users/${created.body.UserID}`, { token: tokens.admin, json: { Password: 'MatKhauMoi2' } });
    assert.equal(reset.status, 200);
    assert.equal(reset.body.FullName, 'Trần Mới');
    expectError(await request('POST', '/api/auth/login', { json: { username: 'tran.moi', password: 'MatKhau1' } }), 401, 'UNAUTHORIZED');
    assert.ok(await login('tran.moi', 'MatKhauMoi2'));
  });

  it('list: paging and diacritic-insensitive search, never PasswordHash', async () => {
    const res = await get('/api/users?pageSize=2&page=1', tokens.admin);
    assert.equal(res.status, 200);
    assert.equal(res.body.pageSize, 2);
    assert.equal(res.body.items.length, 2);
    assert.ok(res.body.totalPages >= 2);
    const found = await get(`/api/users?q=${encodeURIComponent('tran thi giao')}`, tokens.admin);
    assert.deepEqual(found.body.items.map((u) => u.Username), ['giaovu']);
    assert.ok(!JSON.stringify(found.body).includes('PasswordHash'));
    expectError(await get('/api/users/999999', tokens.admin), 404, 'NOT_FOUND');
  });
});

describe('Students CRUD', () => {
  it('admin create → get → update → delete', async () => {
    const created = await createStudent({ Description: 'Dòng 1\nDòng 2 & <b>' });
    assert.deepEqual(Object.keys(created), API_FIELD_ORDER);
    assert.equal(created.StudentCode, `SV${String(created.StudentID).padStart(6, '0')}`);
    assert.equal(created.GPA, 3.46);
    assert.equal(created.PathImage, null);
    assert.equal(created.Description, 'Dòng 1\nDòng 2 & <b>');
    assert.equal(created.CreateDate, created.UpdateDate);
    assert.ok(!('SearchText' in created));

    const fetched = await get(`/api/students/${created.StudentID}`, tokens.admin);
    assert.equal(fetched.status, 200);
    assert.deepEqual(fetched.body, created);

    const updated = await request('PUT', `/api/students/${created.StudentID}`, {
      token: tokens.admin,
      form: studentForm({ ...VALID_STUDENT, FullName: '  Kiểm   Thử Đã Sửa ', Gender: 'nam', Email: '', Phone: '0912 345 678', GPA: '3,5' }),
    });
    assert.equal(updated.status, 200, JSON.stringify(updated.body));
    assert.equal(updated.body.FullName, 'Kiểm Thử Đã Sửa');
    assert.equal(updated.body.Gender, 'Nam');
    assert.equal(updated.body.Email, null);
    assert.equal(updated.body.Phone, '0912345678');
    assert.equal(updated.body.GPA, 3.5);
    assert.equal(updated.body.CreateDate, created.CreateDate);
    assert.ok(updated.body.UpdateDate >= created.UpdateDate);
    assert.equal((await search('kiem thu da sua')).total, 1, 'SearchText refreshed on update');

    const deleted = await request('DELETE', `/api/students/${created.StudentID}`, { token: tokens.admin });
    assert.deepEqual(deleted.body, { deleted: 1 });
    expectError(await get(`/api/students/${created.StudentID}`, tokens.admin), 404, 'NOT_FOUND');
    expectError(await request('DELETE', `/api/students/${created.StudentID}`, { token: tokens.admin }), 404, 'NOT_FOUND');
    expectError(await get('/api/students/abc', tokens.admin), 404, 'NOT_FOUND');
  });

  it('field validation → 400 with details per JSON field name', async () => {
    const before = (await search('')).total;
    const res = await request('POST', '/api/students', {
      token: tokens.admin,
      form: studentForm({
        FullName: 'A',
        Gender: 'Nam/Nữ',
        DateOfBirth: '2001-02-30',
        ClassName: 'X'.repeat(51),
        Major: '',
        Email: 'sai-email',
        Phone: '12345',
        GPA: '4.5',
        Description: 'x'.repeat(1001),
      }),
    });
    expectError(res, 400, 'VALIDATION_ERROR');
    assert.deepEqual(
      detailFields(res),
      new Set(['FullName', 'Gender', 'DateOfBirth', 'ClassName', 'Major', 'Email', 'Phone', 'GPA', 'Description']),
    );
    for (const d of res.body.error.details) assert.equal(typeof d.message, 'string');

    const future = await request('POST', '/api/students', {
      token: tokens.admin,
      form: studentForm({ ...VALID_STUDENT, DateOfBirth: '2999-01-01' }),
    });
    expectError(future, 400, 'VALIDATION_ERROR');
    assert.deepEqual(detailFields(future), new Set(['DateOfBirth']));
    const tooOld = await request('POST', '/api/students', { token: tokens.admin, json: { ...VALID_STUDENT, DateOfBirth: '1949-12-31' } });
    expectError(tooOld, 400, 'VALIDATION_ERROR');
    assert.equal((await search('')).total, before);
  });

  it('paging: pageSize 10/15 only, page clamped to the last page, newest first', async () => {
    const last = await get('/api/students?page=999&pageSize=15', tokens.viewer);
    assert.equal(last.status, 200);
    const { total, totalPages, page, pageSize, items } = last.body;
    assert.equal(pageSize, 15);
    assert.equal(totalPages, Math.ceil(total / 15));
    assert.equal(page, totalPages);
    assert.equal(items.length, total - (totalPages - 1) * 15);

    const fallback = await get('/api/students?page=abc&pageSize=20', tokens.viewer);
    assert.equal(fallback.body.pageSize, 10);
    assert.equal(fallback.body.page, 1);
    assert.equal(fallback.body.items.length, 10);
    const ids = fallback.body.items.map((s) => s.StudentID);
    assert.deepEqual(ids, [...ids].sort((a, b) => b - a));

    const empty = await search('khong-co-ai-ten-nay', { page: 5 });
    assert.deepEqual(
      { total: empty.total, totalPages: empty.totalPages, page: empty.page, items: empty.items },
      { total: 0, totalPages: 1, page: 1, items: [] },
    );
  });

  it('search is diacritic-insensitive and matches the student code', async () => {
    const nguyen = await search('nguyen');
    assert.ok(nguyen.total >= 4);
    assert.ok(nguyen.items.some((s) => s.FullName === 'Nguyễn Văn An'));
    for (const s of nguyen.items) {
      const haystack = normalizeText([s.FullName, s.ClassName, s.Major, s.Email, s.Phone, s.Address, s.Description].join(' '));
      assert.ok(haystack.includes('nguyen'), s.FullName);
    }
    assert.deepEqual((await search('NGUYỄN VĂN AN')).items.map((s) => s.StudentID), [1]);
    assert.deepEqual((await search('sv000001')).items.map((s) => s.StudentID), [1]);
    assert.ok((await search('SV0000')).total >= 36);
    const cntt = await search('cntt-k18a');
    assert.ok(cntt.total >= 4 && cntt.items.every((s) => s.ClassName === 'CNTT-K18A'));
    assert.ok((await search('dat')).items.some((s) => s.FullName === 'Phan Văn Đạt'), 'đ → d');
    assert.equal((await search('%')).total, 0, 'LIKE wildcards are escaped');
    assert.equal((await search('_')).total, 0);
  });
});

describe('Bulk copy / delete', () => {
  it('bulk-copy → 201, new IDs, " (bản sao)" suffix, same data and image path', async () => {
    const source = await createStudent({ FullName: 'Sao Chép Nguồn' }, pngImage());
    const res = await request('POST', '/api/students/bulk-copy', { token: tokens.admin, json: { ids: [source.StudentID, 1] } });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.copied, 2);
    const [copy, copyOfFirst] = res.body.items;
    assert.equal(copy.FullName, 'Sao Chép Nguồn (bản sao)');
    assert.equal(copyOfFirst.FullName, 'Nguyễn Văn An (bản sao)');
    assert.ok(copy.StudentID > source.StudentID);
    assert.equal(copy.PathImage, source.PathImage);
    for (const f of ['Gender', 'DateOfBirth', 'ClassName', 'Major', 'Email', 'Phone', 'Address', 'GPA', 'Description']) {
      assert.deepEqual(copy[f], source[f], f);
    }
    assert.ok(copy.CreateDate >= source.CreateDate);
    assert.ok((await search('sao chep nguon (ban sao)')).total >= 1, 'copies are searchable');

    const longName = 'Nguyễn '.repeat(15).trim().slice(0, 100);
    const long = await createStudent({ FullName: longName });
    const copiedLong = await request('POST', '/api/students/bulk-copy', { token: tokens.admin, json: { ids: [long.StudentID] } });
    assert.equal(copiedLong.status, 201);
    const name = copiedLong.body.items[0].FullName;
    assert.ok([...name].length <= 100, `length ${[...name].length}`);
    assert.ok(name.endsWith(' (bản sao)'));
  });

  it('bulk-copy and bulk-delete are all-or-nothing (missing id → 404)', async () => {
    const a = await createStudent({ FullName: 'Xóa Nhiều A' });
    const b = await createStudent({ FullName: 'Xóa Nhiều B' });
    const before = (await search('')).total;

    expectError(await request('POST', '/api/students/bulk-copy', { token: tokens.admin, json: { ids: [a.StudentID, 99999999] } }), 404, 'NOT_FOUND');
    assert.equal((await search('')).total, before);

    const failed = await request('POST', '/api/students/bulk-delete', {
      token: tokens.admin,
      json: { ids: [a.StudentID, b.StudentID, 99999999] },
    });
    expectError(failed, 404, 'NOT_FOUND');
    assert.equal((await get(`/api/students/${a.StudentID}`, tokens.admin)).status, 200);
    assert.equal((await get(`/api/students/${b.StudentID}`, tokens.admin)).status, 200);
    assert.equal((await search('')).total, before);

    const ok = await request('POST', '/api/students/bulk-delete', {
      token: tokens.admin,
      json: { ids: [a.StudentID, b.StudentID, a.StudentID] },
    });
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.body, { deleted: 2 });
    assert.equal((await search('')).total, before - 2);
  });

  it('bulk ids are validated', async () => {
    for (const ids of [[], 'x', [0], [1.5], ['abc'], Array.from({ length: 1001 }, (_, i) => i + 1)]) {
      const res = await request('POST', '/api/students/bulk-delete', { token: tokens.admin, json: { ids } });
      expectError(res, 400, 'VALIDATION_ERROR');
      assert.deepEqual(detailFields(res), new Set(['ids']));
    }
    expectError(await request('POST', '/api/students/bulk-copy', { token: tokens.admin }), 400, 'VALIDATION_ERROR');
  });
});

describe('Images', () => {
  it('real PNG is stored and served; removeImage clears it; no file keeps it', async () => {
    const created = await createStudent({ FullName: 'Có Ảnh Đại Diện' }, pngImage());
    assert.match(created.PathImage, /^\/uploads\/[0-9a-f-]{36}\.png$/);
    const file = await request('GET', created.PathImage);
    assert.equal(file.status, 200);
    assert.equal(file.headers.get('content-type'), 'image/png');
    assert.ok(file.body.equals(TINY_PNG));

    const kept = await request('PUT', `/api/students/${created.StudentID}`, {
      token: tokens.admin,
      form: studentForm({ ...VALID_STUDENT, FullName: 'Vẫn Giữ Ảnh' }),
    });
    assert.equal(kept.body.PathImage, created.PathImage);

    const removed = await request('PUT', `/api/students/${created.StudentID}`, {
      token: tokens.admin,
      form: studentForm({ ...VALID_STUDENT, removeImage: '1' }),
    });
    assert.equal(removed.status, 200);
    assert.equal(removed.body.PathImage, null);
    assert.equal((await request('GET', created.PathImage)).status, 200, 'image files are never deleted');
  });

  it('fake image (text renamed to .png) → 400 FILE_ERROR, nothing created', async () => {
    const before = (await search('')).total;
    const res = await request('POST', '/api/students', {
      token: tokens.admin,
      form: studentForm(VALID_STUDENT, { buffer: Buffer.from('<?php echo "not an image"; ?>'), type: 'image/png', name: 'fake.png' }),
    });
    expectError(res, 400, 'FILE_ERROR');
    assert.deepEqual(detailFields(res), new Set(['image']));
    assert.equal((await search('')).total, before);
  });

  it('an empty file input (filename="") counts as "no image"', async () => {
    const form = studentForm({ ...VALID_STUDENT, FullName: 'Không Chọn Ảnh' });
    form.append('image', new Blob([]), '');
    const res = await request('POST', '/api/students', { token: tokens.admin, form });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.PathImage, null);
  });

  it('magic bytes: PNG, JPEG and WebP accepted, anything else refused', () => {
    const { detectImageType } = require('../src/utils/file-type');
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.from('JFIF\0'), Buffer.alloc(8)]);
    const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x24, 0, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.alloc(8)]);
    assert.deepEqual(detectImageType(TINY_PNG), { ext: 'png', mime: 'image/png' });
    assert.deepEqual(detectImageType(jpeg), { ext: 'jpg', mime: 'image/jpeg' });
    assert.deepEqual(detectImageType(webp), { ext: 'webp', mime: 'image/webp' });
    assert.equal(detectImageType(Buffer.from('GIF89a......')), null);
    assert.equal(detectImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')), null);
    assert.equal(detectImageType(TINY_PNG.subarray(0, 8)), null);
  });

  it('image larger than 5 MB → 413 FILE_ERROR', async () => {
    const big = Buffer.concat([TINY_PNG, Buffer.alloc(5 * 1024 * 1024 + 10)]);
    const res = await request('POST', '/api/students', {
      token: tokens.admin,
      form: studentForm(VALID_STUDENT, { buffer: big, type: 'image/png', name: 'big.png' }),
    });
    expectError(res, 413, 'FILE_ERROR');
  });

  it('uploads directory does not allow path traversal', async () => {
    const res = await request('GET', '/uploads/..%2fapp.db');
    assert.notEqual(res.status, 200);
  });
});

describe('Import / export', () => {
  for (const format of ['xlsx', 'json', 'xml']) {
    it(`export → import round-trip keeps every field (${format})`, async () => {
      const marker = `RT-${format.toUpperCase()}-MARK`;
      const withImage = await createStudent(
        {
          FullName: `Đỗ Thị Ánh Tuyết ${format}`,
          Description: `Dòng 1 & <b>"đậm"</b> 'nháy'\nDòng 2 ${marker}`,
          Phone: '0901234567',
          GPA: '3.5',
        },
        pngImage(),
      );
      const plain = await createStudent({
        FullName: `Lê Văn Ợ ${format}`,
        Gender: 'Khác',
        Email: '',
        Phone: '',
        Address: '',
        GPA: '',
        Description: marker,
      });

      const exported = await get(`/api/students/export?format=${format}&q=${encodeURIComponent(marker)}`, tokens.admin);
      assert.equal(exported.status, 200);
      assert.match(
        exported.headers.get('content-disposition'),
        new RegExp(`^attachment; filename="sinh-vien-\\d{8}-\\d{6}\\.${format}"$`),
      );
      assert.equal(await countExportRows(format, exported.body), 2);

      const res = await importFile(exported.body, `sinh-vien-export.${format}`);
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.deepEqual(res.body, { imported: 2 });

      const after = await search(marker);
      assert.equal(after.total, 4);
      const imported = after.items.slice(0, 2);
      for (const original of [withImage, plain]) {
        const copy = imported.find((s) => s.FullName === original.FullName);
        assert.ok(copy, `${format}: ${original.FullName} imported`);
        assert.ok(copy.StudentID > plain.StudentID);
        for (const f of STUDENT_FIELDS) assert.deepEqual(copy[f], original[f], `${format}: ${f}`);
      }
    });
  }

  it('export columns follow the API order (xlsx header, json keys)', async () => {
    const xlsx = await get('/api/students/export?format=xlsx&q=sv000001', tokens.giangvien);
    assert.equal(xlsx.status, 200);
    assert.equal(xlsx.headers.get('content-type'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(xlsx.body);
    assert.deepEqual(workbook.getWorksheet('Students').getRow(1).values.slice(1), API_FIELD_ORDER);
    const json = await get('/api/students/export?format=json&q=sv000001', tokens.giangvien);
    const rows = JSON.parse(json.body.toString('utf8'));
    assert.deepEqual(Object.keys(rows[0]), API_FIELD_ORDER);
    expectError(await get('/api/students/export?format=csv', tokens.admin), 400, 'VALIDATION_ERROR');
  });

  it('templates (xlsx/json/xml) download and import their 2 example rows', async () => {
    for (const format of ['xlsx', 'json', 'xml']) {
      const template = await get(`/api/students/template?format=${format}`, tokens.giaovu);
      assert.equal(template.status, 200);
      assert.equal(template.headers.get('content-disposition'), `attachment; filename="mau-nhap-sinh-vien.${format}"`);
      const res = await importFile(template.body, `mau-nhap-sinh-vien.${format}`, tokens.giaovu);
      assert.equal(res.status, 201, `${format}: ${JSON.stringify(res.body)}`);
      assert.deepEqual(res.body, { imported: 2 });
    }
    expectError(await get('/api/students/template?format=xlsx', tokens.giangvien), 403, 'FORBIDDEN');
  });

  it('JSON import with invalid rows → 400 with { row, field } details and nothing inserted', async () => {
    const records = [
      { FullName: 'Nhập Hợp Lệ', Gender: 'Nam', DateOfBirth: '2001-01-01', ClassName: 'IMP-ERR', Major: 'CNTT' },
      { FullName: 'X', Gender: 'Nam', DateOfBirth: '2001-02-30', ClassName: 'IMP-ERR', Major: 'CNTT', Email: 'sai', PathImage: '/uploads/khong-co.png' },
      { Gender: 'Không rõ', DateOfBirth: '2001-01-01', ClassName: 'IMP-ERR', Major: 'CNTT', GPA: 5 },
      'không phải đối tượng',
    ];
    const res = await importFile(Buffer.from(JSON.stringify({ Students: records })), 'loi.json');
    expectError(res, 400, 'VALIDATION_ERROR');
    const pairs = new Set(res.body.error.details.map((d) => `${d.row}:${d.field}`));
    for (const expected of ['2:FullName', '2:DateOfBirth', '2:Email', '2:PathImage', '3:FullName', '3:Gender', '3:GPA', '4:null']) {
      assert.ok(pairs.has(expected), `missing ${expected} in ${[...pairs].join(', ')}`);
    }
    assert.ok(![...pairs].some((p) => p.startsWith('1:')), 'row 1 is valid');
    assert.equal((await search('imp-err')).total, 0, 'nothing inserted');
  });

  it('Excel import: Excel row numbers, formula cells rejected, date cells and numeric phones converted', async () => {
    const header = ['FullName', 'Gender', 'DateOfBirth', 'ClassName', 'Major', 'Phone', 'GPA', 'Email'];
    const bad = await xlsxBuffer((wb) => {
      const ws = wb.addWorksheet('Students');
      ws.addRow(header);
      ws.addRow(['Excel Hợp Lệ', 'Nam', new Date(Date.UTC(2002, 0, 15)), 'XLS-01', 'CNTT', 912345678, 3.2]);
      ws.addRow(['Excel Sai Giới Tính', 'Không rõ', '2002-01-15', 'XLS-01', 'CNTT', null, null]);
      ws.addRow([{ formula: 'CONCAT("A","B")', result: 'AB' }, 'Nữ', '15/01/2002', 'XLS-01', 'CNTT', null, null]);
    });
    const res = await importFile(bad, 'loi.xlsx');
    expectError(res, 400, 'VALIDATION_ERROR');
    const pairs = res.body.error.details.map((d) => `${d.row}:${d.field}`);
    assert.ok(pairs.includes('3:Gender'), pairs.join(', '));
    assert.ok(pairs.includes('4:FullName'), pairs.join(', '));
    assert.ok(!pairs.some((p) => p.startsWith('2:')), pairs.join(', '));
    assert.equal((await search('xls-01')).total, 0);

    const good = await xlsxBuffer((wb) => {
      wb.addWorksheet('Ghi chú').addRow(['sheet phụ, bị bỏ qua']);
      const ws = wb.addWorksheet('Students');
      ws.addRow(header);
      ws.addRow(['Excel Ngày Kiểu Date', 'Nam', new Date(Date.UTC(2002, 0, 15)), 'XLS-01', 'CNTT', 912345678, 3.2]);
      ws.addRow([]);
      ws.addRow([
        { richText: [{ text: 'Excel ' }, { text: 'Rich Text', font: { bold: true } }] },
        'nữ',
        '05/03/2003',
        'XLS-01',
        'CNTT',
        '0987 654 321',
        '2,75',
        { text: 'lien.ket@example.com', hyperlink: 'mailto:lien.ket@example.com' },
      ]);
    });
    const ok = await importFile(good, 'tot.XLSX');
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    assert.deepEqual(ok.body, { imported: 2 });
    const rows = (await search('xls-01')).items;
    const first = rows.find((s) => s.FullName === 'Excel Ngày Kiểu Date');
    assert.equal(first.DateOfBirth, '2002-01-15');
    assert.equal(first.Phone, '0912345678');
    const second = rows.find((s) => s.FullName === 'Excel Rich Text');
    assert.equal(second.Gender, 'Nữ');
    assert.equal(second.DateOfBirth, '2003-03-05');
    assert.equal(second.Phone, '0987654321');
    assert.equal(second.GPA, 2.75);
    assert.equal(second.Email, 'lien.ket@example.com', 'hyperlink cell → plain text');
  });

  it('XML with DOCTYPE / ENTITY → 400 FILE_ERROR; wrong structure → 400 FILE_ERROR', async () => {
    const xxe = `<?xml version="1.0"?>
<!DOCTYPE Students [ <!ENTITY xxe SYSTEM "file:///etc/passwd"> ]>
<Students><Student><FullName>&xxe;</FullName><Gender>Nam</Gender><DateOfBirth>2001-01-01</DateOfBirth><ClassName>XML</ClassName><Major>CNTT</Major></Student></Students>`;
    expectError(await importFile(Buffer.from(xxe), 'xxe.xml'), 400, 'FILE_ERROR');
    const bomb = '<?xml version="1.0"?><!ENTITY a "aaaa"><Students/>';
    expectError(await importFile(Buffer.from(bomb), 'bomb.xml'), 400, 'FILE_ERROR');
    expectError(await importFile(Buffer.from('<Root><Student/></Root>'), 'sai.xml'), 400, 'FILE_ERROR');
    expectError(await importFile(Buffer.from('<Students><Student>'), 'hong.xml'), 400, 'FILE_ERROR');

    const ok = `<?xml version="1.0" encoding="UTF-8"?>
<Students><Student><FullName>Ph&#7841;m &amp; Con</FullName><Gender>Nữ</Gender><DateOfBirth>2001-01-01</DateOfBirth>
<ClassName>XML-OK</ClassName><Major>CNTT</Major><GPA>03.10</GPA><Email/></Student></Students>`;
    const res = await importFile(Buffer.from(ok), 'ok.xml');
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const [row] = (await search('xml-ok')).items;
    assert.equal(row.FullName, 'Phạm & Con');
    assert.equal(row.GPA, 3.1);
    assert.equal(row.Email, null);
  });

  it('rejects unsupported, empty, oversized and too-long files', async () => {
    expectError(await importFile(Buffer.from('a,b'), 'sinh-vien.csv'), 400, 'FILE_ERROR');
    expectError(await importFile(Buffer.from('[]'), 'rong.json'), 400, 'FILE_ERROR');
    expectError(await importFile(Buffer.from('{"a":'), 'hong.json'), 400, 'FILE_ERROR');
    expectError(await importFile(Buffer.from('not a zip'), 'gia.xlsx'), 400, 'FILE_ERROR');
    const many = Array.from({ length: 1001 }, (_, i) => ({ FullName: `Sinh Viên ${i}`, Gender: 'Nam', DateOfBirth: '2001-01-01', ClassName: 'MANY', Major: 'CNTT' }));
    expectError(await importFile(Buffer.from(JSON.stringify(many)), 'nhieu.json'), 400, 'FILE_ERROR');
    expectError(await importFile(Buffer.alloc(10 * 1024 * 1024 + 1, 0x20), 'lon.json'), 413, 'FILE_ERROR');
    expectError(await request('POST', '/api/students/import', { token: tokens.admin, form: new FormData() }), 400, 'FILE_ERROR');
    expectError(await importFile(Buffer.from('[]'), 'x.json', tokens.giangvien), 403, 'FORBIDDEN');
  });
});

describe('HTTP basics', () => {
  it('unknown /api route → 404 JSON; X-User on authenticated responses', async () => {
    const res = await get('/api/khong-ton-tai', tokens.admin);
    expectError(res, 404, 'NOT_FOUND');
    const nested = await get('/api/students/1/khong-co', tokens.viewer);
    expectError(nested, 404, 'NOT_FOUND');
    assert.equal(nested.headers.get('x-user'), 'viewer');
    for (const url of ['/api/students', '/api/students/1', '/api/auth/me']) {
      assert.equal((await get(url, tokens.giaovu)).headers.get('x-user'), 'giaovu', url);
    }
    assert.equal((await get('/api/users', tokens.admin)).headers.get('cache-control'), 'no-store');
  });

  it('malformed JSON → 400, body over 1 MB → 413', async () => {
    const malformed = await request('POST', '/api/students/bulk-delete', {
      token: tokens.admin,
      body: '{"ids": [1,',
      headers: { 'content-type': 'application/json' },
    });
    expectError(malformed, 400, 'VALIDATION_ERROR');
    const huge = await request('POST', '/api/students/bulk-delete', {
      token: tokens.admin,
      body: JSON.stringify({ ids: [1], pad: 'x'.repeat(1024 * 1024 + 10) }),
      headers: { 'content-type': 'application/json' },
    });
    expectError(huge, 413, 'FILE_ERROR');
  });
});
