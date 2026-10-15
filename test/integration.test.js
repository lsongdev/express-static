'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');
const express = require('express');
const express4 = require('express4');
const kelp = require('kelp');
const serve = require('..');
const { fixture, start } = require('./helpers');

for (const [name, factory] of [['Express 4', express4], ['Express 5', express], ['Kelp', kelp]]) {
  test(name + ' serves files, falls through and rejects traversal', async t => {
    const { root } = await fixture(t);
    const app = factory();
    app.use(serve(root));
    app.use((req, res) => { res.statusCode = 404; res.end('fallback'); });
    const request = await start(t, app);
    assert.equal((await request('/hello.txt')).body, 'hello');
    assert.equal((await request('/missing')).body, 'fallback');
    assert.equal((await request('/../public-secret/secret.txt')).status, 404);
    assert.equal((await request('/sub/')).body, '<h1>sub</h1>');
  });
}

test('Express mounted middleware preserves mount prefixes in redirects', async t => {
  const { root } = await fixture(t);
  const app = express();
  app.use('/assets', serve(root));
  const request = await start(t, app);
  assert.equal((await request('/assets/hello.txt')).body, 'hello');
  const redirect = await request('/assets/sub?x=1');
  assert.equal(redirect.status, 301);
  assert.equal(new URL(redirect.headers.location, 'http://example.com/assets/sub?x=1').pathname, '/assets/sub/');
  assert.equal((await request('/assets/sub/')).body, '<h1>sub</h1>');
});

test('Express error middleware receives malformed URL errors', async t => {
  const { root } = await fixture(t);
  const app = express();
  app.use(serve(root));
  app.use((err, req, res, next) => res.status(err.statusCode).send('bad path'));
  const request = await start(t, app);
  assert.equal((await request('/%GG')).status, 400);
});

test('Kelp receives malformed URL errors through its fourth middleware argument', async t => {
  const { root } = await fixture(t);
  const app = kelp();
  app.use(serve(root));
  app.use((req, res, next, err) => {
    res.statusCode = err ? err.statusCode : 404;
    res.end('handled');
  });
  const request = await start(t, app);
  assert.equal((await request('/%GG')).status, 400);
});

test('CLI runs with runtime dependencies, serves a chosen root and returns 404', async t => {
  const { root } = await fixture(t);
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'bin', 'server.js'), root], {
    env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe']
  });
  t.after(() => new Promise(resolve => {
    child.once('exit', resolve);
    if (!child.kill()) resolve();
  }));
  const port = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('CLI start timeout')), 5000);
    child.stdout.on('data', chunk => {
      output += chunk;
      const match = output.match(/port (\d+)/);
      if (match) { clearTimeout(timer); resolve(Number(match[1])); }
    });
    child.once('error', err => { clearTimeout(timer); reject(err); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error('CLI exited: ' + code)); });
  });
  function request(url) {
    return new Promise((resolve, reject) => {
      http.get({ host: '127.0.0.1', port, path: url, agent: false }, res => {
        let body = '';
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, body }));
        res.on('error', reject);
      }).on('error', reject);
    });
  }
  assert.equal((await request('/hello.txt')).body, 'hello');
  assert.equal((await request('/missing')).status, 404);
  assert.equal((await request('/../public-secret/secret.txt')).status, 404);
});
