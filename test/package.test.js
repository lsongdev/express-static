'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const { execFileSync } = require('node:child_process');
const pack = require('../scripts/pack');
const { fixture, start } = require('./helpers');

test('both release tarballs install with runtime dependencies and ship identical implementations', async t => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'static-release-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const artifacts = await pack(path.join(base, 'artifacts'));
  const installed = path.join(base, 'installed');
  await fs.mkdir(installed);
  await fs.writeFile(path.join(installed, 'package.json'), '{"name":"release-test","private":true}');
  execFileSync(process.execPath, [process.env.npm_execpath, 'install', '--omit=dev', '--ignore-scripts',
    '--no-package-lock', '--no-audit', '--no-fund', ...artifacts.map(artifact => artifact.path)
  ], { cwd: installed, stdio: 'pipe' });
  const requireInstalled = createRequire(path.join(installed, 'package.json'));
  const { root } = await fixture(t);
  for (const name of ['kelp-static', 'express-static']) {
    const serve = requireInstalled(name);
    const manifest = requireInstalled(name + '/package.json');
    assert.equal(manifest.name, name);
    assert.equal(manifest.version, '2.0.0');
    assert.deepEqual(manifest.bin, { [name]: 'bin/server.js' });
    assert.equal(manifest.devDependencies, undefined);
    const folder = path.join(installed, 'node_modules', name);
    assert(!await fs.access(path.join(folder, 'test')).then(() => true, () => false));
    const middleware = serve(root, { listDirectory: true });
    const request = await start(t, (req, res) => middleware(req, res, err => {
      res.statusCode = err ? err.statusCode || 500 : 404;
      res.end('fallback');
    }));
    assert.equal((await request('/hello.txt')).body, 'hello');
    assert.equal((await request('/../public-secret/secret.txt')).status, 404);
    assert((await request('/empty/')).body.includes('Index of /empty/'));
  }
  for (const file of ['index.js', 'lib/paths.js', 'lib/directory.js', 'bin/server.js']) {
    const kelp = await fs.readFile(path.join(installed, 'node_modules/kelp-static', file));
    const express = await fs.readFile(path.join(installed, 'node_modules/express-static', file));
    assert.deepEqual(kelp, express, file);
  }
  assert.throws(() => requireInstalled('express'), /Cannot find module/);
  assert.throws(() => requireInstalled('kelp'), /Cannot find module/);
});
