'use strict';

/**
 * API error rendered as { error: { code, message, details?, permission? } }.
 */
class HttpError extends Error {
  constructor(status, code, message, { details, permission } = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    if (details !== undefined) this.details = details;
    if (permission !== undefined) this.permission = permission;
  }

  toJSON() {
    const error = { code: this.code, message: this.message };
    if (this.permission !== undefined) error.permission = this.permission;
    if (this.details !== undefined) error.details = this.details;
    return { error };
  }
}

const ERROR_CODES = Object.freeze({
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  FILE_ERROR: 'FILE_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
});

function validationError(details, message = 'Dữ liệu không hợp lệ. Vui lòng kiểm tra lại các trường được đánh dấu.') {
  return new HttpError(400, ERROR_CODES.VALIDATION_ERROR, message, { details });
}

function fileError(message, { status = 400, details } = {}) {
  return new HttpError(status, ERROR_CODES.FILE_ERROR, message, { details });
}

function unauthorized(message = 'Bạn chưa đăng nhập hoặc phiên đăng nhập không hợp lệ.') {
  return new HttpError(401, ERROR_CODES.UNAUTHORIZED, message);
}

function forbidden(message, permission) {
  return new HttpError(403, ERROR_CODES.FORBIDDEN, message, { permission });
}

function accountLocked(message = 'Tài khoản đã bị khóa. Vui lòng liên hệ quản trị viên.') {
  return new HttpError(403, ERROR_CODES.ACCOUNT_LOCKED, message);
}

function notFound(message = 'Không tìm thấy dữ liệu.', details) {
  return new HttpError(404, ERROR_CODES.NOT_FOUND, message, { details });
}

function conflict(message) {
  return new HttpError(409, ERROR_CODES.CONFLICT, message);
}

function internalError(message = 'Đã xảy ra lỗi hệ thống. Vui lòng thử lại sau.') {
  return new HttpError(500, ERROR_CODES.INTERNAL_ERROR, message);
}

module.exports = {
  HttpError,
  ERROR_CODES,
  validationError,
  fileError,
  unauthorized,
  forbidden,
  accountLocked,
  notFound,
  conflict,
  internalError,
};
