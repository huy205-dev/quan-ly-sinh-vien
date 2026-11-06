'use strict';

const { ACTIONS, MODULES, ALL_PERMISSION_CODES, getPermission, sortPermissionCodes } = require('../constants/permissions');
const { transaction } = require('../db');
const { validationError, notFound, conflict } = require('../utils/http-error');
const { nowIso } = require('../utils/date');
const { parseId, validateRoleCreate, validateRoleUpdate } = require('../utils/validators');
const { toRoleDto } = require('./mappers');

const NOT_FOUND_MESSAGE = 'Không tìm thấy vai trò.';

function createRoleService({ db, roleRepository }) {
  const repo = roleRepository;

  function requireId(value) {
    const id = parseId(value);
    if (!id) throw notFound(NOT_FOUND_MESSAGE);
    return id;
  }

  /** Effective permissions: system roles always have ALL, others what is stored (catalog order). */
  function resolvePermissions(isSystem, storedCodes) {
    return isSystem === 1 ? [...ALL_PERMISSION_CODES] : sortPermissionCodes(storedCodes);
  }

  function getPermissionsForRole(roleId, isSystem) {
    return isSystem === 1 ? [...ALL_PERMISSION_CODES] : sortPermissionCodes(repo.findPermissionCodes(roleId));
  }

  function loadDto(id) {
    const row = repo.findById(id);
    if (!row) throw notFound(NOT_FOUND_MESSAGE);
    return toRoleDto(row, getPermissionsForRole(row.RoleID, row.IsSystem));
  }

  /** GET /api/permissions — matrix columns + modules with their permissions. */
  function getCatalog() {
    return {
      actions: ACTIONS.map((a) => ({ action: a.action, name: a.name })),
      modules: MODULES.map((m) => ({
        module: m.module,
        name: m.name,
        permissions: m.permissions.map((p) => {
          const info = getPermission(`${m.module}.${p.action}`);
          return { code: info.code, action: info.action, name: info.name, description: info.description };
        }),
      })),
    };
  }

  function list() {
    const stored = repo.findAllPermissionCodes();
    return {
      items: repo.findAll().map((row) => toRoleDto(row, resolvePermissions(row.IsSystem, stored.get(row.RoleID) || []))),
    };
  }

  function getById(idParam) {
    return loadDto(requireId(idParam));
  }

  function options() {
    return { items: repo.findOptions().map((r) => ({ RoleID: r.RoleID, Code: r.Code, Name: r.Name })) };
  }

  function create(body) {
    const { value, errors } = validateRoleCreate(body);
    if (errors.length > 0) throw validationError(errors);
    return transaction(db, () => {
      if (repo.findByCode(value.Code)) throw conflict(`Mã vai trò "${value.Code}" đã tồn tại.`);
      const id = repo.insert({ Code: value.Code, Name: value.Name, Description: value.Description, IsSystem: 0, CreateDate: nowIso() });
      repo.replacePermissions(id, value.Permissions);
      return loadDto(id);
    });
  }

  /** Partial update of Name / Description / Permissions. System roles keep ALL permissions (409 otherwise). */
  function update(idParam, body) {
    const id = requireId(idParam);
    const { value, errors } = validateRoleUpdate(body);
    if (errors.length > 0) throw validationError(errors);
    return transaction(db, () => {
      const role = repo.findById(id);
      if (!role) throw notFound(NOT_FOUND_MESSAGE);
      if (role.IsSystem === 1 && value.Permissions !== undefined) {
        const requested = new Set(value.Permissions);
        const isAll = requested.size === ALL_PERMISSION_CODES.length && ALL_PERMISSION_CODES.every((c) => requested.has(c));
        if (!isAll) {
          throw conflict('Vai trò hệ thống luôn có toàn bộ quyền. Không thể thay đổi phân quyền của vai trò này.');
        }
      }
      repo.update(id, {
        Name: value.Name !== undefined ? value.Name : role.Name,
        Description: value.Description !== undefined ? value.Description : role.Description,
        UpdateDate: nowIso(),
      });
      if (role.IsSystem !== 1 && value.Permissions !== undefined) repo.replacePermissions(id, value.Permissions);
      return loadDto(id);
    });
  }

  function remove(idParam) {
    const id = requireId(idParam);
    return transaction(db, () => {
      const role = repo.findById(id);
      if (!role) throw notFound(NOT_FOUND_MESSAGE);
      if (role.IsSystem === 1) throw conflict('Không thể xóa vai trò hệ thống.');
      if (role.UserCount > 0) {
        throw conflict(`Không thể xóa vai trò "${role.Name}" vì đang được gán cho ${role.UserCount} người dùng.`);
      }
      repo.deleteById(id);
      return { deleted: 1 };
    });
  }

  return { getCatalog, list, getById, options, create, update, remove, getPermissionsForRole };
}

module.exports = { createRoleService };
