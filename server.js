'use strict';

const http = require('node:http');

const { createApp } = require('./src/app');

const app = createApp();
const { config } = app.locals;
const server = http.createServer(app);

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Cổng ${config.port} đang được sử dụng. Hãy đặt biến PORT khác, ví dụ: PORT=3001 npm start`);
  } else {
    console.error('Không khởi động được server:', err);
  }
  app.locals.close();
  process.exit(1);
});

server.listen(config.port, () => {
  console.log(`Quản lý sinh viên đang chạy tại http://localhost:${config.port}`);
  console.log(`CSDL: ${config.dbPath}`);
});

let stopping = false;
function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`Nhận tín hiệu ${signal}, đang dừng server...`);
  server.close(() => {
    app.locals.close();
    process.exit(0);
  });
  server.closeIdleConnections();
  setTimeout(() => {
    app.locals.close();
    process.exit(0);
  }, 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
