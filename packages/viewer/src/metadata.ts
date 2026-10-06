/**
 * A small reader for `EXT_structural_metadata` property tables (spec §8.2).
 *
 * It reads whole columns at once: the viewer builds its indices (feature → net, net → features …)
 * from them at load time. Scalar, enum and string properties are supported, which covers the
 * boardui schema; columns of other types are skipped, so newer minor profile versions still load.
 */

/** Typed array holding a numeric or enum column. */
export type NumericArray =
  | Int8Array
  | Uint8Array
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | Float32Array
  | Float64Array;

/** One decoded property column. */
export type Column =
  | { readonly kind: 'number'; readonly values: NumericArray; readonly noData: number | null }
  | { readonly kind: 'string'; readonly values: readonly string[]; readonly noData: string | null }
  | {
      readonly kind: 'enum';
      readonly values: NumericArray;
      readonly names: ReadonlyMap<number, string>;
      readonly noData: string | null;
    };

/** A property value as returned by {@link PropertyTable.get}: enums are returned by name. */
export type PropertyValue = number | string | null;

/** JSON of the root `EXT_structural_metadata` extension, as far as this reader uses it. */
export interface StructuralMetadataJson {
  schema?: SchemaJson;
  schemaUri?: string;
  propertyTables?: PropertyTableJson[];
}

interface SchemaJson {
  id: string;
  version?: string;
  enums?: Record<string, { valueType?: string; values: { name: string; value: number }[] }>;
  classes?: Record<string, { properties?: Record<string, ClassPropertyJson> }>;
}

interface ClassPropertyJson {
  type: string;
  componentType?: string;
  enumType?: string;
  array?: boolean;
  normalized?: boolean;
  offset?: unknown;
  scale?: unknown;
  noData?: unknown;
  required?: boolean;
}

interface PropertyTableJson {
  name?: string;
  class: string;
  count: number;
  properties?: Record<string, TablePropertyJson>;
}

interface TablePropertyJson {
  values: number;
  stringOffsets?: number;
  stringOffsetType?: string;
  offset?: unknown;
  scale?: unknown;
}

type ArrayConstructor = new (buffer: ArrayBuffer, byteOffset?: number, length?: number) => NumericArray;

const COMPONENT_TYPES: Readonly<Record<string, ArrayConstructor>> = {
  INT8: Int8Array,
  UINT8: Uint8Array,
  INT16: Int16Array,
  UINT16: Uint16Array,
  INT32: Int32Array,
  UINT32: Uint32Array,
  FLOAT32: Float32Array,
  FLOAT64: Float64Array,
};

/** A decoded property table. */
export class PropertyTable {
  readonly #columns: ReadonlyMap<string, Column>;

  /**
   * @param name Table name (`nets`, `layer/TOP` …).
   * @param className Schema class of the rows.
   * @param count Number of rows.
   * @param columns Decoded columns by property name.
   */
  constructor(
    readonly name: string,
    readonly className: string,
    readonly count: number,
    columns: ReadonlyMap<string, Column>,
  ) {
    this.#columns = columns;
  }

  /** Names of the decoded properties. */
  get properties(): string[] {
    return [...this.#columns.keys()];
  }

  /** The raw column of a property, or `undefined` if the table doesn't have it. */
  column(property: string): Column | undefined {
    return this.#columns.get(property);
  }

  /**
   * Value of one property of one row. Enums are returned by name. Missing properties and
   * `noData` values give `null`.
   */
  get(property: string, row: number): PropertyValue {
    const column = this.#columns.get(property);
    if (!column || row < 0 || row >= this.count) {
      return null;
    }
    switch (column.kind) {
      case 'number':
      case 'string': {
        const value = column.values[row] ?? null;
        return value === column.noData ? null : value;
      }
      case 'enum': {
        const name = column.names.get(column.values[row] ?? -1) ?? null;
        return name === column.noData ? null : name;
      }
    }
  }

  /** All properties of a row, as {@link get} returns them. */
  row(row: number): Record<string, PropertyValue> {
    const result: Record<string, PropertyValue> = {};
    for (const property of this.#columns.keys()) {
      result[property] = this.get(property, row);
    }
    return result;
  }
}

/**
 * Decodes every property table of an `EXT_structural_metadata` root extension.
 *
 * @param extension The root extension JSON. It must embed its schema (spec §8.2).
 * @param bufferView Returns the bytes of a glTF buffer view.
 */
export function parsePropertyTables(
  extension: StructuralMetadataJson,
  bufferView: (index: number) => ArrayBuffer,
): PropertyTable[] {
  const schema = extension.schema;
  if (!schema) {
    throw new Error('EXT_structural_metadata must embed its schema (spec §8.2)');
  }
  return (extension.propertyTables ?? []).map((table, index) => {
    const classProperties = schema.classes?.[table.class]?.properties;
    if (!classProperties) {
      throw new Error(`Property table ${index} uses unknown class "${table.class}"`);
    }
    const columns = new Map<string, Column>();
    for (const [name, property] of Object.entries(table.properties ?? {})) {
      const definition = classProperties[name];
      if (!definition) {
        throw new Error(`Property table "${table.name}" has property "${name}" not in its class`);
      }
      const column = readColumn(schema, definition, property, table.count, bufferView);
      if (column) {
        columns.set(name, column);
      }
    }
    for (const [name, definition] of Object.entries(classProperties)) {
      if (definition.required && !table.properties?.[name]) {
        throw new Error(`Property table "${table.name}" lacks required property "${name}"`);
      }
    }
    return new PropertyTable(table.name ?? String(index), table.class, table.count, columns);
  });
}

function readColumn(
  schema: SchemaJson,
  definition: ClassPropertyJson,
  property: TablePropertyJson,
  count: number,
  bufferView: (index: number) => ArrayBuffer,
): Column | null {
  const transformed =
    definition.normalized ||
    definition.offset !== undefined ||
    definition.scale !== undefined ||
    property.offset !== undefined ||
    property.scale !== undefined;
  if (definition.array || transformed) {
    return null;
  }
  switch (definition.type) {
    case 'SCALAR': {
      const type = COMPONENT_TYPES[definition.componentType ?? ''];
      if (!type) {
        return null;
      }
      const noData = typeof definition.noData === 'number' ? definition.noData : null;
      return { kind: 'number', values: typedArray(type, bufferView(property.values), count), noData };
    }
    case 'ENUM': {
      const enumDef = schema.enums?.[definition.enumType ?? ''];
      const type = COMPONENT_TYPES[enumDef?.valueType ?? 'UINT16'];
      if (!enumDef || !type) {
        return null;
      }
      const names = new Map(enumDef.values.map((v) => [v.value, v.name] as const));
      const noData = typeof definition.noData === 'string' ? definition.noData : null;
      return {
        kind: 'enum',
        values: typedArray(type, bufferView(property.values), count),
        names,
        noData,
      };
    }
    case 'STRING': {
      if (property.stringOffsets === undefined) {
        throw new Error('A STRING property needs stringOffsets');
      }
      const offsetType = COMPONENT_TYPES[property.stringOffsetType ?? 'UINT32'];
      if (!offsetType) {
        return null;
      }
      const offsets = typedArray(offsetType, bufferView(property.stringOffsets), count + 1);
      const bytes = new Uint8Array(bufferView(property.values));
      const decoder = new TextDecoder();
      const values: string[] = new Array(count);
      for (let row = 0; row < count; row++) {
        values[row] = decoder.decode(bytes.subarray(offsets[row], offsets[row + 1]));
      }
      const noData = typeof definition.noData === 'string' ? definition.noData : null;
      return { kind: 'string', values, noData };
    }
    default:
      return null;
  }
}

function typedArray(type: ArrayConstructor, buffer: ArrayBuffer, length: number): NumericArray {
  const array = new type(buffer, 0, Math.floor(buffer.byteLength / bytesPerElement(type)));
  if (array.length < length) {
    throw new Error(`Property buffer view holds ${array.length} values, expected ${length}`);
  }
  return array.subarray(0, length);
}

function bytesPerElement(type: ArrayConstructor): number {
  return (type as unknown as { BYTES_PER_ELEMENT: number }).BYTES_PER_ELEMENT;
}
