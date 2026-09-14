import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

const tmpDir = path.resolve(process.cwd(), '.tmp');
if (!fs.existsSync(tmpDir)) {
  fs.mkdirSync(tmpDir, { recursive: true });
}

process.env.CONVEX_TMPDIR = tmpDir;

const child = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['convex', 'dev'], {
  stdio: 'inherit',
  env: process.env,
  shell: true,
});

child.on('exit', (code) => {
  console.log('Convex dev exited with code', code);
});
