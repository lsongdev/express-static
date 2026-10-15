const url = require('url');
const mime = require('mime2');
const { resolve, join, relative, isAbsolute, sep } = require('path');
const fs = require('fs');

const { stat } = fs.promises;

const call = p =>
  p.then(r => [null, r], e => [e]);

/**
 * [exports description]
 * @param  {[type]} root    [description]
 * @param  {[type]} options [description]
 * @return {[type]}         [description]
 */
module.exports = (root = '.', options) => {
  root = resolve(root);
  const isWithinRoot = filename => {
    const pathname = relative(root, filename);
    return pathname !== '..' && !pathname.startsWith('..' + sep) && !isAbsolute(pathname);
  };
  const defaults = {
    index: 'index.html',
    listDirectory: false,
  };
  const {
    index, listDirectory,
  } = Object.assign({}, defaults, options);
  /**
   * [function description]
   * @param  {[type]}   req  [description]
   * @param  {[type]}   res  [description]
   * @param  {Function} next [description]
   * @return {[type]}        [description]
   */
  return async (req, res, next) => {
    const { pathname } = url.parse(req.url);
    let filename = join(root, pathname);
    if (!isWithinRoot(filename)) return next();
    const sendFile = async (filename, s) => {
      const mtime = new Date(s.mtimeMs).toUTCString();
      if (req.headers['if-modified-since'] === mtime) {
        res.writeHead(304);
        return res.end();
      }
      res.statusCode = 200;
      const type = mime.lookup(filename);
      const charset = /^text\/|^application\/(javascript|json)/.test(type) ? 'UTF-8' : false;
      res.setHeader('Last-Modified', mtime);
      res.setHeader('Content-Length', s.size);
      res.setHeader('Content-Type', type + (charset ? '; charset=' + charset : ''));
      fs.createReadStream(filename).pipe(res);
    };
    const [err, s] = await call(stat(filename));
    if (err) return next(err);
    if (s.isDirectory()) {
      if (index) {
        const a = join(filename, index);
        if (!isWithinRoot(a)) return next();
        const [err, b] = await call(stat(a));
        if (!err) return sendFile(a, b);
      };
      if (listDirectory === true) 
        return renderDirectory(root, filename, res);
      return next();
    }
    return sendFile(filename, s);
  };
};
/**
 * [renderDirectory description]
 * @param  {[type]}   dir      [description]
 * @param  {Function} callback [description]
 * @return {[type]}            [description]
 */
async function renderDirectory(cwd, dir, res) {
  var content = '';
  content += '<h1>Index of ' + dir.replace(cwd, '') + '</h1>';
  content += '<hr />';
  fs.readdir(dir, async (err, files) => {
    if (err) return;
    content += '<table style="min-width: 50%;" >';
    content += '<tr>';
    content += '<th style="text-align: left;" >name</th>';
    content += '<th>date</th>';
    content += '<th>size</th>';
    content += '</tr>';
    content += '<tr>';
    content += '<td><a href="..">../</a></td>';
    content += '</tr>';
    for (let filename of files) {
      const s = await stat(join(dir, filename));
      filename = filename + (s.isDirectory() ? '/' : '');
      content += '<tr>';
      content += '<td><a href="' + filename + '">' + filename + '</a></td>';
      content += '<td style="text-align: center;" >' + (s.mtime || '-') + '</td>';
      content += '<td style="text-align: center;" >' + (s.size) + '</td>';
      content += '</tr>';
    }
    content += '</table>';
    content += '<hr/>';
    content += 'Powered by <a href="https://github.com/song940/kelp-static" >kelp-static</a>';
    res.setHeader('Content-Type', 'text/html');
    res.end(content);
  });
}
