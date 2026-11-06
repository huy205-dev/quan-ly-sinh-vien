'use strict';

const { validationError, unauthorized, accountLocked } = require('../utils/http-error');
const { signJwt, verifyJwt } = require('../utils/jwt');
const { verifyPassword, getDummyHash } = require('../utils/password');
const { nowIso } = require('../utils/date');
const { parseId, validateLogin } = require('../utils/validators');
const { toUserDto } = require('./mappers');

function createAuthService({ userRepository, roleService, jwtSecret, tokenTtlSeconds }) {
  function buildSession(row) {
    return { user: toUserDto(row), permissions: roleService.getPermissionsForRole(row.RoleID, row.RoleIsSystem) };
  }

  /**
   * POST /api/auth/login. Wrong username or password → 401 (same message, same scrypt cost);
   * correct password on a locked account → 403 ACCOUNT_LOCKED.
   */
  async function login(body) {
    const { value, errors } = validateLogin(body);
    if (errors.length > 0) throw validationError(errors);

    const credentials = userRepository.findCredentials(value.username);
    const passwordOk = await verifyPassword(value.password, credentials ? credentials.PasswordHash : getDummyHash());
    if (!credentials || !passwordOk) throw unauthorized('Tên đăng nhập hoặc mật khẩu không đúng.');
    if (credentials.IsActive !== 1) throw accountLocked();

    userRepository.updateLastLogin(credentials.UserID, nowIso());
    const session = buildSession(userRepository.findById(credentials.UserID));
    const token = signJwt({ sub: credentials.UserID }, jwtSecret, { expiresInSeconds: tokenTtlSeconds });
    return { token, ...session };
  }

  /**
   * Verifies a bearer token and reloads the user + role permissions from the database,
   * so permission changes and locking apply on the very next request.
   */
  function authenticate(token) {
    let payload;
    try {
      payload = verifyJwt(token, jwtSecret);
    } catch (err) {
      throw unauthorized(
        err && err.reason === 'expired'
          ? 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'
          : 'Phiên đăng nhập không hợp lệ. Vui lòng đăng nhập lại.',
      );
    }
    const userId = parseId(payload.sub);
    const row = userId ? userRepository.findById(userId) : null;
    if (!row) throw unauthorized('Tài khoản không còn tồn tại. Vui lòng đăng nhập lại.');
    if (row.IsActive !== 1) throw unauthorized('Tài khoản đã bị khóa. Vui lòng liên hệ quản trị viên.');
    return buildSession(row);
  }

  return { login, authenticate };
}

module.exports = { createAuthService };
