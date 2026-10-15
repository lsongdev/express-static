'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { fixture, start, handler } = require('./helpers');
const serve = require('..');

test('raw and encoded traversal never reads or lists sibling directories', async t => {
  const { root } = await fixture(t);
  for (const configuredRoot of [root, root + path.sep, path.relative(process.cwd(), root)]) {
    for (const options of [{}, { index: false, listDirectory: true }, { dotfiles: 'allow' }]) {
      const request = await start(t, handler(configuredRoot, options));
      for (const pathname of [
        '/..', '/../', '/../public-secret', '/../public-secret/',
        '/../public-secret/secret.txt', '/../public-secret/index.html?download=1',
        '/sub/../../public-secret/secret.txt', '/..//public-secret//secret.txt',
        '/%2e%2e/public-secret/secret.txt', '/.%2e/public-secret/secret.txt',
        '/%2E%2E%2Fpublic-secret%2Fsecret.txt',
        '/../public-secret/../public-secret/secret.txt'
      ]) {
        const response = await request(pathname);
        assert.equal(response.status, 404, pathname);
        assert.equal(response.body, 'Not Found', pathname);
      }
    }
  }
});

test('malformed encodings, NUL, controls and backslashes return 400 once', async t => {
  const { root } = await fixture(t);
  const errors = [];
  const request = await start(t, handler(root, {}, err => errors.push(err)));
  for (const pathname of ['/%', '/%GG', '/%C0%AE', '/hello%00.txt', '/%0d%0a', '/%7f',
    '/..%5cpublic-secret%5csecret.txt', '/..\\public-secret\\secret.txt']) {
    assert.equal((await request(pathname)).status, 400, pathname);
  }
  assert.equal(errors.length, 8);
  assert(errors.every(err => err instanceof URIError && err.status === 400));
});

test('percent-encoded filenames are decoded exactly once', async t => {
  const { root } = await fixture(t);
  await fs.writeFile(path.join(root, '%2e%2e.txt'), 'literal percent');
  const request = await start(t, handler(root));
  assert.equal((await request('/%252e%252e.txt')).body, 'literal percent');
  assert.equal((await request('/hello%20world.txt?bad=%GG')).body, 'space');
  assert.equal((await request('/%E4%BD%A0%E5%A5%BD.txt')).body, '你好');
});

test('dotfiles and hidden directories are ignored by default in reads and listings', async t => {
  const { root } = await fixture(t);
  const request = await start(t, handler(root, { index: false, listDirectory: true }));
  for (const name of ['/.env', '/%2eenv', '/.hidden/', '/.hidden/file.txt']) {
    assert.equal((await request(name)).status, 404);
  }
  const listing = await request('/');
  assert(!listing.body.includes('.env'));
  assert(!listing.body.includes('.hidden'));
  const allow = await start(t, handler(root, { index: false, listDirectory: true, dotfiles: 'allow' }));
  assert.equal((await allow('/.env')).body, 'hidden');
  assert.equal((await allow('/.hidden/file.txt')).body, 'hidden file');
  assert((await allow('/')).body.includes('.env'));
  await fs.writeFile(path.join(root, '..allowed.txt'), 'allowed dot prefix');
  assert.equal((await allow('/..allowed.txt')).body, 'allowed dot prefix');
});

test('symlinks to files, directories and indexes outside root are blocked', async t => {
  const { root, base } = await fixture(t);
  await fs.symlink(path.join(base, 'public-secret'), path.join(root, 'escape'), 'junction');
  await fs.symlink(path.join(base, 'public-secret', 'secret.txt'), path.join(root, 'leak.txt'), 'file');
  await fs.symlink(path.join(root, 'hello.txt'), path.join(root, 'safe.txt'), 'file');
  await fs.symlink(path.join(root, '.env'), path.join(root, 'hidden-alias.txt'), 'file');
  await fs.symlink(path.join(root, 'missing'), path.join(root, 'broken.txt'), 'file');
  const request = await start(t, handler(root, { index: false, listDirectory: true }));
  for (const name of ['/escape', '/escape/', '/escape/secret.txt', '/leak.txt', '/hidden-alias.txt']) {
    assert.equal((await request(name)).status, 404, name);
  }
  assert.equal((await request('/safe.txt')).body, 'hello');
  const listing = await request('/');
  assert(!listing.body.includes('escape'));
  assert(!listing.body.includes('leak.txt'));
  assert(!listing.body.includes('hidden-alias'));
  assert(!listing.body.includes('broken.txt'));
  assert(listing.body.includes('safe.txt'));
  const index = await start(t, handler(root, { index: 'leak.txt', listDirectory: true }));
  assert.equal((await index('/')).status, 404);
  const alias = path.join(base, 'root-alias');
  await fs.symlink(root, alias, 'junction');
  const aliasedRoot = await start(t, handler(alias));
  assert.equal((await aliasedRoot('/hello.txt')).body, 'hello');
  assert.equal((await aliasedRoot('/leak.txt')).status, 404);
});

test('directory listing escapes HTML, encodes links and omits absolute filesystem paths', async t => {
  const { root } = await fixture(t);
  const name = "a'& space.txt";
  await fs.writeFile(path.join(root, name), 'escaped');
  const request = await start(t, handler(root, { index: false, listDirectory: true }));
  const response = await request('/');
  assert.equal(response.status, 200);
  assert(response.body.includes('a&#39;&amp; space.txt'));
  assert(response.body.includes('href="a&#39;%26%20space.txt"'));
  assert(!response.body.includes(root));
  assert(!response.body.includes('href="../"'));
  assert.equal((await request('/' + encodeURIComponent(name))).body, 'escaped');
  assert((await request('/sub/')).body.includes('href="../"'));
});

test('directory titles and malicious filenames cannot inject HTML', { skip: process.platform === 'win32' }, async t => {
  const { root } = await fixture(t);
  const name = '<img src=x onerror=alert(1)>';
  await fs.mkdir(path.join(root, name));
  await fs.writeFile(path.join(root, '<script>.txt'), 'text');
  const request = await start(t, handler(root, { index: false, listDirectory: true }));
  const listing = await request('/');
  assert(!listing.body.includes('<script>'));
  assert(listing.body.includes('&lt;script&gt;.txt'));
  const nested = await request('/' + encodeURIComponent(name) + '/');
  assert.equal(nested.status, 200);
  assert(!nested.body.includes('<img'));
  assert(nested.body.includes('&lt;img'));
});

test('redirects stay on the same origin and preserve query strings', async t => {
  const { root } = await fixture(t);
  const request = await start(t, handler(root));
  const response = await request('//sub?x=1');
  assert.equal(response.status, 301);
  assert.equal(response.headers.location, './sub/?x=1');
  assert.equal(new URL(response.headers.location, 'https://example.com//sub?x=1').origin, 'https://example.com');
});

test('invalid options fail at middleware construction, including traversal in index', () => {
  for (const index of [true, '', '.', '..', '../secret', '/secret', 'sub/index.html', 'sub\\index.html', 'a\0b']) {
    assert.throws(() => serve('.', { index }), /index must/);
  }
  for (const options of [null, [], 'bad', { listDirectory: 1 }, { dotfiles: 'yes' }, { indexes: true }]) {
    assert.throws(() => serve('.', options), TypeError);
  }
  assert.throws(() => serve(12), /root must/);
});
