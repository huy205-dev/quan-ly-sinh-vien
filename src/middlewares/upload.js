'use strict';

const multer = require('multer');

const { fileError, HttpError } = require('../utils/http-error');

/** Maps multer / busboy errors to the API error format (size → 413 FILE_ERROR). */
function toUploadError(err, { fieldName, maxSizeLabel }) {
  if (err instanceof HttpError) return err;
  if (err instanceof multer.MulterError) {
    switch (err.code) {
      case 'LIMIT_FILE_SIZE': {
        const message = maxSizeLabel
          ? `File vượt quá dung lượng cho phép (tối đa ${maxSizeLabel}).`
          : 'File vượt quá dung lượng cho phép.';
        return fileError(message, { status: 413, details: [{ field: err.field || fieldName, message }] });
      }
      case 'LIMIT_UNEXPECTED_FILE':
      case 'LIMIT_FILE_COUNT':
        return fileError(`Chỉ được gửi một file trong trường "${fieldName}".`);
      default:
        return fileError('Dữ liệu biểu mẫu không hợp lệ hoặc vượt quá giới hạn cho phép.');
    }
  }
  return fileError('Dữ liệu tải lên không hợp lệ.');
}

/**
 * Single-file multipart parser kept in memory (multer.memoryStorage). Requests that are not
 * multipart/form-data pass through untouched (JSON bodies are handled by express.json).
 */
function singleFileUpload({ fieldName, maxFileSize, maxSizeLabel, maxFields = 30 }) {
  const middleware = multer({
    storage: multer.memoryStorage(),
    defParamCharset: 'utf8',
    limits: {
      fileSize: maxFileSize,
      files: 1,
      fields: maxFields,
      fieldSize: 64 * 1024,
      parts: maxFields + 1,
    },
  }).single(fieldName);

  return function uploadMiddleware(req, res, next) {
    middleware(req, res, (err) => (err ? next(toUploadError(err, { fieldName, maxSizeLabel })) : next()));
  };
}

function createUploadMiddleware(config) {
  const { limits } = config;
  return {
    imageUpload: singleFileUpload({
      fieldName: 'image',
      maxFileSize: limits.imageFileSize,
      maxSizeLabel: limits.imageFileSizeLabel,
    }),
    importUpload: singleFileUpload({
      fieldName: 'file',
      maxFileSize: limits.importFileSize,
      maxSizeLabel: limits.importFileSizeLabel,
      maxFields: 5,
    }),
  };
}

module.exports = { createUploadMiddleware, toUploadError };
