'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { pipeline } = require('node:stream');
const mime = require('mime-types');
const { contains, permitted, parseRequest, validateOptions } = require('./lib/paths');
const renderDirectory = require('./lib/directory');

const missing = err => err.code === 'ENOENT' || err.code === 'ENOTDIR';

/** Create framework-independent (req, res, next) static file middleware. */
module.exports = function serve(root = '.', options = {}) {
  if (typeof root !== 'string') throw new TypeError('root must be a string');
  const settings = validateOptions(options);
  root = path.resolve(root);

  return async function staticFiles(req, res, next) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    let handled;
    try {
      handled = await handleRequest(root, settings, req, res);
    } catch (err) {
      return next(missing(err) ? undefined : err);
    }
    // Invoke downstream middleware outside our I/O error boundary.
    if (!handled) return next();
  };
};

async function handleRequest(root, settings, req, res) {
  const { pathname, rawPath, query } = parseRequest(req.url);
  let filename = path.join(root, pathname);
  if (!contains(root, filename) || !permitted(root, filename, settings)) return false;

  const realRoot = await fs.realpath(root);
  filename = await fs.realpath(filename);
  if (!contains(realRoot, filename) || !permitted(realRoot, filename, settings)) return false;
  const stat = await fs.stat(filename);
  if (stat.isDirectory()) {
    // Relative locations keep HTML links working and preserve mount prefixes.
    if (!rawPath.endsWith('/')) {
      const segment = rawPath.slice(rawPath.lastIndexOf('/') + 1);
      res.writeHead(301, { Location: './' + segment + '/' + query });
      res.end();
      return true;
    }
    if (settings.index !== false) {
      try {
        const realIndex = await fs.realpath(path.join(filename, settings.index));
        if (!contains(realRoot, realIndex) || !permitted(realRoot, realIndex, settings)) return false;
        if ((await fs.stat(realIndex)).isFile()) return await sendFile(realIndex, req, res);
      } catch (err) {
        if (!missing(err)) throw err;
      }
    }
    if (!settings.listDirectory) return false;
    const html = await renderDirectory(realRoot, filename, pathname, settings);
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': Buffer.byteLength(html),
      'X-Content-Type-Options': 'nosniff'
    });
    res.end(req.method === 'HEAD' ? undefined : html);
    return true;
  }
  if (!stat.isFile()) return false;
  return sendFile(filename, req, res);
}

async function sendFile(filename, req, res) {
  const file = await fs.open(filename, 'r');
  let streaming = false;
  try {
    const stat = await file.stat();
    if (!stat.isFile()) return false;
    res.setHeader('Last-Modified', stat.mtime.toUTCString());
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const since = Date.parse(req.headers['if-modified-since']);
    if (Number.isFinite(since) && Math.floor(stat.mtimeMs / 1000) * 1000 <= since) {
      res.writeHead(304);
      res.end();
      return true;
    }
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Content-Type', mime.contentType(mime.lookup(filename) || 'application/octet-stream'));
    res.statusCode = 200;
    if (req.method === 'HEAD') {
      res.end();
      return true;
    }
    const stream = file.createReadStream();
    streaming = true;
    // pipeline closes the file and response on completion, errors or disconnects.
    pipeline(stream, res, () => {});
    return true;
  } finally {
    if (!streaming) await file.close();
  }
}
