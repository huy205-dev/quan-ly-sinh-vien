'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const { detectImageType } = require('../utils/file-type');
const { fileError } = require('../utils/http-error');

const PUBLIC_PREFIX = '/uploads/';
const SAFE_NAME_RE = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,199}$/;

/**
 * Student images: content check by magic bytes, storage as uploads/<uuid>.<ext>.
 * Files are never deleted when a student changes (copies share the same path),
 * except to clean up a file written by a request that then failed.
 */
function createImageService({ uploadDir }) {
  const root = path.resolve(uploadDir);

  function imageError(message) {
    return fileError(message, { details: [{ field: 'image', message }] });
  }

  /** Validates an uploaded multer file. Returns { buffer, ext } or throws 400 FILE_ERROR. */
  function inspect(file) {
    if (!file || !Buffer.isBuffer(file.buffer) || file.buffer.length === 0) {
      throw imageError('File ảnh rỗng hoặc không đọc được.');
    }
    const type = detectImageType(file.buffer);
    if (!type) {
      throw imageError('File ảnh không hợp lệ. Chỉ chấp nhận ảnh PNG, JPEG hoặc WebP.');
    }
    return { buffer: file.buffer, ext: type.ext };
  }

  /** Writes the image and returns its public path "/uploads/<uuid>.<ext>". */
  async function save({ buffer, ext }) {
    const name = `${crypto.randomUUID()}.${ext}`;
    await fs.promises.mkdir(root, { recursive: true });
    await fs.promises.writeFile(path.join(root, name), buffer, { flag: 'wx' });
    return `${PUBLIC_PREFIX}${name}`;
  }

  /** Absolute path for "/uploads/<name>" when the name is a safe basename, else null. */
  function resolvePublicPath(publicPath) {
    if (typeof publicPath !== 'string' || !publicPath.startsWith(PUBLIC_PREFIX)) return null;
    const name = publicPath.slice(PUBLIC_PREFIX.length);
    if (!SAFE_NAME_RE.test(name)) return null;
    const absolute = path.join(root, name);
    return path.dirname(absolute) === root ? absolute : null;
  }

  function exists(publicPath) {
    const absolute = resolvePublicPath(publicPath);
    if (!absolute) return false;
    try {
      return fs.statSync(absolute).isFile();
    } catch {
      return false;
    }
  }

  /** Best-effort removal of a file this request just wrote. */
  async function discard(publicPath) {
    const absolute = resolvePublicPath(publicPath);
    if (!absolute) return;
    await fs.promises.unlink(absolute).catch(() => {});
  }

  return { inspect, save, exists, discard, resolvePublicPath, PUBLIC_PREFIX };
}

module.exports = { createImageService };
