'use strict';

const express = require('express');

const { PERMISSION: P } = require('../constants/permissions');

/**
 * /api/students — authorization runs before multer so unauthorized uploads are never parsed.
 * Static paths (export, template, import, bulk-*) are declared before "/:id".
 */
function createStudentRoutes({ controller, auth, uploads }) {
  const { authenticate, authorize } = auth;
  const router = express.Router();
  router.use(authenticate);

  router.get('/', authorize(P.STUDENT_READ), controller.list);
  router.get('/export', authorize(P.STUDENT_EXPORT), controller.exportFile);
  router.get('/template', authorize(P.STUDENT_IMPORT), controller.template);
  router.post('/import', authorize(P.STUDENT_IMPORT), uploads.importUpload, controller.importFile);
  router.post('/bulk-delete', authorize(P.STUDENT_DELETE), controller.bulkDelete);
  router.post('/bulk-copy', authorize(P.STUDENT_CREATE), controller.bulkCopy);

  router.post('/', authorize(P.STUDENT_CREATE), uploads.imageUpload, controller.create);
  router.get('/:id', authorize(P.STUDENT_READ), controller.getById);
  router.put('/:id', authorize(P.STUDENT_UPDATE), uploads.imageUpload, controller.update);
  router.delete('/:id', authorize(P.STUDENT_DELETE), controller.remove);
  return router;
}

module.exports = { createStudentRoutes };
