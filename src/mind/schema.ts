const SUPPORTED_KEYS = new Set([
  'type',
  'properties',
  'required',
  'enum',
  'minimum',
  'maximum',
  'description',
  'items',
]);

export type ResidentSchemaValidation =
  Readonly<{ ok: true }> | Readonly<{ ok: false; errors: readonly string[] }>;

/** Validate a proposal against the exact JSON-Schema subset Behold publishes. */
export function validateResidentActionInput(
  value: unknown,
  schemaValue: unknown,
): ResidentSchemaValidation {
  const errors: string[] = [];
  validateNode(value, schemaValue, '$', errors);
  return errors.length ? { ok: false, errors } : { ok: true };
}

function validateNode(value: unknown, schemaValue: unknown, path: string, errors: string[]) {
  if (!schemaValue || typeof schemaValue !== 'object' || Array.isArray(schemaValue)) {
    errors.push(`${path}: schema is not an object`);
    return;
  }
  const schema = schemaValue as Record<string, any>;
  const unsupported = Object.keys(schema).filter((key) => !SUPPORTED_KEYS.has(key));
  if (unsupported.length) {
    errors.push(`${path}: schema uses unsupported keys ${unsupported.join(', ')}`);
    return;
  }
  const type = String(schema.type || '');
  if (
    Array.isArray(schema.enum) &&
    !schema.enum.some((candidate: unknown) => sameJson(candidate, value))
  ) {
    errors.push(`${path}: value is outside enum`);
  }
  if (type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      errors.push(`${path}: expected object`);
      return;
    }
    const object = value as Record<string, unknown>;
    const properties = schema.properties;
    if (!properties || typeof properties !== 'object' || Array.isArray(properties)) {
      errors.push(`${path}: object schema has no properties`);
      return;
    }
    const required = Array.isArray(schema.required) ? schema.required.map(String) : [];
    for (const name of required) {
      if (!Object.prototype.hasOwnProperty.call(object, name)) {
        errors.push(`${path}.${name}: required field is missing`);
      }
    }
    for (const [name, childSchema] of Object.entries(properties)) {
      if (Object.prototype.hasOwnProperty.call(object, name)) {
        validateNode(object[name], childSchema, `${path}.${name}`, errors);
      }
    }
    return;
  }
  if (type === 'array') {
    if (!Array.isArray(value)) {
      errors.push(`${path}: expected array`);
      return;
    }
    if (!schema.items) {
      errors.push(`${path}: array schema has no items`);
      return;
    }
    value.forEach((item, index) => validateNode(item, schema.items, `${path}[${index}]`, errors));
    return;
  }
  if (type === 'string') {
    if (typeof value !== 'string') errors.push(`${path}: expected string`);
    return;
  }
  if (type === 'boolean') {
    if (typeof value !== 'boolean') errors.push(`${path}: expected boolean`);
    return;
  }
  if (type !== 'number' && type !== 'integer') {
    errors.push(`${path}: unsupported type ${type || '(missing)'}`);
    return;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    errors.push(`${path}: expected finite ${type}`);
    return;
  }
  if (type === 'integer' && !Number.isInteger(value)) errors.push(`${path}: expected integer`);
  if (schema.minimum != null && value < Number(schema.minimum)) {
    errors.push(`${path}: value is below minimum ${schema.minimum}`);
  }
  if (schema.maximum != null && value > Number(schema.maximum)) {
    errors.push(`${path}: value is above maximum ${schema.maximum}`);
  }
}

function sameJson(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}
