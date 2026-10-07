import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { checkDist } from '../src/build/check-dist.js';
import {
  sampleSizes,
  stageSamples,
  testCaseSources,
  writeSampleSizes,
} from '../src/build/samples.js';
import { serveSite } from '../src/build/serve.js';
import { redirectPage } from '../src/build/site.js';
import { sampleFiles } from '../src/samples.js';

const tmp = mkdtempSync(join(tmpdir(), 'demo-shared-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('build helpers', () => {
  it('stages the samples and knows their sizes', async () => {
    const sizes = sampleSizes();
    // From the manifest: the test cases needn't be fetched.
    expect(sizes['ipc-testcases/testcase3-RevC-Assembly.xml']).toBe(823_280);
    const out = join(tmp, 'dist');
    stageSamples(out);
    for (const f of sampleFiles()) {
      expect(readFileSync(join(out, 'samples', f)).byteLength, f).toBe(sizes[f]);
    }
    expect(checkDist(out)).toBe(sampleFiles().length);
    writeSampleSizes(tmp);
    const { SAMPLE_SIZES } = await import(join(tmp, 'sizes.js'));
    expect(SAMPLE_SIZES).toEqual(sizes);
  });

  it('fails on IPC consortium test data', () => {
    const out = join(tmp, 'bad');
    mkdirSync(join(out, 'assets'), { recursive: true });
    writeFileSync(join(out, 'assets', 'TESTCASE3-RevC-Assembly.xml'), 'renamed');
    expect(() => checkDist(out)).toThrow(/assets\/TESTCASE3-RevC-Assembly\.xml$/m);
    // A test case under another name, found by its SHA-256 in the manifest.
    writeFileSync(join(out, 'board.xml'), 'a test case');
    const sha256 = createHash('sha256').update('a test case').digest('hex');
    const testCases = [...testCaseSources(), { file: 'other.xml', sha256 }];
    expect(() => checkDist(out, testCases)).toThrow(/^ {2}board\.xml \(content of other\.xml\)$/m);
  });

  it('redirects to the default demo, keeping the query and hash', () => {
    const page = redirectPage();
    expect(page).toContain("location.replace('react/' + location.search + location.hash)");
    expect(page).toContain('<meta http-equiv="refresh" content="0; url=react/" />');
  });

  it('serves a site at /boardui/', async () => {
    const site = join(tmp, 'site');
    mkdirSync(join(site, 'react'), { recursive: true });
    writeFileSync(join(site, 'index.html'), redirectPage());
    writeFileSync(join(site, 'react', 'index.html'), '<p>react</p>');
    writeFileSync(join(site, 'react', 'm.wasm'), 'wasm');
    const server = serveSite(site, 0);
    await new Promise((resolve) => server.once('listening', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const get = (path: string) => fetch(base + path, { redirect: 'manual' });
      expect((await get('/boardui?sample=x')).headers.get('location')).toBe('/boardui/?sample=x');
      expect(await (await get('/boardui/?sample=x')).text()).toContain('location.replace');
      expect(await (await get('/boardui/react/?sample=x')).text()).toBe('<p>react</p>');
      expect((await get('/boardui/react/m.wasm')).headers.get('content-type')).toBe(
        'application/wasm',
      );
      expect((await get('/boardui/angular/')).status).toBe(404);
      expect((await get('/boardui/%2e%2e/%2e%2e/package.json')).status).toBe(404);
      expect((await get('/other/')).status).toBe(404);
    } finally {
      server.close();
    }
  });
});
