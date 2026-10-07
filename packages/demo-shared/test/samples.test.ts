import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  sampleFiles,
  TEST_CASES,
  TEST_CASES_REF,
  testCasePath,
  testCaseUrl,
} from '../src/samples.js';

const samplesDir = fileURLToPath(new URL('../../../spec/samples/', import.meta.url));

describe('samples', () => {
  it('lists files that exist', () => {
    for (const file of sampleFiles()) expect(existsSync(samplesDir + file), file).toBe(true);
    for (const t of TEST_CASES) expect(existsSync(samplesDir + testCasePath(t)), t.id).toBe(true);
  });

  it('ships no IPC consortium test case', () => {
    expect(sampleFiles().filter((f) => f.startsWith('ipc-testcases/'))).toEqual([]);
  });

  it('links the test cases at the release tag of this version', () => {
    const { version } = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    );
    expect(TEST_CASES_REF).toBe(`v${version}`);
    const testcase1 = TEST_CASES.find((t) => t.id === 'testcase1');
    expect(testcase1 && testCaseUrl(testcase1)).toBe(
      `https://github.com/midub/boardui/raw/v${version}/spec/samples/ipc-testcases/testcase1-RevC-Assembly.xml`,
    );
  });
});
