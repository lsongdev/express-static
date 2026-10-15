'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Readable } = require('node:stream');
const http = require('node:http');
const serve = require('..');
const { fixture, start, handler } = require('./helpers');

test('serves files, binary data, normalized safe paths, MIME types and metadata', async t => {
  const { root } = await fixture(t);
  const request = await start(t, handler(root));
  for (const name of ['/hello.txt', '/sub/../hello.txt']) {
    const response = await request(name);
    assert.equal(response.status, 200);
    assert.equal(response.body, 'hello');
    assert.equal(response.headers['content-length'], '5');
    assert.equal(response.headers['content-type'], 'text/plain; charset=utf-8');
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
    assert(Number.isFinite(Date.parse(response.headers['last-modified'])));
  }
  assert.deepEqual((await request('/binary.bin')).buffer, Buffer.from([0, 1, 255, 128]));
  assert.equal((await request('/unknown.extension-not-known')).headers['content-type'], 'application/octet-stream');
});

test('directory indexes, disabled indexes, custom filenames and listing fallback', async t => {
  const { root } = await fixture(t);
  const request = await start(t, handler(root));
  assert.equal((await request('/')).body, '<h1>home</h1>');
  assert.equal((await request('/sub/')).body, '<h1>sub</h1>');
  assert.equal((await request('/sub')).headers.location, './sub/');
  assert.equal((await request('/empty/')).status, 404);
  const disabled = await start(t, handler(root, { index: false }));
  assert.equal((await disabled('/')).status, 404);
  const listing = await start(t, handler(root, { listDirectory: true }));
  assert.equal((await listing('/')).body, '<h1>home</h1>');
  assert((await listing('/empty/')).body.includes('Index of /empty/'));
  const custom = await start(t, handler(root, { index: 'hello.txt' }));
  assert.equal((await custom('/')).body, 'hello');
  await fs.mkdir(path.join(root, 'empty', 'index.html'));
  assert.equal((await request('/empty/')).status, 404);
});

test('HEAD returns file and listing headers without bodies', async t => {
  const { root } = await fixture(t);
  const request = await start(t, handler(root, { index: false, listDirectory: true }));
  for (const name of ['/hello.txt', '/', '/sub/']) {
    const get = await request(name);
    const head = await request(name, { method: 'HEAD' });
    assert.equal(head.status, get.status);
    assert.equal(head.headers['content-length'], get.headers['content-length']);
    assert.equal(head.headers['content-type'], get.headers['content-type']);
    assert.equal(head.body, '');
  }
});

test('conditional requests handle equal, stale, future and invalid dates', async t => {
  const { root } = await fixture(t);
  const request = await start(t, handler(root));
  const first = await request('/hello.txt');
  for (const date of [first.headers['last-modified'], 'Thu, 01 Jan 2099 00:00:00 GMT']) {
    for (const method of ['GET', 'HEAD']) {
      const response = await request('/hello.txt', { method, headers: { 'If-Modified-Since': date } });
      assert.equal(response.status, 304);
      assert.equal(response.body, '');
      assert.equal(response.headers['last-modified'], first.headers['last-modified']);
    }
  }
  for (const date of ['Thu, 01 Jan 1970 00:00:00 GMT', 'invalid']) {
    assert.equal((await request('/hello.txt', { headers: { 'If-Modified-Since': date } })).status, 200);
  }
});

test('missing paths, missing roots and unsupported methods fall through exactly once', async t => {
  const { root } = await fixture(t);
  let calls = 0;
  const request = await start(t, handler(root, {}, err => { assert.equal(err, undefined); calls++; }));
  for (const name of ['/missing', '/hello.txt/nope']) assert.equal((await request(name)).status, 404);
  for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS']) {
    assert.equal((await request('/hello.txt', { method })).status, 404);
  }
  assert.equal(calls, 6);
  const absent = await start(t, handler(path.join(root, 'absent')));
  assert.equal((await absent('/')).status, 404);
});

test('filesystem roots and root paths containing a trailing separator work', async t => {
  const { root } = await fixture(t);
  const trailing = await start(t, handler(root + path.sep));
  assert.equal((await trailing('/hello.txt')).body, 'hello');
  const volume = path.parse(root).root;
  const request = await start(t, handler(volume, { dotfiles: 'allow' }));
  const relative = path.relative(volume, path.join(root, 'hello.txt')).split(path.sep).map(encodeURIComponent).join('/');
  assert.equal((await request('/' + relative)).body, 'hello');
});

test('unexpected I/O errors reach next(err) once', async t => {
  const { root } = await fixture(t);
  const errors = [];
  const request = await start(t, handler(root, {}, err => errors.push(err)));
  const error = Object.assign(new Error('Denied'), { code: 'EACCES' });
  t.mock.method(fs, 'open', async () => { throw error; });
  assert.equal((await request('/hello.txt')).status, 500);
  assert.deepEqual(errors, [error]);
});

test('directory read errors reach next(err)', async t => {
  const { root } = await fixture(t);
  const request = await start(t, handler(root, { index: false, listDirectory: true }));
  t.mock.method(fs, 'readdir', async () => { throw new Error('I/O failure'); });
  assert.equal((await request('/')).status, 500);
});

test('stream failures abort the response without an unhandled error', async t => {
  const { root } = await fixture(t);
  const request = await start(t, handler(root));
  const open = fs.open.bind(fs);
  t.mock.method(fs, 'open', async (...args) => {
    const file = await open(...args);
    file.createReadStream = () => new Readable({
      read() { this.destroy(new Error('read failure')); },
      destroy(err, callback) { file.close().then(() => callback(err), callback); }
    });
    return file;
  });
  await assert.rejects(request('/hello.txt'), /socket hang up|aborted|reset/i);
});

test('downstream exceptions are not caught and passed to next a second time', async t => {
  const { root } = await fixture(t);
  const middleware = serve(root);
  for (const url of ['/../public-secret/secret.txt', '/missing']) {
    let calls = 0;
    const error = new Error('downstream failed');
    await assert.rejects(middleware({ method: 'GET', url }, {}, () => {
      calls++;
      throw error;
    }), err => err === error);
    assert.equal(calls, 1);
  }
});

test('client disconnect closes the file stream and descriptor', async t => {
  const { root } = await fixture(t);
  await fs.writeFile(path.join(root, 'large.bin'), Buffer.alloc(8 * 1024 * 1024, 65));
  const open = fs.open.bind(fs);
  let closed;
  const closePromise = new Promise(resolve => { closed = resolve; });
  t.mock.method(fs, 'open', async (...args) => {
    const file = await open(...args);
    const create = file.createReadStream.bind(file);
    file.createReadStream = () => {
      const stream = create();
      stream.once('close', () => closed(file.fd));
      return stream;
    };
    return file;
  });
  const server = http.createServer(handler(root));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  await new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: server.address().port, path: '/large.bin', agent: false }, res => {
      res.once('data', () => { req.destroy(); resolve(); });
      res.on('error', () => {});
    });
    req.on('error', reject);
  });
  assert.equal(await closePromise, -1);
});
