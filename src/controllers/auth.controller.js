'use strict';

function createAuthController({ authService }) {
  return {
    async login(req, res) {
      const result = await authService.login(req.body);
      res.set('X-User', result.user.Username);
      res.json(result);
    },

    me(req, res) {
      res.json({ user: req.auth.user, permissions: req.auth.permissions });
    },
  };
}

module.exports = { createAuthController };
