'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');

const { resolveConfig } = require('./config');
const { openDatabase } = require('./db');

const { createStudentRepository } = require('./repositories/student.repository');
const { createUserRepository } = require('./repositories/user.repository');
const { createRoleRepository } = require('./repositories/role.repository');

const { createImageService } = require('./services/image.service');
const { createRoleService } = require('./services/role.service');
const { createAuthService } = require('./services/auth.service');
const { createStudentService } = require('./services/student.service');
const { createStudentIoService } = require('./services/student-io.service');
const { createUserService } = require('./services/user.service');

const { createAuthController } = require('./controllers/auth.controller');
const { createStudentController } = require('./controllers/student.controller');
const { createUserController } = require('./controllers/user.controller');
const { createRoleController } = require('./controllers/role.controller');

const { createAuthMiddleware } = require('./middlewares/auth');
const { createUploadMiddleware } = require('./middlewares/upload');
const { createErrorHandler, apiNotFound } = require('./middlewares/error-handler');
const { createApiRouter } = require('./routes');

/**
 * JWT secret: JWT_SECRET env/option, else read or generate once into <db dir>/jwt-secret.txt
 * (data/jwt-secret.txt with the default DB path). In-memory databases get a per-process secret.
 */
function resolveJwtSecret(config) {
  if (config.jwtSecret) return config.jwtSecret;
  if (config.dbPath === ':memory:') return crypto.randomBytes(48).toString('hex');
  const file = path.join(path.dirname(config.dbPath), config.jwt.secretFileName);
  try {
    const existing = fs.readFileSync(file, 'utf8').trim();
    if (existing) return existing;
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  const secret = crypto.randomBytes(48).toString('hex');
  try {
    fs.writeFileSync(file, `${secret}\n`, { flag: 'wx', mode: 0o600 });
    return secret;
  } catch (err) {
    if (err.code === 'EEXIST') return fs.readFileSync(file, 'utf8').trim() || secret;
    throw err;
  }
}

function securityHeaders(req, res, next) {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'SAMEORIGIN');
  res.set('Referrer-Policy', 'same-origin');
  next();
}

function noStore(req, res, next) {
  res.set('Cache-Control', 'no-store');
  next();
}

/**
 * Builds the Express application.
 * @param {object} [options] { dbPath, uploadDir, publicDir, jwtSecret } — defaults come from env/config.
 * `app.locals.close()` closes the database (used by tests and graceful shutdown).
 */
function createApp(options = {}) {
  const config = resolveConfig(options);
  fs.mkdirSync(config.uploadDir, { recursive: true });
  const db = openDatabase(config.dbPath);
  const jwtSecret = resolveJwtSecret(config);

  // repositories → services → controllers
  const repositories = {
    students: createStudentRepository(db),
    users: createUserRepository(db),
    roles: createRoleRepository(db),
  };
  const imageService = createImageService({ uploadDir: config.uploadDir });
  const roleService = createRoleService({ db, roleRepository: repositories.roles });
  const services = {
    roles: roleService,
    auth: createAuthService({
      userRepository: repositories.users,
      roleService,
      jwtSecret,
      tokenTtlSeconds: config.jwt.expiresInSeconds,
    }),
    students: createStudentService({ db, studentRepository: repositories.students, imageService, config }),
    studentIo: createStudentIoService({ db, studentRepository: repositories.students, imageService, config }),
    users: createUserService({ db, userRepository: repositories.users, roleRepository: repositories.roles, config }),
  };
  const controllers = {
    auth: createAuthController({ authService: services.auth }),
    students: createStudentController({ studentService: services.students, studentIoService: services.studentIo }),
    users: createUserController({ userService: services.users }),
    roles: createRoleController({ roleService: services.roles }),
  };
  const auth = createAuthMiddleware({ authService: services.auth });
  const uploads = createUploadMiddleware(config);

  const app = express();
  app.disable('x-powered-by');
  app.use(securityHeaders);

  app.use(
    '/api',
    noStore,
    express.json({ limit: config.limits.jsonBody }),
    createApiRouter({ controllers, auth, uploads }),
    apiNotFound,
  );

  // Public static files: uploaded images and the frontend ("/" → public/index.html).
  app.use('/uploads', express.static(config.uploadDir, { index: false, dotfiles: 'ignore', fallthrough: false, maxAge: '7d' }));
  app.use(express.static(config.publicDir, { index: 'index.html', dotfiles: 'ignore' }));

  app.use(createErrorHandler({ jsonLimitLabel: config.limits.jsonBodyLabel }));

  app.locals.config = config;
  app.locals.db = db;
  app.locals.close = () => {
    try {
      db.close();
    } catch {
      // already closed
    }
  };
  return app;
}

module.exports = { createApp };
