// Runs the Khronos glTF validator on GLB files and fails if any of them has errors
// (spec §2: a conformant asset passes the validator with zero errors).
//
// Usage: node scripts/khronos-validate.mjs <validator-dir> <file.glb>...
// <validator-dir> is where the `gltf-validator` npm package is installed, for example with
// `npm install --prefix <validator-dir> gltf-validator`.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const [dir, ...files] = process.argv.slice(2);
if (!dir || files.length === 0) {
  console.error('usage: node scripts/khronos-validate.mjs <validator-dir> <file.glb>...');
  process.exit(2);
}
const validator = createRequire(path.resolve(dir, 'package.json'))('gltf-validator');

let failed = 0;
for (const file of files) {
  const report = await validator.validateBytes(new Uint8Array(readFileSync(file)), {
    maxIssues: 0,
    uri: path.basename(file),
  });
  const { numErrors, numWarnings, numInfos, numHints, messages } = report.issues;
  console.log(
    `${path.basename(file)}: ${numErrors} errors, ${numWarnings} warnings, ${numInfos} infos, ${numHints} hints`,
  );
  for (const message of messages.filter((m) => m.severity <= 1)) {
    console.log(`  ${message.code}: ${message.message} (${message.pointer ?? ''})`);
  }
  if (numErrors > 0) {
    failed += 1;
  }
}
process.exit(failed > 0 ? 1 : 0);
