#!/usr/bin/env node
/**
 * Release packaging.
 *
 *   node scripts/package.mjs [--skip-build] [--target=chrome|firefox|all]
 *
 * Produces in artifacts/:
 *   veil-chrome-<version>.zip    Chrome Web Store upload
 *   veil-firefox-<version>.zip   addons.mozilla.org upload
 *   veil-source-<version>.zip    source archive for store review
 *                                (models excluded: `npm run models` re-fetches
 *                                them and verifies their pinned hashes)
 *   SHA256SUMS
 *
 * Before zipping, each build is verified: manifest version matches
 * package.json, no source maps or dev-only files, no eval-style code,
 * every model file matches the hash recorded in models.json.
 * Archives are reproducible (see scripts/lib/zip.mjs).
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createZip } from './lib/zip.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, value] = arg.replace(/^--/, '').split('=');
    return [key, value ?? true];
  }),
);
const targets = !args.target || args.target === 'all' ? ['chrome', 'firefox'] : [args.target];
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const outDir = path.join(root, 'artifacts');

const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const kb = (n) => `${(n / 1024).toFixed(0)} KB`;

async function listFiles(dir, base = dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(full, base)));
    else if (entry.isFile()) files.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return files;
}

/** Code patterns a store reviewer (and our CSP) would reject. */
const FORBIDDEN_CODE = [
  [/\beval\s*\(/, 'eval()'],
  [/\bnew Function\s*\(/, 'new Function()'],
  [/sourceMappingURL=/, 'source map reference'],
];

async function verifyBuild(target, dir) {
  const problems = [];
  const manifest = JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8'));
  if (manifest.version !== pkg.version) {
    problems.push(`manifest version ${manifest.version} ≠ package.json ${pkg.version}`);
  }
  if (manifest.manifest_version !== 3) problems.push('manifest_version is not 3');
  if (target === 'firefox' && manifest.permissions.includes('offscreen')) {
    problems.push('Firefox manifest requests the Chrome-only offscreen permission');
  }

  const files = await listFiles(dir);
  for (const file of files) {
    if (file.endsWith('.map')) problems.push(`source map shipped: ${file}`);
    if (/(^|\/)\.|\.(ts|tsx|mjs)$/.test(file)) problems.push(`unexpected file: ${file}`);
    if (/\.(js|html)$/.test(file)) {
      const text = await readFile(path.join(dir, file), 'utf8');
      for (const [pattern, label] of FORBIDDEN_CODE) {
        if (pattern.test(text)) problems.push(`${label} in ${file}`);
      }
    }
  }

  const registryPath = path.join(dir, 'models', 'models.json');
  if (!existsSync(registryPath)) {
    problems.push('models missing (was this a --test-model build?)');
  } else {
    const registry = JSON.parse(await readFile(registryPath, 'utf8'));
    for (const model of registry.models) {
      for (const [file, expected] of Object.entries(model.files)) {
        const full = path.join(dir, 'models', model.id, file);
        if (!existsSync(full)) problems.push(`model file missing: ${model.id}/${file}`);
        else if (sha256(await readFile(full)) !== expected) {
          problems.push(`model hash mismatch: ${model.id}/${file}`);
        }
      }
    }
  }
  return { problems, files };
}

async function zipDirectory(dir, files) {
  const entries = [];
  for (const name of files) entries.push({ name, data: await readFile(path.join(dir, name)) });
  return createZip(entries);
}

function sourceFiles() {
  const listed = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    cwd: root,
    encoding: 'utf8',
  });
  return listed
    .split('\0')
    .filter(Boolean)
    .filter((file) => existsSync(path.join(root, file)))
    .filter((file) => !file.startsWith('assets/models/') || file.endsWith('README.md'));
}

async function main() {
  if (!args['skip-build']) {
    for (const target of targets) {
      execFileSync(process.execPath, ['scripts/build.mjs', `--target=${target}`, '--mode=production'], {
        cwd: root,
        stdio: 'inherit',
      });
    }
  }

  await mkdir(outDir, { recursive: true });
  const sums = [];
  let failed = false;

  for (const target of targets) {
    const dir = path.join(root, 'dist', target);
    if (!existsSync(dir)) throw new Error(`dist/${target} not found; run without --skip-build`);
    const { problems, files } = await verifyBuild(target, dir);
    if (problems.length) {
      failed = true;
      console.error(`✗ ${target}:`);
      for (const problem of problems) console.error(`    - ${problem}`);
      continue;
    }
    const zip = await zipDirectory(dir, files);
    const name = `veil-${target}-${pkg.version}.zip`;
    await writeFile(path.join(outDir, name), zip);
    sums.push(`${sha256(zip)}  ${name}`);
    console.log(`  ✓ ${name.padEnd(28)} ${kb(zip.length).padStart(8)}  (${files.length} files)`);
  }

  const sources = sourceFiles();
  const sourceZip = createZip(
    await Promise.all(sources.map(async (name) => ({ name, data: await readFile(path.join(root, name)) }))),
  );
  const sourceName = `veil-source-${pkg.version}.zip`;
  await writeFile(path.join(outDir, sourceName), sourceZip);
  sums.push(`${sha256(sourceZip)}  ${sourceName}`);
  console.log(`  ✓ ${sourceName.padEnd(28)} ${kb(sourceZip.length).padStart(8)}  (${sources.length} files)`);

  await writeFile(path.join(outDir, 'SHA256SUMS'), sums.join('\n') + '\n');
  if (failed) {
    console.error('✗ Packaging failed verification; see above.');
    process.exit(1);
  }
  console.log(`  → ${path.relative(root, outDir)}/`);
}

main().catch((error) => {
  console.error(`✗ ${error.message}`);
  process.exit(1);
});
