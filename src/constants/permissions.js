'use strict';

/**
 * Permission catalog ("functions that need permission").
 * Code format: `module.action`. The Permissions table is synced from this file on startup.
 */

/** Action columns of the permission matrix, in display order. */
const ACTIONS = Object.freeze([
  { action: 'read', name: 'Xem' },
  { action: 'create', name: 'Thêm' },
  { action: 'update', name: 'Sửa' },
  { action: 'delete', name: 'Xóa' },
  { action: 'import', name: 'Nhập file' },
  { action: 'export', name: 'Xuất file' },
]);

const MODULES = Object.freeze([
  {
    module: 'student',
    name: 'Sinh viên',
    permissions: [
      { action: 'read', description: 'Xem danh sách, xem chi tiết và tìm kiếm sinh viên' },
      { action: 'create', description: 'Thêm mới, sao chép một hoặc nhiều sinh viên' },
      { action: 'update', description: 'Cập nhật thông tin sinh viên' },
      { action: 'delete', description: 'Xóa một hoặc nhiều sinh viên' },
      { action: 'import', description: 'Nhập sinh viên từ file, tải file mẫu' },
      { action: 'export', description: 'Xuất danh sách sinh viên ra file' },
    ],
  },
  {
    module: 'user',
    name: 'Người dùng',
    permissions: [
      { action: 'read', description: 'Xem danh sách và chi tiết người dùng' },
      { action: 'create', description: 'Thêm người dùng' },
      { action: 'update', description: 'Sửa người dùng, đặt lại mật khẩu, khóa/mở khóa tài khoản' },
      { action: 'delete', description: 'Xóa người dùng' },
    ],
  },
  {
    module: 'role',
    name: 'Vai trò & phân quyền',
    permissions: [
      { action: 'read', description: 'Xem vai trò và danh mục quyền' },
      { action: 'create', description: 'Thêm vai trò' },
      { action: 'update', description: 'Đổi tên vai trò, gán quyền' },
      { action: 'delete', description: 'Xóa vai trò' },
    ],
  },
]);

const ACTION_NAMES = new Map(ACTIONS.map((a) => [a.action, a.name]));

/** Flat list: [{ code, module, moduleName, action, name, description }] in catalog order. */
const PERMISSIONS = Object.freeze(
  MODULES.flatMap((m) =>
    m.permissions.map((p) =>
      Object.freeze({
        code: `${m.module}.${p.action}`,
        module: m.module,
        moduleName: m.name,
        action: p.action,
        name: ACTION_NAMES.get(p.action),
        description: p.description,
      }),
    ),
  ),
);

const ALL_PERMISSION_CODES = Object.freeze(PERMISSIONS.map((p) => p.code));
const PERMISSION_BY_CODE = new Map(PERMISSIONS.map((p) => [p.code, p]));
const CATALOG_ORDER = new Map(ALL_PERMISSION_CODES.map((code, index) => [code, index]));

/** Named constants for route guards. */
const PERMISSION = Object.freeze({
  STUDENT_READ: 'student.read',
  STUDENT_CREATE: 'student.create',
  STUDENT_UPDATE: 'student.update',
  STUDENT_DELETE: 'student.delete',
  STUDENT_IMPORT: 'student.import',
  STUDENT_EXPORT: 'student.export',
  USER_READ: 'user.read',
  USER_CREATE: 'user.create',
  USER_UPDATE: 'user.update',
  USER_DELETE: 'user.delete',
  ROLE_READ: 'role.read',
  ROLE_CREATE: 'role.create',
  ROLE_UPDATE: 'role.update',
  ROLE_DELETE: 'role.delete',
});

function isKnownPermission(code) {
  return PERMISSION_BY_CODE.has(code);
}

function getPermission(code) {
  return PERMISSION_BY_CODE.get(code) || null;
}

/** Removes unknown codes and duplicates, then sorts by catalog order. */
function sortPermissionCodes(codes) {
  return [...new Set(codes)]
    .filter((code) => CATALOG_ORDER.has(code))
    .sort((a, b) => CATALOG_ORDER.get(a) - CATALOG_ORDER.get(b));
}

/** Vietnamese label such as "xóa sinh viên" for use in error messages. */
function describePermission(code) {
  const p = getPermission(code);
  if (!p) return code;
  return `${p.name.toLowerCase()} ${p.moduleName.toLowerCase()}`;
}

module.exports = {
  ACTIONS,
  MODULES,
  PERMISSIONS,
  ALL_PERMISSION_CODES,
  PERMISSION,
  isKnownPermission,
  getPermission,
  sortPermissionCodes,
  describePermission,
};
