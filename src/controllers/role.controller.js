'use strict';

function createRoleController({ roleService }) {
  return {
    permissions(req, res) {
      res.json(roleService.getCatalog());
    },

    list(req, res) {
      res.json(roleService.list());
    },

    options(req, res) {
      res.json(roleService.options());
    },

    getById(req, res) {
      res.json(roleService.getById(req.params.id));
    },

    create(req, res) {
      res.status(201).json(roleService.create(req.body));
    },

    update(req, res) {
      res.json(roleService.update(req.params.id, req.body));
    },

    remove(req, res) {
      res.json(roleService.remove(req.params.id));
    },
  };
}

module.exports = { createRoleController };
