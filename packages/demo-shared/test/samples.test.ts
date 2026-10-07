import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { testCaseSources } from '../src/build/samples.js';
import { sampleFiles, TEST_CASES, testCaseUrl } from '../src/samples.js';

const samplesDir = fileURLToPath(new URL('../../../spec/samples/', import.meta.url));

describe('samples', () => {
  it('lists files that exist', () => {
    for (const file of sampleFiles()) expect(existsSync(samplesDir + file), file).toBe(true);
  });

  it('ships no IPC consortium test case', () => {
    expect(sampleFiles().filter((f) => f.startsWith('ipc-testcases/'))).toEqual([]);
  });

  it("links the test cases to the consortium's archives in their manifest", () => {
    const sources = testCaseSources();
    for (const t of TEST_CASES) {
      expect(testCaseUrl(t), t.id).toBe(sources.find((s) => s.file === t.file)?.url);
      expect(testCaseUrl(t), t.id).toMatch(/^https:\/\/www\.ipc2581\.com\/.+\.zip$/);
    }
  });
});
