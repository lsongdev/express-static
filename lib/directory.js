'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { contains, permitted } = require('./paths');

function escape(value) {
  return value.replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

module.exports = async function renderDirectory(root, dir, pathname, options) {
  const rows = [];
  const names = (await fs.readdir(dir)).sort();
  for (const name of names) {
    const filename = path.join(dir, name);
    if (!permitted(root, filename, options)) continue;
    try {
      const real = await fs.realpath(filename);
      if (!contains(root, real) || !permitted(root, real, options)) continue;
      const stat = await fs.stat(real);
      if (!stat.isFile() && !stat.isDirectory()) continue;
      const suffix = stat.isDirectory() ? '/' : '';
      rows.push('<li><a href="' + escape(encodeURIComponent(name) + suffix) + '">' +
        escape(name + suffix) + '</a></li>');
    } catch (err) {
      if (err.code !== 'ENOENT' && err.code !== 'ENOTDIR') throw err;
    }
  }
  const title = 'Index of ' + pathname;
  const parent = path.relative(root, dir) ? '<li><a href="../">../</a></li>' : '';
  return '<!doctype html><html><head><meta charset="utf-8"><title>' + escape(title) +
    '</title></head><body><h1>' + escape(title) + '</h1><ul>' + parent + rows.join('') +
    '</ul></body></html>\n';
};
