import { describe, expect, it } from 'vitest';
import { parsePropertyTables, type StructuralMetadataJson } from '../src/metadata.js';

/** Buffer views for the synthetic tables below. */
const views: ArrayBuffer[] = [
  Uint32Array.of(7, 4294967295, 0).buffer, // 0: refs
  Uint8Array.of(0, 2, 1).buffer, // 1: enum values
  new TextEncoder().encode('ab€').buffer, // 2: string bytes
  Uint32Array.of(0, 1, 1, 5).buffer, // 3: string offsets: 'a', '', 'b€'
  Float32Array.of(0.5, 1.5, 2.5).buffer, // 4: floats
];

const schema = {
  id: 'test',
  enums: {
    Kind: {
      valueType: 'UINT8',
      values: [
        { name: 'A', value: 0 },
        { name: 'B', value: 1 },
        { name: 'C', value: 2 },
      ],
    },
  },
  classes: {
    thing: {
      properties: {
        ref: { type: 'SCALAR', componentType: 'UINT32', noData: 4294967295 },
        kind: { type: 'ENUM', enumType: 'Kind', noData: 'C' },
        label: { type: 'STRING', noData: '' },
        weight: { type: 'SCALAR', componentType: 'FLOAT32', required: true },
        tags: { type: 'STRING', array: true },
        optional: { type: 'STRING' },
      },
    },
  },
};

const extension = (properties: Record<string, unknown>): StructuralMetadataJson =>
  ({ schema, propertyTables: [{ name: 'things', class: 'thing', count: 3, properties }] }) as never;

const read = (index: number) => views[index] as ArrayBuffer;

describe('parsePropertyTables', () => {
  const [table] = parsePropertyTables(
    extension({
      ref: { values: 0 },
      kind: { values: 1 },
      label: { values: 2, stringOffsets: 3 },
      weight: { values: 4 },
      tags: { values: 2, arrayOffsets: 3, stringOffsets: 3 },
    }),
    read,
  );
  if (!table) throw new Error('no table');

  it('reads name, class and row count', () => {
    expect([table.name, table.className, table.count]).toEqual(['things', 'thing', 3]);
  });

  it('reads scalar, enum and string columns, mapping noData to null', () => {
    expect([0, 1, 2].map((row) => table.row(row))).toEqual([
      { ref: 7, kind: 'A', label: 'a', weight: 0.5 },
      { ref: null, kind: null, label: null, weight: 1.5 },
      { ref: 0, kind: 'B', label: 'b€', weight: 2.5 },
    ]);
  });

  it('exposes whole columns for bulk reads', () => {
    const column = table.column('ref');
    expect(column?.kind).toBe('number');
    expect(column?.values).toEqual(Uint32Array.of(7, 4294967295, 0));
  });

  it('skips unsupported columns and returns null for absent properties', () => {
    expect(table.properties).not.toContain('tags');
    expect(table.get('tags', 0)).toBeNull();
    expect(table.get('optional', 0)).toBeNull();
    expect(table.get('ref', 3)).toBeNull();
  });

  it('rejects a missing required property', () => {
    expect(() => parsePropertyTables(extension({ ref: { values: 0 } }), read)).toThrow(
      /lacks required property "weight"/,
    );
  });

  it('rejects properties outside the class and buffers that are too short', () => {
    expect(() =>
      parsePropertyTables(extension({ weight: { values: 4 }, nope: { values: 0 } }), read),
    ).toThrow(/not in its class/);
    expect(() =>
      parsePropertyTables(
        {
          schema,
          propertyTables: [{ class: 'thing', count: 9, properties: { weight: { values: 4 } } }],
        },
        read,
      ),
    ).toThrow(/expected 9/);
  });

  it('requires an embedded schema', () => {
    expect(() => parsePropertyTables({ schemaUri: 'schema.json' }, read)).toThrow(/embed/);
  });
});
