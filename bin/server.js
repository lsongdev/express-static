#!/usr/bin/env node
'use strict';

const http = require('node:http');
const serve = require('..');

const middleware = serve(process.argv[2] || '.', { listDirectory: true });
const server = http.createServer((req, res) => {
  middleware(req, res, err => {
    res.statusCode = err ? err.statusCode || 500 : 404;
    res.end(err ? http.STATUS_CODES[res.statusCode] || 'Internal Server Error' : 'Not Found');
  });
});
server.listen(process.env.PORT || 8000, () => {
  console.log('Static server listening on port %s', server.address().port);
});
