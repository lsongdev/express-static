# Static file middleware

One implementation for Node.js HTTP servers, Express and Kelp. Published as both
`kelp-static` and `express-static`; choose either package name. Version 2 is
maintained on `master`, with the same source shared by both packages.

Requires **Node.js 20 or newer**.

```sh
npm install kelp-static
# or: npm install express-static
```

## Express

```js
const express = require('express');
const serve = require('kelp-static'); // require('express-static') works identically

const app = express();
app.use('/assets', serve('./public'));
app.listen(3000);
```

## Kelp

```js
const http = require('node:http');
const kelp = require('kelp');
const serve = require('kelp-static');

const app = kelp();
app.use(serve('./public', { listDirectory: true }));
app.use((req, res, next, err) => {
  res.statusCode = err ? err.statusCode || 500 : 404;
  res.end(err ? 'Unable to serve file' : 'Not Found');
});
http.createServer(app).listen(3000);
```

## Node.js HTTP

The library has no framework dependency. Middleware takes `(req, res, next)`;
`next()` means the request was not served, and `next(err)` reports an error.

```js
const http = require('node:http');
const serve = require('kelp-static');

const middleware = serve('./public');
http.createServer((req, res) => {
  middleware(req, res, err => {
    res.statusCode = err ? err.statusCode || 500 : 404;
    res.end(err ? 'Unable to serve file' : 'Not Found');
  });
}).listen(3000);
```

## API

### `serve(root = '.', options = {})`

`root` is resolved against the working directory when middleware is created.
Options are validated immediately; unknown options throw a `TypeError`.

| Option | Default | Meaning |
| --- | --- | --- |
| `index` | `'index.html'` | A single filename to serve inside directories, or `false` to disable index files. Paths and boolean `true` are rejected. |
| `listDirectory` | `false` | Render a directory listing if no index file exists. Set `index: false` to always list directories. |
| `dotfiles` | `'ignore'` | Hide files and directory components beginning with `.`. Set to `'allow'` to expose them explicitly. |

For example, list directories instead of serving HTML indexes:

```js
serve('./public', { index: false, listDirectory: true });
```

- Only `GET` and `HEAD` are served; other methods call `next()`.
- Files include a MIME type, content length, `Last-Modified` and
  `X-Content-Type-Options: nosniff`. Unknown extensions use
  `application/octet-stream`.
- `HEAD` returns the same headers as `GET` without a body. A valid
  `If-Modified-Since` date at or after the file's modification time returns `304`.
- Directories without a trailing slash redirect with `301`. Relative locations
  preserve mount prefixes and query strings. The slash is added before checking
  for an index or rendering a listing. A directory with neither falls through.
- Missing files, traversal attempts, disallowed dotfiles and symlinks resolving
  outside the root call `next()`. Malformed percent encodings, control characters
  and backslashes call `next(err)` with status `400`. Other filesystem failures
  also reach `next(err)`; errors after streaming begins abort the response.

## Security behavior

Request paths are decoded **once**, then checked using directory boundaries.
The resolved filesystem paths are checked again to reject symlink escapes,
including index-file symlinks. A symlink may point within the root; the root
itself may also be a symlink. Directory listings filter disallowed entries,
escape HTML and encode filename links, without exposing the absolute root path.

Keep the served tree under trusted administrative control. Filesystem checks
are not an atomic sandbox against another process that can concurrently replace
directories or symlinks. Use filesystem permissions or OS isolation when serving
content that untrusted users can modify.

## Migrating from version 1

Both package names now have the same API and behavior. Existing package names and
`require()` calls continue to work; the differences below are intentional major
version changes.

| Previous behavior | Version 2 |
| --- | --- |
| `express-static`: `{ index: true }` lists directories | Use `{ index: false, listDirectory: true }`. |
| Index paths such as `sub/index.html` | Only a single filename is accepted; configure a different root for a subtree. |
| `kelp-static` may serve `/dir` without a redirect | Directories redirect to `/dir/`, preserving relative links. |
| Missing files may be passed to the error handler | Missing files call `next()` normally. |
| Dotfiles were exposed | Hidden by default; explicitly opt in with `dotfiles: 'allow'`. |
| URLs were used without percent decoding | Paths are decoded once; malformed encodings return `400`. |
| Different implementations lived on `express` and `master` | Both packages are built from `master`. |

The path traversal reported by **Alok Ranjan** was fixed in
`express-static@1.2.7`. Version 2 retains that fix and extends containment checks
to symlinks and decoded paths.

## Command line

Both packages include their own command:

```sh
npx kelp-static ./public
# or: npx express-static ./public
```

The directory defaults to the current working directory. Set `PORT` to change
port `8000`. The CLI uses the same middleware, prefers index files, and lists
directories when no index exists. It needs no Express or Kelp installation.

## Development and releases

```sh
npm ci
npm test
npm run pack:releases
```

Tests cover HTTP behavior, Express 4/5 and Kelp integration, the CLI, traversal,
symlinks, listing escaping and both installed release tarballs. GitHub Actions
runs on Linux, macOS and Windows with Node.js 20, 22 and 24.

The root manifest describes `kelp-static`. `pack:releases` stages the same allowed
files with each package name and CLI name, producing two tarballs in `dist/`.
There is no wrapper dependency between the packages. Publish those tested
artifacts from the same source version:

```sh
npm publish ./dist/kelp-static-2.0.0.tgz
npm publish ./dist/express-static-2.0.0.tgz
```

## License

MIT. See [LICENSE](LICENSE).
