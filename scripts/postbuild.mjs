import { chmodSync, readFileSync } from 'node:fs';

const binPath = new URL('../dist/bin.js', import.meta.url);
const firstLine = readFileSync(binPath, 'utf8').split('\n', 1)[0];

if (firstLine !== '#!/usr/bin/env node') {
  console.error(`dist/bin.js must start with "#!/usr/bin/env node" (found: ${firstLine})`);
  process.exit(1);
}

if (process.platform !== 'win32') {
  chmodSync(binPath, 0o755);
}

console.log('postbuild: dist/bin.js is executable and has a valid shebang');
