'use strict';

const { describePermission } = require('../constants/permissions');
const { unauthorized, forbidden } = require('../utils/http-error');

const BEARER_RE = /^Bearer\s+(\S+)\s*$/i;

/**
 * authenticate: verifies the bearer token, reloads user + permissions from the DB on every
 * request and sets `X-User: <username>` (logged by Nginx).
 * authorize(...codes): passes when the user has at least one of the codes, else 403 FORBIDDEN.
 */
function createAuthMiddleware({ authService }) {
  function authenticate(req, res, next) {
    const match = BEARER_RE.exec(req.get('authorization') || '');
    if (!match) return next(unauthorized());
    let session;
    try {
      session = authService.authenticate(match[1]);
    } catch (err) {
      return next(err);
    }
    req.auth = {
      user: session.user,
      permissions: session.permissions,
      permissionSet: new Set(session.permissions),
    };
    res.set('X-User', session.user.Username);
    return next();
  }

  function authorize(...codes) {
    if (codes.length === 0) throw new Error('authorize() needs at least one permission code');
    const message =
      codes.length === 1
        ? `Bạn không có quyền ${describePermission(codes[0])}.`
        : `Bạn không có quyền truy cập chức năng này (cần một trong các quyền: ${codes.join(', ')}).`;
    return function authorizeMiddleware(req, res, next) {
      if (!req.auth) return next(unauthorized());
      if (codes.some((code) => req.auth.permissionSet.has(code))) return next();
      return next(forbidden(message, codes[0]));
    };
  }

  return { authenticate, authorize };
}

module.exports = { createAuthMiddleware };
