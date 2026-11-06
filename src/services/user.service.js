'use strict';

const { transaction } = require('../db');
const { validationError, notFound, conflict } = require('../utils/http-error');
const { nowIso } = require('../utils/date');
const { hashPassword } = require('../utils/password');
const { parseId, validateUserCreate, validateUserUpdate } = require('../utils/validators');
const { parsePageNumber, parsePageSizeInRange, resolvePage, parseSearchQuery } = require('../utils/pagination');
const { toUserDto } = require('./mappers');

const NOT_FOUND_MESSAGE = 'Không tìm thấy người dùng.';
const SQLITE_CONSTRAINT_UNIQUE = 2067;
const SQLITE_CONSTRAINT_FOREIGNKEY = 787;

const roleNotFound = () => validationError([{ field: 'RoleID', message: 'Vai trò không tồn tại.' }]);

function createUserService({ db, userRepository, roleRepository, config }) {
  const repo = userRepository;

  function requireId(value) {
    const id = parseId(value);
    if (!id) throw notFound(NOT_FOUND_MESSAGE);
    return id;
  }

  function list(query = {}) {
    const q = parseSearchQuery(query.q, config.limits.searchMaxLength);
    const pageSize = parsePageSizeInRange(query.pageSize, { min: 1, max: 100, fallback: 10 });
    const total = repo.count({ q });
    const paging = resolvePage({ page: parsePageNumber(query.page), pageSize, total });
    const items = repo.findPage({ q, limit: pageSize, offset: paging.offset }).map(toUserDto);
    return { items, page: paging.page, pageSize, total, totalPages: paging.totalPages };
  }

  function getById(idParam) {
    const row = repo.findById(requireId(idParam));
    if (!row) throw notFound(NOT_FOUND_MESSAGE);
    return toUserDto(row);
  }

  async function create(body) {
    const { value, errors } = validateUserCreate(body);
    if (value.RoleID && !roleRepository.findById(value.RoleID)) {
      errors.push({ field: 'RoleID', message: 'Vai trò không tồn tại.' });
    }
    if (errors.length > 0) throw validationError(errors);
    const duplicate = () => conflict(`Tên đăng nhập "${value.Username}" đã tồn tại.`);
    if (repo.findByUsername(value.Username)) throw duplicate();

    const passwordHash = await hashPassword(value.Password);
    try {
      const id = repo.insert({
        Username: value.Username,
        PasswordHash: passwordHash,
        FullName: value.FullName,
        Email: value.Email,
        RoleID: value.RoleID,
        IsActive: value.IsActive,
        CreateDate: nowIso(),
      });
      return toUserDto(repo.findById(id));
    } catch (err) {
      // Another request may have won the race while the password was being hashed.
      if (err && err.errcode === SQLITE_CONSTRAINT_UNIQUE) throw duplicate();
      if (err && err.errcode === SQLITE_CONSTRAINT_FOREIGNKEY) throw roleNotFound();
      throw err;
    }
  }

  /**
   * Partial update (omitted fields keep their values). Password present and non-empty = reset.
   * Rules: you cannot lock yourself or change your own role; the last active admin cannot be
   * locked or moved to a non-system role.
   */
  async function update(idParam, body, currentUser) {
    const id = requireId(idParam);
    const { value, errors } = validateUserUpdate(body);
    if (errors.length > 0) throw validationError(errors);
    if (!repo.findById(id)) throw notFound(NOT_FOUND_MESSAGE);

    const passwordHash = value.Password ? await hashPassword(value.Password) : null;

    return transaction(db, () => {
      const current = repo.findById(id);
      if (!current) throw notFound(NOT_FOUND_MESSAGE);
      const next = {
        FullName: value.FullName !== undefined ? value.FullName : current.FullName,
        Email: value.Email !== undefined ? value.Email : current.Email,
        RoleID: value.RoleID !== undefined ? value.RoleID : current.RoleID,
        IsActive: value.IsActive !== undefined ? value.IsActive : current.IsActive === 1,
      };

      const isSelf = Boolean(currentUser) && currentUser.UserID === id;
      if (isSelf && !next.IsActive) throw conflict('Bạn không thể tự khóa tài khoản của mình.');
      if (isSelf && next.RoleID !== current.RoleID) throw conflict('Bạn không thể tự thay đổi vai trò của mình.');

      const nextRole = next.RoleID === current.RoleID ? { IsSystem: current.RoleIsSystem } : roleRepository.findById(next.RoleID);
      if (!nextRole) throw roleNotFound();

      const losesAdmin = current.RoleIsSystem === 1 && current.IsActive === 1 && (!next.IsActive || nextRole.IsSystem !== 1);
      if (losesAdmin && repo.countActiveSystemUsers({ excludeUserId: id }) === 0) {
        throw conflict('Hệ thống phải còn ít nhất một quản trị viên đang hoạt động.');
      }

      const now = nowIso();
      repo.update(id, { ...next, UpdateDate: now });
      if (passwordHash) repo.updatePassword(id, passwordHash, now);
      return toUserDto(repo.findById(id));
    });
  }

  function remove(idParam, currentUser) {
    const id = requireId(idParam);
    if (currentUser && currentUser.UserID === id) throw conflict('Bạn không thể xóa tài khoản của chính mình.');
    return transaction(db, () => {
      const user = repo.findById(id);
      if (!user) throw notFound(NOT_FOUND_MESSAGE);
      if (user.RoleIsSystem === 1 && user.IsActive === 1 && repo.countActiveSystemUsers({ excludeUserId: id }) === 0) {
        throw conflict('Không thể xóa quản trị viên đang hoạt động cuối cùng.');
      }
      repo.deleteById(id);
      return { deleted: 1 };
    });
  }

  return { list, getById, create, update, remove };
}

module.exports = { createUserService };
