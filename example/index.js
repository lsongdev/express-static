'use strict';

const http = require('node:http');
const serve = require('..');

const middleware = serve(__dirname, { listDirectory: true });
http.createServer((req, res) => {
  middleware(req, res, err => {
    res.statusCode = err ? err.statusCode || 500 : 404;
    res.end(err ? 'Unable to serve file' : 'Not Found');
  });
}).listen(3000);
