'use strict';

const express = require('express');

const { PERMISSION: P } = require('../constants/permissions');

function createUserRoutes({ controller, auth }) {
  const { authenticate, authorize } = auth;
  const router = express.Router();
  router.use(authenticate);

  router.get('/', authorize(P.USER_READ), controller.list);
  router.post('/', authorize(P.USER_CREATE), controller.create);
  router.get('/:id', authorize(P.USER_READ), controller.getById);
  router.put('/:id', authorize(P.USER_UPDATE), controller.update);
  router.delete('/:id', authorize(P.USER_DELETE), controller.remove);
  return router;
}

module.exports = { createUserRoutes };
