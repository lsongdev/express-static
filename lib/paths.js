'use strict';

const path = require('node:path');

function contains(root, filename) {
  const relative = path.relative(root, filename);
  return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}

function permitted(root, filename, options) {
  return options.dotfiles === 'allow' || !path.relative(root, filename).split(path.sep)
    .some(part => part.startsWith('.') && part !== '');
}

function parseRequest(url) {
  const delimiter = url.indexOf('?');
  const rawPath = delimiter === -1 ? url : url.slice(0, delimiter);
  const query = delimiter === -1 ? '' : url.slice(delimiter);
  let pathname;
  try {
    pathname = decodeURIComponent(rawPath);
  } catch {
    throw badRequest();
  }
  // Decode once before path normalization. Reject platform-dependent separators.
  if (!pathname.startsWith('/') || /[\\\x00-\x1f\x7f]/.test(pathname)) throw badRequest();
  return { pathname, rawPath, query };
}

function badRequest() {
  const err = new URIError('Invalid request path');
  err.status = err.statusCode = 400;
  return err;
}

function validateOptions(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('options must be an object');
  }
  for (const name of Object.keys(options)) {
    if (!['index', 'listDirectory', 'dotfiles'].includes(name)) throw new TypeError('Unknown option: ' + name);
  }
  const settings = { index: 'index.html', listDirectory: false, dotfiles: 'ignore', ...options };
  if (settings.index !== false && (typeof settings.index !== 'string' || !settings.index ||
      settings.index === '.' || settings.index === '..' || /[\/\\\x00-\x1f\x7f]/.test(settings.index))) {
    throw new TypeError('index must be a single filename or false');
  }
  if (typeof settings.listDirectory !== 'boolean') throw new TypeError('listDirectory must be a boolean');
  if (!['ignore', 'allow'].includes(settings.dotfiles)) throw new TypeError('dotfiles must be ignore or allow');
  return settings;
}

module.exports = { contains, permitted, parseRequest, validateOptions };
