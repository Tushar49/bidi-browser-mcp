import { execSync } from 'node:child_process';

const npmCommand = 'npm pack --dry-run --json --ignore-scripts';

let raw;
try {
  raw = execSync(npmCommand, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
} catch (error) {
  const details = error.stderr?.toString?.() ?? error.message;
  console.error(`npm pack failed:\n${details}`);
  process.exit(1);
}

const start = raw.indexOf('[');
if (start === -1) {
  console.error(`Could not find npm pack JSON output:\n${raw}`);
  process.exit(1);
}

const [result] = JSON.parse(raw.slice(start));
const paths = result.files.map((file) => file.path);

const isAllowed = (path) =>
  /^(package\.json|readme(\..*)?|licen[cs]e(\..*)?|dist\/)/i.test(path) &&
  !path.endsWith('.map');

const unexpected = paths.filter((path) => !isAllowed(path));
const missing = ['dist/bin.js', 'dist/index.js', 'dist/index.d.ts'].filter(
  (path) => !paths.includes(path)
);
const sourceLeak = paths.filter((path) =>
  /(^|\/)(src|scripts|\.github|_archive|\.research|\.githooks)\//.test(path)
);

if (unexpected.length || missing.length || sourceLeak.length) {
  console.error('Published tarball is not dist-only:');
  if (unexpected.length) console.error(`  unexpected: ${unexpected.join(', ')}`);
  if (missing.length) console.error(`  missing: ${missing.join(', ')}`);
  if (sourceLeak.length) console.error(`  repo-only paths: ${sourceLeak.join(', ')}`);
  process.exit(1);
}

console.log(`Tarball verified: ${paths.length} files, all at dist/ or package metadata`);
console.log(paths.map((path) => `  ${path}`).join('\n'));
