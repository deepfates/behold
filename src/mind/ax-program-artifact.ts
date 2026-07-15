import { createHash } from 'node:crypto';

export const AX_VERSION = '23.0.0' as const;
export const AX_RESIDENT_PROGRAM_ID = 'behold.resident-decision.v1' as const;
export const AX_RESIDENT_PROTOCOL_DESCRIPTION =
  'Propose exactly one next action from the bounded context and admitted affordances. Never execute an action or claim that a consequence happened. actionName must exactly equal one admittedActionNames value.' as const;
export const AX_RESIDENT_SIGNATURE = `
  "${AX_RESIDENT_PROTOCOL_DESCRIPTION}"
  policyGuidance:string,
  profiles:json,
  livedContext:json,
  currentObservation:json,
  attention?:json,
  admittedActionNames:string[],
  admittedActions:json,
  requiredAction?:string
  ->
  disposition:class "act, wait, no_action",
  actionName?:string,
  actionInput?:json,
  utterance?:string,
  waitReason?:string
` as const;

/** Hash of Ax 23.0.0's canonical rendering of AX_RESIDENT_SIGNATURE. */
export const AX_RESIDENT_SIGNATURE_SHA256 =
  '286fe2c6d65cd6340453bdf0cabd77f8cd29c0825ae603db71f45d9b4b23ed2e' as const;

const DEFAULT_INSTRUCTION = [
  'Use the supplied policy guidance and lived evidence without inventing hidden world state.',
].join('\n');

const ARTIFACT_FIELDS = new Set([
  'protocol',
  'axVersion',
  'programId',
  'signatureSha256',
  'instruction',
  'demos',
]);
const TRACE_FIELDS = new Set([
  'policyGuidance',
  'profiles',
  'livedContext',
  'currentObservation',
  'attention',
  'admittedActionNames',
  'admittedActions',
  'requiredAction',
  'disposition',
  'actionName',
  'actionInput',
  'utterance',
  'waitReason',
]);
const INPUT_FIELDS = new Set([
  'policyGuidance',
  'profiles',
  'livedContext',
  'currentObservation',
  'attention',
  'admittedActionNames',
  'admittedActions',
  'requiredAction',
]);
const OUTPUT_FIELDS = new Set([
  'disposition',
  'actionName',
  'actionInput',
  'utterance',
  'waitReason',
]);

export type AxResidentDemo = Readonly<{
  programId: typeof AX_RESIDENT_PROGRAM_ID;
  traces: readonly Readonly<Record<string, unknown>>[];
}>;

export type AxResidentProgramArtifact = Readonly<{
  protocol: 'behold.ax-resident-program.v1';
  axVersion: typeof AX_VERSION;
  programId: typeof AX_RESIDENT_PROGRAM_ID;
  signatureSha256: typeof AX_RESIDENT_SIGNATURE_SHA256;
  instruction: string;
  demos: readonly AxResidentDemo[];
}>;

export type AxResidentProgramIdentity = Readonly<{
  protocol: 'behold.mind-program-identity.v1';
  name: typeof AX_RESIDENT_PROGRAM_ID;
  artifactProtocol: AxResidentProgramArtifact['protocol'];
  artifactSha256: string;
  signatureSha256: typeof AX_RESIDENT_SIGNATURE_SHA256;
  runtime: { name: 'ax'; version: typeof AX_VERSION };
}>;

export function defaultAxResidentProgramArtifact(): AxResidentProgramArtifact {
  return parseAxResidentProgramArtifact({
    protocol: 'behold.ax-resident-program.v1',
    axVersion: AX_VERSION,
    programId: AX_RESIDENT_PROGRAM_ID,
    signatureSha256: AX_RESIDENT_SIGNATURE_SHA256,
    instruction: DEFAULT_INSTRUCTION,
    demos: [],
  });
}

/** Strictly parse JSON so ignored fields cannot silently change artifact identity. */
export function parseAxResidentProgramArtifact(value: unknown): AxResidentProgramArtifact {
  const artifact = plainObject(value, 'Ax resident program artifact');
  assertExactFields(artifact, ARTIFACT_FIELDS, 'Ax resident program artifact');
  if (artifact.protocol !== 'behold.ax-resident-program.v1') {
    throw new Error('unsupported Ax resident program artifact protocol');
  }
  if (artifact.axVersion !== AX_VERSION) {
    throw new Error(`Ax resident program requires @ax-llm/ax ${AX_VERSION}`);
  }
  if (artifact.programId !== AX_RESIDENT_PROGRAM_ID) {
    throw new Error(`Ax resident program id must be ${AX_RESIDENT_PROGRAM_ID}`);
  }
  if (artifact.signatureSha256 !== AX_RESIDENT_SIGNATURE_SHA256) {
    throw new Error('Ax resident program signature does not match this controller contract');
  }
  if (typeof artifact.instruction !== 'string' || !artifact.instruction.trim()) {
    throw new Error('Ax resident program instruction must be a non-empty string');
  }
  if (!Array.isArray(artifact.demos)) {
    throw new Error('Ax resident program demos must be an array');
  }
  const demos = artifact.demos.map((candidate, demoIndex) => {
    const demo = plainObject(candidate, `Ax resident demo ${demoIndex}`);
    assertExactFields(demo, new Set(['programId', 'traces']), `Ax resident demo ${demoIndex}`);
    if (demo.programId !== AX_RESIDENT_PROGRAM_ID) {
      throw new Error(`Ax resident demo ${demoIndex} has the wrong program id`);
    }
    if (!Array.isArray(demo.traces) || demo.traces.length === 0) {
      throw new Error(`Ax resident demo ${demoIndex} must contain at least one trace`);
    }
    const traces = demo.traces.map((candidateTrace, traceIndex) => {
      const trace = plainObject(
        candidateTrace,
        `Ax resident demo ${demoIndex} trace ${traceIndex}`,
      );
      for (const field of Object.keys(trace)) {
        if (!TRACE_FIELDS.has(field)) {
          throw new Error(`Ax resident demo ${demoIndex} trace has unknown field ${field}`);
        }
      }
      assertJsonValue(trace, `Ax resident demo ${demoIndex} trace ${traceIndex}`);
      validateTraceFields(trace, `Ax resident demo ${demoIndex} trace ${traceIndex}`);
      return JSON.parse(JSON.stringify(trace)) as Record<string, unknown>;
    });
    return { programId: AX_RESIDENT_PROGRAM_ID, traces };
  });
  return deepFreezeJson({
    protocol: 'behold.ax-resident-program.v1',
    axVersion: AX_VERSION,
    programId: AX_RESIDENT_PROGRAM_ID,
    signatureSha256: AX_RESIDENT_SIGNATURE_SHA256,
    instruction: artifact.instruction,
    demos,
  });
}

/**
 * Normalize Ax optimizer output into the narrow inference artifact Behold runs.
 * Scores, histories, model configuration, and signature mutations are not runtime behavior.
 */
export function axResidentProgramFromOptimization(
  value: unknown,
  baseline = defaultAxResidentProgramArtifact(),
): AxResidentProgramArtifact {
  const optimized = plainObject(value, 'Ax optimized program');
  if (optimized.modelConfig != null) {
    throw new Error('Ax resident program v1 does not admit optimizer model configuration');
  }
  const componentMap =
    optimized.componentMap == null
      ? {}
      : plainObject(optimized.componentMap, 'Ax optimized component map');
  const instructionKey = `${AX_RESIDENT_PROGRAM_ID}::instruction`;
  const descriptionKey = `${AX_RESIDENT_PROGRAM_ID}::description`;
  for (const [key, candidate] of Object.entries(componentMap)) {
    if (key === descriptionKey && candidate === AX_RESIDENT_PROTOCOL_DESCRIPTION) continue;
    if (key !== instructionKey) {
      throw new Error(`Ax resident optimization may not mutate component ${key}`);
    }
  }
  const instruction = componentMap[instructionKey] ?? baseline.instruction;
  if (typeof instruction !== 'string') {
    throw new Error('Ax optimized resident instruction must be a string');
  }
  return parseAxResidentProgramArtifact({
    ...baseline,
    instruction,
    demos: optimized.demos ?? baseline.demos,
  });
}

export function axResidentProgramIdentity(
  artifact: AxResidentProgramArtifact,
): AxResidentProgramIdentity {
  const parsed = parseAxResidentProgramArtifact(artifact);
  return Object.freeze({
    protocol: 'behold.mind-program-identity.v1',
    name: AX_RESIDENT_PROGRAM_ID,
    artifactProtocol: parsed.protocol,
    artifactSha256: sha256(stableJson(parsed)),
    signatureSha256: AX_RESIDENT_SIGNATURE_SHA256,
    runtime: Object.freeze({ name: 'ax', version: AX_VERSION }),
  });
}

function plainObject(value: unknown, label: string): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`${label} must be a plain object`);
  }
  return value as Record<string, any>;
}

function assertExactFields(value: Record<string, unknown>, allowed: Set<string>, label: string) {
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) throw new Error(`${label} has unknown field ${field}`);
  }
  for (const field of allowed) {
    if (!(field in value)) throw new Error(`${label} is missing field ${field}`);
  }
}

function assertJsonValue(value: unknown, label: string) {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) assertJsonValue(item, label);
    return;
  }
  if (value && typeof value === 'object') {
    plainObject(value, label);
    for (const item of Object.values(value as Record<string, unknown>)) {
      assertJsonValue(item, label);
    }
    return;
  }
  throw new Error(`${label} must contain only JSON values`);
}

function validateTraceFields(trace: Record<string, unknown>, label: string) {
  const fields = Object.keys(trace);
  if (!fields.some((field) => INPUT_FIELDS.has(field))) {
    throw new Error(`${label} must contain at least one program input`);
  }
  if (!fields.some((field) => OUTPUT_FIELDS.has(field))) {
    throw new Error(`${label} must contain at least one program output`);
  }
  for (const [field, value] of Object.entries(trace)) {
    if (
      ['policyGuidance', 'requiredAction', 'actionName', 'utterance', 'waitReason'].includes(
        field,
      ) &&
      typeof value !== 'string'
    ) {
      throw new Error(`${label} field ${field} must be a string`);
    }
    if (field === 'disposition' && value !== 'act' && value !== 'wait' && value !== 'no_action') {
      throw new Error(`${label} field disposition is invalid`);
    }
    if (
      field === 'admittedActionNames' &&
      (!Array.isArray(value) || value.some((item) => typeof item !== 'string'))
    ) {
      throw new Error(`${label} field admittedActionNames must be a string array`);
    }
    if (field === 'admittedActions' && !Array.isArray(value)) {
      throw new Error(`${label} field admittedActions must be an array`);
    }
  }
}

function deepFreezeJson<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreezeJson(nested);
  }
  return value;
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function stableJson(value: any): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
