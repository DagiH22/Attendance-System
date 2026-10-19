#!/usr/bin/env node
require('./guard-db.js');
const { spawn } = require('child_process');

const args = process.argv.slice(2);
const prismaCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const child = spawn(prismaCmd, ['prisma', ...args], {
  stdio: 'inherit',
  shell: true,
  env: process.env,
});

child.on('exit', (code) => {
  process.exit(code || 0);
});
