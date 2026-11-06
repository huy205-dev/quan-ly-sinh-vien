'use strict';

const multer = require('multer');

const { HttpError, ERROR_CODES, validationError, fileError, notFound, conflict, internalError } = require('../utils/http-error');
const { toUploadError } = require('./upload');

const SQLITE_UNIQUE = new Set([2067, 1555]); // SQLITE_CONSTRAINT_UNIQUE, SQLITE_CONSTRAINT_PRIMARYKEY
const SQLITE_FOREIGN_KEY = 787;

const CODE_BY_STATUS = {
  400: ERROR_CODES.VALIDATION_ERROR,
  401: ERROR_CODES.UNAUTHORIZED,
  403: ERROR_CODES.FORBIDDEN,
  404: ERROR_CODES.NOT_FOUND,
  409: ERROR_CODES.CONFLICT,
  413: ERROR_CODES.FILE_ERROR,
};

/** Normalizes any thrown value into an HttpError. */
function toHttpError(err, { jsonLimitLabel = '1 MB' } = {}) {
  if (err instanceof HttpError) return err;
  // Normally converted by middlewares/upload.js already; kept as a safety net.
  if (err instanceof multer.MulterError) return toUploadError(err, { fieldName: err.field || 'file', maxSizeLabel: null });

  if (err && typeof err === 'object') {
    // body-parser (express.json)
    if (err.type === 'entity.too.large') {
      return fileError(`Dữ liệu gửi lên vượt quá giới hạn cho phép (${jsonLimitLabel}).`, { status: 413 });
    }
    if (err.type === 'entity.parse.failed') return validationError(undefined, 'Dữ liệu JSON gửi lên không đúng cú pháp.');

    // node:sqlite constraint errors that slipped past service checks
    if (err.code === 'ERR_SQLITE_ERROR') {
      if (SQLITE_UNIQUE.has(err.errcode)) return conflict('Dữ liệu bị trùng với một bản ghi đã có.');
      if (err.errcode === SQLITE_FOREIGN_KEY) return conflict('Dữ liệu đang được tham chiếu hoặc tham chiếu không tồn tại.');
    }

    // Other client errors carrying an HTTP status (malformed URL, unsupported charset, …)
    const status = Number(err.status || err.statusCode);
    if (Number.isInteger(status) && status >= 400 && status < 500) {
      if (status === 404) return notFound('Không tìm thấy tài nguyên.');
      return new HttpError(status, CODE_BY_STATUS[status] || ERROR_CODES.VALIDATION_ERROR, 'Yêu cầu không hợp lệ.');
    }
  }
  return internalError();
}

function createErrorHandler({ jsonLimitLabel, logger = console } = {}) {
  // Express recognizes error handlers by their 4 parameters.
  // eslint-disable-next-line no-unused-vars
  return function errorHandler(err, req, res, next) {
    if (res.headersSent) return next(err);
    const httpError = toHttpError(err, { jsonLimitLabel });
    if (httpError.status >= 500) logger.error(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`, err);
    return res.status(httpError.status).json(httpError.toJSON());
  };
}

/** Unknown /api/* routes → 404 NOT_FOUND (JSON). */
function apiNotFound(req, res, next) {
  next(notFound(`Không tìm thấy API: ${req.method} ${req.originalUrl.split('?')[0]}`));
}

module.exports = { createErrorHandler, apiNotFound, toHttpError };
