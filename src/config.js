'use strict';

const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

const defaults = Object.freeze({
  port: 3000,
  dbPath: path.join(ROOT_DIR, 'data', 'app.db'),
  uploadDir: path.join(ROOT_DIR, 'uploads'),
  publicDir: path.join(ROOT_DIR, 'public'),
});

const settings = Object.freeze({
  timeZone: 'Asia/Ho_Chi_Minh',
  jwt: Object.freeze({
    expiresInSeconds: 8 * 60 * 60,
    secretFileName: 'jwt-secret.txt',
  }),
  limits: Object.freeze({
    jsonBody: '1mb',
    jsonBodyLabel: '1 MB',
    imageFileSize: 5 * 1024 * 1024,
    imageFileSizeLabel: '5 MB',
    importFileSize: 10 * 1024 * 1024,
    importFileSizeLabel: '10 MB',
    importMaxRows: 1000,
    importMaxErrorDetails: 500,
    xlsxMaxUncompressedBytes: 50 * 1024 * 1024,
    xlsxMaxZipEntries: 2000,
    bulkMaxIds: 1000,
    searchMaxLength: 200,
  }),
});

function parsePort(value) {
  const port = Number.parseInt(String(value ?? ''), 10);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : defaults.port;
}

/**
 * Builds the runtime config. Explicit options win over environment variables,
 * which win over defaults. Env: PORT, DB_PATH, UPLOAD_DIR, JWT_SECRET.
 */
function resolveConfig(options = {}) {
  const env = process.env;
  const rawDbPath = options.dbPath ?? env.DB_PATH ?? defaults.dbPath;
  const dbPath = rawDbPath === ':memory:' ? rawDbPath : path.resolve(rawDbPath);
  return {
    ...settings,
    port: parsePort(options.port ?? env.PORT),
    dbPath,
    uploadDir: path.resolve(options.uploadDir ?? env.UPLOAD_DIR ?? defaults.uploadDir),
    publicDir: path.resolve(options.publicDir ?? defaults.publicDir),
    jwtSecret: options.jwtSecret ?? (env.JWT_SECRET ? env.JWT_SECRET : null),
  };
}

module.exports = { ROOT_DIR, defaults, settings, resolveConfig, parsePort };
