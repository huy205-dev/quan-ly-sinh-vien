'use strict';

const express = require('express');

const { createAuthRoutes } = require('./auth.routes');
const { createStudentRoutes } = require('./student.routes');
const { createUserRoutes } = require('./user.routes');
const { createRoleRoutes, createPermissionRoutes } = require('./role.routes');

/** Mounts every API router under /api (see app.js). */
function createApiRouter({ controllers, auth, uploads }) {
  const router = express.Router();
  router.use('/auth', createAuthRoutes({ controller: controllers.auth, auth }));
  router.use('/students', createStudentRoutes({ controller: controllers.students, auth, uploads }));
  router.use('/users', createUserRoutes({ controller: controllers.users, auth }));
  router.use('/roles', createRoleRoutes({ controller: controllers.roles, auth }));
  router.use('/permissions', createPermissionRoutes({ controller: controllers.roles, auth }));
  return router;
}

module.exports = { createApiRouter };
