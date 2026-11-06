'use strict';

const express = require('express');

function createAuthRoutes({ controller, auth }) {
  const router = express.Router();
  router.post('/login', controller.login); // public
  router.get('/me', auth.authenticate, controller.me);
  return router;
}

module.exports = { createAuthRoutes };
