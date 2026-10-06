// Runs the Khronos glTF validator on GLB files and fails if any of them has an error or a
// warning (spec §2 requires zero errors; the conformance suite keeps warnings at zero too),
// except for the issue codes in ALLOWED.
//
// ALLOWED:
// - UNRESERVED_EXTENSION_PREFIX (warning): the `BOARDUI` vendor prefix of `BOARDUI_board` is
//   not registered with Khronos, by decision. Validator 2.0.0-dev.3.10 no longer reports it;
//   older versions do.
//
// Usage: node scripts/khronos-validate.mjs <validator-dir> <file.glb>...
// <validator-dir> is where the `gltf-validator` npm package is installed, for example with
// `npm install --prefix <validator-dir> gltf-validator`.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const ALLOWED = new Set(['UNRESERVED_EXTENSION_PREFIX']);
const ERROR = 0;
const WARNING = 1;

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
  let failing = 0;
  for (const message of messages.filter((m) => m.severity <= WARNING)) {
    const allowed = message.severity === WARNING && ALLOWED.has(message.code);
    if (!allowed) {
      failing += 1;
    }
    console.log(
      `  ${message.severity === ERROR ? 'error' : 'warning'} ${message.code}: ${message.message} (${message.pointer ?? ''})${allowed ? ' [allowed]' : ''}`,
    );
  }
  if (failing > 0) {
    failed += 1;
  }
}
if (failed > 0) {
  console.log(`${failed} of ${files.length} files have errors or warnings that are not allowed`);
}
process.exit(failed > 0 ? 1 : 0);
