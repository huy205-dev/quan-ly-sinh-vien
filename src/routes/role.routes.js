'use strict';

const express = require('express');

const { PERMISSION: P } = require('../constants/permissions');

/** /api/roles and /api/permissions. */
function createRoleRoutes({ controller, auth }) {
  const { authenticate, authorize } = auth;
  const router = express.Router();
  router.use(authenticate);

  router.get('/', authorize(P.ROLE_READ), controller.list);
  router.post('/', authorize(P.ROLE_CREATE), controller.create);
  // Role list for the user form's select: any user-management or role permission is enough.
  router.get('/options', authorize(P.USER_READ, P.USER_CREATE, P.USER_UPDATE, P.ROLE_READ), controller.options);
  router.get('/:id', authorize(P.ROLE_READ), controller.getById);
  router.put('/:id', authorize(P.ROLE_UPDATE), controller.update);
  router.delete('/:id', authorize(P.ROLE_DELETE), controller.remove);
  return router;
}

function createPermissionRoutes({ controller, auth }) {
  const router = express.Router();
  router.get('/', auth.authenticate, auth.authorize(P.ROLE_READ), controller.permissions);
  return router;
}

module.exports = { createRoleRoutes, createPermissionRoutes };
