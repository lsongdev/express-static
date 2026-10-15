'use strict';

const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const serve = require('..');

async function fixture(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'static-test-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'public');
  for (const dir of ['public', 'public/sub', 'public/empty', 'public/.hidden', 'public-secret']) {
    await fs.mkdir(path.join(base, dir), { recursive: true });
  }
  for (const [name, content] of Object.entries({
    'public/index.html': '<h1>home</h1>',
    'public/sub/index.html': '<h1>sub</h1>',
    'public/hello.txt': 'hello',
    'public/hello world.txt': 'space',
    'public/你好.txt': '你好',
    'public/.env': 'hidden',
    'public/.hidden/file.txt': 'hidden file',
    'public/unknown.extension-not-known': 'unknown',
    'public-secret/secret.txt': 'TOP SECRET',
    'public-secret/index.html': 'SECRET INDEX'
  })) await fs.writeFile(path.join(base, name), content);
  await fs.writeFile(path.join(root, 'binary.bin'), Buffer.from([0, 1, 255, 128]));
  return { base, root };
}

async function start(t, handler) {
  const server = http.createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise(resolve => {
    server.close(resolve);
    server.closeAllConnections();
  }));
  return (pathname, options = {}) => new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port: server.address().port,
      path: pathname, agent: false, ...options
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.once('error', reject);
      res.once('end', () => {
        const buffer = Buffer.concat(chunks);
        resolve({ status: res.statusCode, headers: res.headers, body: buffer.toString(), buffer });
      });
    });
    req.once('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('Request timed out')));
    req.end();
  });
}

function handler(root, options, onNext = () => {}) {
  const middleware = serve(root, options);
  return (req, res) => middleware(req, res, err => {
    onNext(err);
    res.statusCode = err ? err.statusCode || 500 : 404;
    res.end(err ? 'Error' : 'Not Found');
  });
}

module.exports = { fixture, start, handler };
