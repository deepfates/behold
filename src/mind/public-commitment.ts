export const RESIDENT_PUBLIC_ACTION_COMMITMENT_PROTOCOL =
  'behold.resident-public-action-commitment.v1' as const;
export const RESIDENT_PUBLIC_ACTION_COMMITMENT_MAX_CHARS = 240;

export type ResidentPublicActionCommitment = Readonly<{
  protocol: typeof RESIDENT_PUBLIC_ACTION_COMMITMENT_PROTOCOL;
  policyProfile: 'legible-resident-v1';
  intention: string;
  expectedObservableConsequence: string;
}>;

/**
 * Admit two short public commitments without trimming, correction, or tolerant
 * normalization. These fields are replayable speech, never private reasoning.
 */
export function residentPublicActionCommitment(value: unknown): ResidentPublicActionCommitment {
  const record = exactRecord(
    value,
    ['protocol', 'policyProfile', 'intention', 'expectedObservableConsequence'],
    'resident public action commitment',
  );
  if (record.protocol !== RESIDENT_PUBLIC_ACTION_COMMITMENT_PROTOCOL) {
    throw new Error(
      `resident public action commitment protocol must be ${RESIDENT_PUBLIC_ACTION_COMMITMENT_PROTOCOL}`,
    );
  }
  if (record.policyProfile !== 'legible-resident-v1') {
    throw new Error('resident public action commitment belongs to a different policy treatment');
  }
  return deepFreeze({
    protocol: RESIDENT_PUBLIC_ACTION_COMMITMENT_PROTOCOL,
    policyProfile: 'legible-resident-v1',
    intention: exactPublicLine(record.intention, 'public intention'),
    expectedObservableConsequence: exactPublicLine(
      record.expectedObservableConsequence,
      'expected observable consequence',
    ),
  });
}

export function renderResidentPublicActionCommitment(value: unknown) {
  const commitment = residentPublicActionCommitment(value);
  return [
    `Intention: ${commitment.intention}`,
    `Expected observable consequence: ${commitment.expectedObservableConsequence}`,
  ].join('\n');
}

function exactPublicLine(value: unknown, label: string) {
  if (typeof value !== 'string' || value.length < 1) {
    throw new Error(`${label} must be nonempty text`);
  }
  if (
    value !== value.trim() ||
    value.includes('\n') ||
    value.includes('\r') ||
    value.length > RESIDENT_PUBLIC_ACTION_COMMITMENT_MAX_CHARS
  ) {
    throw new Error(
      `${label} must be one exact trimmed line of at most ${RESIDENT_PUBLIC_ACTION_COMMITMENT_MAX_CHARS} characters`,
    );
  }
  return value;
}

function exactRecord(value: unknown, fields: readonly string[], label: string) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const record = value as Record<string, any>;
  if (Object.keys(record).sort().join(',') !== [...fields].sort().join(',')) {
    throw new Error(`${label} fields do not match the versioned contract`);
  }
  return record;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return value;
}
