'use strict';

/*
 * Copies the built adapter into the local dev ioBroker (.dev-server/default) and restarts the instance.
 * Replaces `dev-server watch`, which does not work on Windows 11 without wmic.exe.
 * Usage: npm run dev:deploy   (the js-controller must run: npm run dev:start)
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const devRoot = path.join(root, '.dev-server', 'default');
const target = path.join(devRoot, 'node_modules', 'iobroker.objectmigrator');
const cli = path.join(devRoot, 'node_modules', 'iobroker.js-controller', 'iobroker.js');

if (!fs.existsSync(cli)) {
    console.error('No dev ioBroker found - run "npx dev-server setup" first');
    process.exit(1);
}

// a symlink would make the adapter search the js-controller in the project (CANNOT_FIND_ADAPTER_DIR)
if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) {
    fs.unlinkSync(target);
}
fs.mkdirSync(target, { recursive: true });

for (const entry of ['build', 'admin', 'io-package.json', 'package.json', 'LICENSE', 'README.md']) {
    const from = path.join(root, entry);
    if (!fs.existsSync(from)) {
        continue;
    }
    fs.rmSync(path.join(target, entry), { recursive: true, force: true });
    fs.cpSync(from, path.join(target, entry), { recursive: true });
}
console.log(`Copied adapter to ${target}`);

const iob = (...args) => execFileSync(process.execPath, [cli, ...args], { cwd: devRoot, stdio: 'inherit' });
iob('upload', 'objectmigrator');
iob('restart', 'objectmigrator');
