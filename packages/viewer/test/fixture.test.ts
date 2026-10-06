import Ajv2020 from 'ajv/dist/2020.js';
import { validateBytes } from 'gltf-validator';
import { describe, expect, it } from 'vitest';
import boardSchema from '../../../spec/schema/BOARDUI_board.schema.json' with { type: 'json' };
import extrasSchema from '../../../spec/schema/component-extras.schema.json' with { type: 'json' };
import { denseBoardGlb, smallBoardGlb } from './fixture/boards.js';
import { glbJson } from './helpers.js';

describe.each([
  ['small', smallBoardGlb],
  ['dense (4 × 4)', () => denseBoardGlb(4)],
])('%s fixture', (_, generate) => {
  const glb = generate();
  const json = glbJson(glb);

  it('passes the Khronos glTF validator', async () => {
    const report = await validateBytes(glb, { format: 'glb', maxIssues: 50 });
    const messages = report.issues.messages
      .filter((m) => m.severity <= 1)
      .map((m) => `${m.code} ${m.pointer ?? ''}: ${m.message}`);
    expect(messages).toEqual([]);
  });

  it('matches the BOARDUI_board schema', () => {
    const validate = new Ajv2020({ allErrors: true }).compile(boardSchema);
    expect(validate(json.extensions.BOARDUI_board), JSON.stringify(validate.errors)).toBe(true);
  });

  it('gives every component node extras that match the schema', () => {
    const validate = new Ajv2020({ allErrors: true }).compile(extrasSchema);
    const components = json.nodes.find((n) => n.name === 'components');
    expect(components?.children?.length).toBeGreaterThan(0);
    for (const index of components?.children ?? []) {
      expect(validate(json.nodes[index]?.extras), JSON.stringify(validate.errors)).toBe(true);
    }
  });

  it('declares the extensions as used but not required (§2)', () => {
    expect(json.extensionsUsed).toEqual(
      expect.arrayContaining(['BOARDUI_board', 'EXT_mesh_features', 'EXT_structural_metadata']),
    );
    expect(json.extensionsRequired).toBeUndefined();
  });
});
