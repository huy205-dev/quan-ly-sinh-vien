'use strict';

/** Sends a generated file as an attachment. */
function sendDownload(res, { body, contentType, filename }) {
  res.set('Content-Type', contentType);
  res.set('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(body);
}

function createStudentController({ studentService, studentIoService }) {
  return {
    list(req, res) {
      res.json(studentService.list(req.query));
    },

    getById(req, res) {
      res.json(studentService.getById(req.params.id));
    },

    async create(req, res) {
      res.status(201).json(await studentService.create(req.body, req.file));
    },

    async update(req, res) {
      res.json(await studentService.update(req.params.id, req.body, req.file));
    },

    remove(req, res) {
      res.json(studentService.remove(req.params.id));
    },

    bulkDelete(req, res) {
      res.json(studentService.bulkDelete(req.body));
    },

    bulkCopy(req, res) {
      res.status(201).json(studentService.bulkCopy(req.body));
    },

    async importFile(req, res) {
      res.status(201).json(await studentIoService.importStudents(req.file));
    },

    async exportFile(req, res) {
      sendDownload(res, await studentIoService.exportStudents(req.query));
    },

    async template(req, res) {
      sendDownload(res, await studentIoService.buildTemplate(req.query));
    },
  };
}

module.exports = { createStudentController, sendDownload };
