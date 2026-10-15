'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

async function pack(destination) {
  const root = path.resolve(__dirname, '..');
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  const staging = await fs.mkdtemp(path.join(os.tmpdir(), 'static-pack-'));
  destination = path.resolve(destination || path.join(root, 'dist'));
  await fs.mkdir(destination, { recursive: true });
  if (!process.env.npm_execpath) throw new Error('Run this script with npm run pack:releases');
  try {
    for (const file of manifest.files) {
      await fs.cp(path.join(root, file), path.join(staging, file), { recursive: true });
    }
    const artifacts = [];
    for (const name of ['kelp-static', 'express-static']) {
      // Both names ship the same implementation, without a wrapper dependency.
      const release = { ...manifest, name, bin: { [name]: 'bin/server.js' } };
      delete release.scripts;
      delete release.devDependencies;
      await fs.writeFile(path.join(staging, 'package.json'), JSON.stringify(release, null, 2) + '\n');
      const output = execFileSync(process.execPath, [process.env.npm_execpath,
        'pack', '--json', '--ignore-scripts', '--pack-destination', destination
      ], { cwd: staging, encoding: 'utf8' });
      const metadata = JSON.parse(output)[0];
      artifacts.push({ name, version: release.version, path: path.join(destination, metadata.filename),
        shasum: metadata.shasum, integrity: metadata.integrity });
    }
    return artifacts;
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}

module.exports = pack;
if (require.main === module) {
  pack(process.argv[2]).then(artifacts => console.log(JSON.stringify(artifacts, null, 2))).catch(err => {
    console.error(err);
    process.exitCode = 1;
  });
}
