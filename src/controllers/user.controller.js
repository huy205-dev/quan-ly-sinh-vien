'use strict';

function createUserController({ userService }) {
  return {
    list(req, res) {
      res.json(userService.list(req.query));
    },

    getById(req, res) {
      res.json(userService.getById(req.params.id));
    },

    async create(req, res) {
      res.status(201).json(await userService.create(req.body));
    },

    async update(req, res) {
      res.json(await userService.update(req.params.id, req.body, req.auth.user));
    },

    remove(req, res) {
      res.json(userService.remove(req.params.id, req.auth.user));
    },
  };
}

module.exports = { createUserController };
