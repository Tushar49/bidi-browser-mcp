import { readFileSync } from 'node:fs';

const pkg = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8')
);
const server = JSON.parse(
  readFileSync(new URL('../server.json', import.meta.url), 'utf8')
);
const tag = process.argv[2]?.replace(/^v/, '');

const mapperSource = readFileSync(
  new URL('../src/connection/chromium-mapper.ts', import.meta.url),
  'utf8'
);
const mapperPin = /const MAPPER_VERSION = '([^']+)'/.exec(mapperSource)?.[1];

const errors = [];

// The deep import into chromium-bidi is version-specific: keep the code pin,
// the npm metadata and the docs on one version.
if (mapperPin === undefined) {
  errors.push('chromium-mapper.ts has no MAPPER_VERSION pin');
} else if (pkg.optionalDependencies?.['chromium-bidi'] !== mapperPin) {
  errors.push(
    `package.json optionalDependencies.chromium-bidi "${pkg.optionalDependencies?.['chromium-bidi']}" != mapper pin "${mapperPin}"`
  );
} else {
  for (const file of ['README.md', 'docs/chromium-mapper.md']) {
    const text = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    if (!text.includes(mapperPin)) {
      errors.push(`${file} does not mention the chromium-bidi pin "${mapperPin}"`);
    }
  }
}

if (!pkg.mcpName) {
  errors.push('package.json is missing "mcpName"');
} else if (server.name !== pkg.mcpName) {
  errors.push(`server.json name "${server.name}" != package.json mcpName "${pkg.mcpName}"`);
}

if (server.version !== pkg.version) {
  errors.push(`server.json version "${server.version}" != package.json version "${pkg.version}"`);
}

const normalizeRepo = (url) =>
  (url ?? '')
    .replace(/^git\+/, '')
    .replace(/\.git$/, '')
    .replace(/\/$/, '');

if (normalizeRepo(server.repository?.url) !== normalizeRepo(pkg.repository?.url)) {
  errors.push('server.json repository.url does not match package.json repository.url');
}

const npmPackage = server.packages?.find(
  (entry) => entry.registryType === 'npm' && entry.identifier === pkg.name
);

if (!npmPackage) {
  errors.push(`server.json has no npm package entry for "${pkg.name}"`);
} else if (npmPackage.version !== pkg.version) {
  errors.push(
    `server.json npm package version "${npmPackage.version}" != package.json version "${pkg.version}"`
  );
}

if (tag && tag !== pkg.version) {
  errors.push(`git tag "v${tag}" != package.json version "${pkg.version}"`);
}

if (errors.length > 0) {
  console.error('Release metadata is not aligned:');
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log(
  `Release metadata aligned: ${pkg.name}@${pkg.version}${tag ? ` (tag v${tag})` : ''}`
);
