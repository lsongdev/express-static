const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const serve = require('..');

function request(root, options, pathname, headers){
  return new Promise(function(resolve, reject){
    const middleware = serve(root, options);
    const server = http.createServer(function(req, res){
      middleware(req, res, function(err){
        res.statusCode = err ? 500 : 404;
        res.end(err ? err.message : 'Not found');
      });
    });
    server.listen(0, '127.0.0.1', function(){
      // Pass the raw path to http.request so ../ is not normalized by a URL client.
      const req = http.get({
        agent: false,
        hostname: '127.0.0.1',
        port: server.address().port,
        path: pathname,
        headers: headers || {}
      }, function(res){
        var body = '';
        res.setEncoding('utf8');
        res.on('data', function(chunk){ body += chunk; });
        res.on('end', function(){
          server.close(function(){
            resolve({ status: res.statusCode, headers: res.headers, body: body });
          });
        });
        res.on('error', fail);
      });
      req.on('error', fail);
      req.setTimeout(5000, function(){ req.destroy(new Error('Request timed out')); });
    });
    server.on('error', reject);
    function fail(err){
      server.close(function(){ reject(err); });
    }
  });
}

async function main(){
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'kelp-static-'));
  const root = path.join(temporary, 'public');
  fs.mkdirSync(root);
  fs.mkdirSync(path.join(root, 'nested'));
  fs.mkdirSync(path.join(root, '..allowed'));
  fs.mkdirSync(path.join(temporary, 'public-secret'));
  fs.mkdirSync(path.join(temporary, 'private'));
  fs.writeFileSync(path.join(root, 'index.html'), 'public index');
  fs.writeFileSync(path.join(root, 'nested', 'hello.txt'), 'hello');
  fs.writeFileSync(path.join(root, '..allowed', 'hello.txt'), 'allowed');
  fs.writeFileSync(path.join(temporary, 'public-secret', 'secret.txt'), 'secret');
  fs.writeFileSync(path.join(temporary, 'public-secret', 'index.html'), 'secret index');
  fs.writeFileSync(path.join(temporary, 'private', 'secret.txt'), 'private');

  try {
    // Cover sibling prefix collisions, ordinary escapes, normalization and queries.
    for(const pathname of [
      '/..',
      '/../',
      '/../public-secret/index.html',
      '/../public-secret/secret.txt',
      '/../public-secret/secret.txt?download=1',
      '/nested/../../public-secret/secret.txt',
      '/../public-secret/../public-secret/secret.txt',
      '/..//public-secret//secret.txt',
      '/../private/secret.txt',
      '/../public-secret',
      '/../public-secret/'
    ]){
      for(const options of [{}, { index: false, listDirectory: true }]){
        const response = await request(root, options, pathname);
        assert.strictEqual(response.status, 404, pathname);
        assert.strictEqual(response.body, 'Not found', pathname);
      }
    }

    for(const configuredRoot of [root, root + path.sep, path.relative(process.cwd(), root)]){
      const index = await request(configuredRoot, {}, '/');
      assert.strictEqual(index.status, 200);
      assert.strictEqual(index.body, 'public index');
      for(const options of [{}, { index: false, listDirectory: true }]){
        for(const pathname of ['/../public-secret/secret.txt', '/../public-secret/']){
          const blocked = await request(configuredRoot, options, pathname);
          assert.strictEqual(blocked.status, 404, configuredRoot + ': ' + pathname);
          assert.strictEqual(blocked.body, 'Not found');
        }
      }
    }

    for(const pathname of ['/nested/hello.txt', '/nested/../nested/hello.txt']){
      const response = await request(root, {}, pathname);
      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.body, 'hello');
      assert.strictEqual(response.headers['content-length'], '5');
      assert.match(response.headers['content-type'], /^text\/plain/);
      const cached = await request(root, {}, pathname, {
        'If-Modified-Since': response.headers['last-modified']
      });
      assert.strictEqual(cached.status, 304);
      assert.strictEqual(cached.body, '');
    }

    const dotName = await request(root, {}, '/..allowed/hello.txt');
    assert.strictEqual(dotName.body, 'allowed');
    const listing = await request(root, { index: false, listDirectory: true }, '/');
    assert.strictEqual(listing.status, 200);
    assert(listing.body.includes('index.html'));
    const unindexed = await request(root, {}, '/nested');
    assert.strictEqual(unindexed.status, 404);
    const nestedListing = await request(root, { listDirectory: true }, '/nested');
    assert.strictEqual(nestedListing.status, 200);
    assert(nestedListing.body.includes('hello.txt'));
    const defaultIndex = await request(root, { listDirectory: true }, '/');
    assert.strictEqual(defaultIndex.body, 'public index');

    // Check the final path, including a configured index that contains ../.
    for(const index of ['../public-secret/secret.txt', '../private/secret.txt']){
      const escapedIndex = await request(root, { index: index, listDirectory: true }, '/');
      assert.strictEqual(escapedIndex.status, 404, index);
      assert.strictEqual(escapedIndex.body, 'Not found');
    }
    const parentIndex = await request(root, { index: '../index.html' }, '/nested/');
    assert.strictEqual(parentIndex.status, 200);
    assert.strictEqual(parentIndex.body, 'public index');
    const nestedIndex = await request(root, { index: 'nested/hello.txt' }, '/');
    assert.strictEqual(nestedIndex.body, 'hello');

    // A filesystem root must also work (root + separator would become //).
    const filesystemRoot = path.parse(root).root;
    const rootResponse = await request(filesystemRoot, {}, path.join(root, 'index.html'));
    assert.strictEqual(rootResponse.status, 200);
    assert.strictEqual(rootResponse.body, 'public index');
    console.log('All path containment and static serving tests passed.');
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

main().catch(function(err){
  console.error(err);
  process.exitCode = 1;
});
