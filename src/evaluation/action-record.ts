import { createHash } from 'node:crypto';

export const ACTION_RECORD_PROTOCOL = 'behold.action-record.v1' as const;
export const ACTION_RECORD_BUNDLE_PROTOCOL = 'behold.action-record-bundle.v1' as const;
export const ACTION_RECORD_BINDING_PROTOCOL = 'behold.action-record-binding.v1' as const;
export const ACTION_RECORD_GRAPH_PROFILE = 'worlds.action-record-graph.v1' as const;
const STRUCTURAL_NOT_ASSESSED = [
  'world-semantics',
  'material-effect',
  'authority-freshness',
  'redelivery-idempotency',
  'restart-recovery',
  'competence',
] as const;

export const ACTION_RECORD_STAGES = [
  'observation',
  'proposal',
  'decision',
  'execution',
  'world_fact',
  'check',
] as const;

export type ActionRecordStage = (typeof ACTION_RECORD_STAGES)[number];

export type ActionRecordAccess = Readonly<{
  visibility: 'private' | 'shared' | 'public';
  audience: readonly string[];
  projection: string;
}>;

export type ActionRecordControl = Readonly<{
  controllerInstanceId: string;
  bodyId: string;
  leaseEpoch: string | number | null;
}>;

export type ActionRecordEnvelope = Readonly<{
  protocol: typeof ACTION_RECORD_PROTOCOL;
  /** Content address of every other field in this immutable envelope. */
  id: string;
  stage: ActionRecordStage;
  worldId: string;
  runId: string;
  at: string;
  author: Readonly<{ kind: string; id: string }>;
  responsible: Readonly<{ kind: string; id: string }> | null;
  via: Readonly<{ name: string; version: string | null }>;
  /** Production or derivation causes; other relations stay in the stage payload. */
  causes: readonly string[];
  localOrder: Readonly<{ domain: string; value: string | number }> | null;
  control: ActionRecordControl | null;
  access: ActionRecordAccess;
  /** World-owned JSON. The common envelope never interprets physics or game rules. */
  payload: any;
}>;

export type ActionRecordBundle = Readonly<{
  protocol: typeof ACTION_RECORD_BUNDLE_PROTOCOL;
  records: readonly ActionRecordEnvelope[];
  recordsSha256: string;
}>;

export type ActionRecordEvidenceRef = Readonly<{
  kind: string;
  ref: string;
  sha256: string;
  access: ActionRecordAccess;
}>;

type CheckInput = Readonly<{
  checker: Readonly<{ name: string; version: string; revision: string }>;
  at: string;
  access: ActionRecordAccess;
  evidence: readonly ActionRecordEvidenceRef[];
}>;

export function createActionRecordEnvelope(
  value: Omit<ActionRecordEnvelope, 'protocol' | 'id'>,
): ActionRecordEnvelope {
  const body = structuredClone(value);
  const record = {
    protocol: ACTION_RECORD_PROTOCOL,
    id: actionRecordId(body),
    ...body,
  } as ActionRecordEnvelope;
  const error = envelopeError(record);
  if (error) throw new Error(error);
  return deepFreeze(record);
}

/**
 * Add a structurally post-hoc check to records that already exist. This helper
 * checks only the common envelope graph. World meaning, physical effect,
 * authority freshness, and competence require separate world-aware verifiers.
 */
export function completeActionRecord(
  coreRecords: readonly ActionRecordEnvelope[],
  input: CheckInput,
): ActionRecordBundle {
  const core = assessActionRecordCore(coreRecords);
  const first = coreRecords[0];
  if (!first) throw new Error('action record requires core records');
  const check = createActionRecordEnvelope({
    stage: 'check',
    worldId: first.worldId,
    runId: first.runId,
    at: input.at,
    author: { kind: 'checker', id: input.checker.name },
    responsible: null,
    via: { name: input.checker.name, version: input.checker.version },
    causes: coreRecords.map((record) => record.id),
    localOrder: null,
    control: null,
    access: structuredClone(input.access),
    payload: {
      profile: ACTION_RECORD_GRAPH_PROFILE,
      checker: structuredClone(input.checker),
      inspectedRecords: coreRecords.map((record) => record.id),
      structuralVerdict: core.status,
      failedAssertions: core.failed,
      evidence: structuredClone(input.evidence),
      scope: {
        assessed: Object.keys(core.assertions),
        notAssessed: STRUCTURAL_NOT_ASSESSED,
      },
    },
  });
  return createBundle([...coreRecords, check]);
}

/** Verify only the shared immutable graph and its exact structural check. */
export function assessActionRecordBundle(value: ActionRecordBundle) {
  const records = Array.isArray(value?.records) ? value.records : [];
  const checks = records.filter((record) => record?.stage === 'check');
  const coreRecords = records.filter((record) => record?.stage !== 'check');
  const core = assessActionRecordCore(coreRecords);
  const check = checks[0] ?? null;
  const expectedDigest = sha256(stableJson(records));
  const expectedCheckKeys = [
    'checker',
    'evidence',
    'failedAssertions',
    'inspectedRecords',
    'profile',
    'scope',
    'structuralVerdict',
  ];
  const assertions = {
    bundleProtocol: value?.protocol === ACTION_RECORD_BUNDLE_PROTOCOL,
    bundleDigest: digest(value?.recordsSha256) && value.recordsSha256 === expectedDigest,
    oneStructuralCheck:
      checks.length === 1 && check === records.at(-1) && check?.author?.kind === 'checker',
    checkEnvelope: check != null && envelopeError(check) == null,
    checkContentAddressed: check != null && check.id === actionRecordId(recordBody(check)),
    checkPrincipalSeparated:
      check != null &&
      coreRecords.every(
        (record) => record.author.id !== check.author.id && record.via.name !== check.via.name,
      ),
    checkIsPostHoc:
      check != null &&
      stableJson(check.causes) === stableJson(coreRecords.map((record) => record.id)) &&
      stableJson(check.payload?.inspectedRecords) ===
        stableJson(coreRecords.map((record) => record.id)) &&
      coreRecords.every((record) => Date.parse(check.at) >= Date.parse(record.at)),
    exactCheckPayload:
      check != null &&
      stableJson(Object.keys(check.payload ?? {}).sort()) === stableJson(expectedCheckKeys) &&
      check.payload?.profile === ACTION_RECORD_GRAPH_PROFILE &&
      exactObject(check.payload?.checker, ['name', 'revision', 'version']) &&
      exactObject(check.payload?.scope, ['assessed', 'notAssessed']),
    checkMatchesGraph:
      check?.payload?.structuralVerdict === core.status &&
      stableJson(check?.payload?.failedAssertions) === stableJson(core.failed) &&
      stableJson(check?.payload?.scope?.assessed) === stableJson(Object.keys(core.assertions)) &&
      stableJson(check?.payload?.scope?.notAssessed) === stableJson(STRUCTURAL_NOT_ASSESSED),
    checkEvidenceAddressed:
      Array.isArray(check?.payload?.evidence) &&
      check.payload.evidence.length > 0 &&
      check.payload.evidence.every(evidenceRefValid),
    corePassed: core.status === 'passed',
  };
  const failed = failedAssertions(assertions);
  const status = failed.length === 0 ? ('passed' as const) : ('failed' as const);
  const binding =
    status === 'passed'
      ? deepFreeze({
          protocol: ACTION_RECORD_BINDING_PROTOCOL,
          profile: ACTION_RECORD_GRAPH_PROFILE,
          worldId: coreRecords[0].worldId,
          runId: coreRecords[0].runId,
          recordsSha256: value.recordsSha256,
          recordIds: coreRecords.map((record) => record.id),
          checkId: check!.id,
        })
      : null;
  return deepFreeze({ status, assertions, failed, core, binding });
}

export function actionRecordSha256(value: unknown) {
  return sha256(stableJson(value));
}

function assessActionRecordCore(records: readonly ActionRecordEnvelope[]) {
  const ids = records.map((record) => record?.id);
  const byId = new Map(records.map((record) => [record.id, record]));
  const positions = new Map(ids.map((id, index) => [id, index]));
  const first = records[0];
  const assertions = {
    envelopeShape: records.length > 0 && records.every((record) => envelopeError(record) == null),
    uniqueIds: ids.length === new Set(ids).size,
    contentAddressedIds: records.every(
      (record) => record.id === actionRecordId(recordBody(record)),
    ),
    oneWorldAndRun:
      first != null &&
      records.every((record) => record.worldId === first.worldId && record.runId === first.runId),
    causalReferences: records.every((record) => record.causes.every((cause) => byId.has(cause))),
    causalOrder: records.every((record, index) =>
      record.causes.every((cause) => {
        const causeRecord = byId.get(cause);
        const causeIndex = positions.get(cause);
        return (
          causeRecord != null &&
          causeIndex != null &&
          causeIndex < index &&
          Date.parse(causeRecord.at) <= Date.parse(record.at)
        );
      }),
    ),
    stageReferences: records.every((record) => stageReferencesValid(record, byId)),
    relationOrder: records.every((record) =>
      relationIds(record).every((id) => {
        const related = byId.get(id);
        return related != null && Date.parse(related.at) <= Date.parse(record.at);
      }),
    ),
    observationCursorBound: records
      .filter((record) => record.stage === 'observation' && record.localOrder != null)
      .every(
        (record) =>
          record.localOrder!.domain !== record.payload.asOf.domain ||
          record.localOrder!.value === record.payload.asOf.cursor,
      ),
    noEmbeddedCheck: records.every((record) => record.stage !== 'check'),
  };
  const failed = failedAssertions(assertions);
  return deepFreeze({
    status: failed.length === 0 ? ('passed' as const) : ('failed' as const),
    assertions,
    failed,
  });
}

function createBundle(records: readonly ActionRecordEnvelope[]): ActionRecordBundle {
  const cloned = structuredClone(records);
  return deepFreeze({
    protocol: ACTION_RECORD_BUNDLE_PROTOCOL,
    records: cloned,
    recordsSha256: sha256(stableJson(cloned)),
  });
}

function envelopeError(value: any) {
  const fields = [
    'access',
    'at',
    'author',
    'causes',
    'control',
    'id',
    'localOrder',
    'payload',
    'protocol',
    'responsible',
    'runId',
    'stage',
    'via',
    'worldId',
  ];
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return 'record must be an object';
  if (!exactObject(value, fields)) return 'record fields are invalid';
  if (value.protocol !== ACTION_RECORD_PROTOCOL) return 'record protocol is invalid';
  if (!/^ar_[a-f0-9]{64}$/.test(String(value.id))) return 'record id is invalid';
  if (!ACTION_RECORD_STAGES.includes(value.stage)) return 'record stage is invalid';
  if (!nonEmpty(value.worldId) || !nonEmpty(value.runId)) return 'world and run ids are required';
  if (!validDate(value.at)) return 'record time is invalid';
  if (!exactIdentity(value.author)) return 'author is invalid';
  if (value.responsible != null && !exactIdentity(value.responsible)) {
    return 'responsible identity is invalid';
  }
  if (
    !exactObject(value.via, ['name', 'version']) ||
    !nonEmpty(value.via?.name) ||
    !(value.via?.version == null || nonEmpty(value.via.version))
  ) {
    return 'via is invalid';
  }
  if (!Array.isArray(value.causes) || !value.causes.every(recordId)) return 'causes are invalid';
  if (value.localOrder != null && !localOrderValid(value.localOrder)) {
    return 'local order is invalid';
  }
  if (value.control != null && !controlValid(value.control)) return 'control reference is invalid';
  if (!accessValid(value.access)) return 'access policy is invalid';
  if (!jsonValue(value.payload)) return 'payload must be JSON';
  const stageIssue = stagePayloadError(value);
  return stageIssue;
}

function stagePayloadError(record: any) {
  const payload = record.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return `${record.stage} payload must be an object`;
  }
  if (record.stage === 'observation') {
    if (
      !nonEmpty(payload.bodyId) ||
      !Array.isArray(payload.sources) ||
      payload.sources.length === 0 ||
      !payload.sources.every(sourceValid) ||
      !Array.isArray(payload.limits) ||
      payload.limits.length === 0 ||
      !payload.limits.every(limitValid) ||
      !cursorRefValid(payload.asOf) ||
      !nonEmpty(payload.dataRef) ||
      !digest(payload.dataSha256)
    ) {
      return 'observation payload provenance is invalid';
    }
  }
  if (record.stage === 'proposal') {
    if (
      !nonEmpty(payload.bodyId) ||
      !recordId(payload.basisObservation) ||
      !nonEmpty(payload.action) ||
      !digest(payload.argumentsSha256) ||
      !Object.prototype.hasOwnProperty.call(payload, 'why') ||
      !(payload.why == null || nonEmpty(payload.why))
    ) {
      return 'proposal payload is invalid';
    }
  }
  if (record.stage === 'decision') {
    if (
      !recordId(payload.proposal) ||
      !['allowed', 'denied', 'transformed', 'deferred'].includes(String(payload.status)) ||
      !Array.isArray(payload.reasons) ||
      !payload.reasons.every(nonEmpty) ||
      !nonEmpty(payload.authority?.name) ||
      !nativeRefValid(payload.authority?.evidence)
    ) {
      return 'decision payload is invalid';
    }
  }
  if (record.stage === 'execution') {
    if (
      !recordId(payload.proposal) ||
      !recordId(payload.decision) ||
      !['started', 'failed', 'interrupted', 'completed'].includes(String(payload.status)) ||
      !Array.isArray(payload.nativeRefs) ||
      payload.nativeRefs.length === 0 ||
      !payload.nativeRefs.every(nativeRefValid)
    ) {
      return 'execution payload is invalid';
    }
  }
  if (record.stage === 'world_fact') {
    if (
      !recordId(payload.execution) ||
      !nonEmpty(payload.claim?.kind) ||
      !digest(payload.claim?.sha256) ||
      !nonEmpty(payload.claim?.verifier?.name) ||
      !nonEmpty(payload.claim?.verifier?.version) ||
      !Array.isArray(payload.confirmationSources) ||
      payload.confirmationSources.length === 0 ||
      !payload.confirmationSources.every(recordId) ||
      !Array.isArray(payload.nativeRefs) ||
      !payload.nativeRefs.every(nativeRefValid)
    ) {
      return 'world fact payload is invalid';
    }
  }
  return null;
}

function stageReferencesValid(
  record: ActionRecordEnvelope,
  byId: Map<string, ActionRecordEnvelope>,
) {
  const stage = (id: unknown, expected: ActionRecordStage) =>
    typeof id === 'string' && byId.get(id)?.stage === expected;
  const payload = record.payload;
  if (record.stage === 'proposal') return stage(payload.basisObservation, 'observation');
  if (record.stage === 'decision') return stage(payload.proposal, 'proposal');
  if (record.stage === 'execution') {
    return stage(payload.proposal, 'proposal') && stage(payload.decision, 'decision');
  }
  if (record.stage === 'observation' && payload.observedAfter != null) {
    return stage(payload.observedAfter, 'execution');
  }
  if (record.stage === 'world_fact') {
    return (
      stage(payload.execution, 'execution') &&
      payload.confirmationSources.every((id: string) => stage(id, 'observation'))
    );
  }
  return true;
}

function relationIds(record: ActionRecordEnvelope) {
  const payload = record.payload;
  if (record.stage === 'proposal') return [payload.basisObservation];
  if (record.stage === 'decision') return [payload.proposal];
  if (record.stage === 'execution') return [payload.proposal, payload.decision];
  if (record.stage === 'observation' && payload.observedAfter != null) {
    return [payload.observedAfter];
  }
  if (record.stage === 'world_fact') {
    return [payload.execution, ...payload.confirmationSources];
  }
  return [];
}

function nativeRefValid(value: any) {
  return (
    exactObject(value, ['cursor', 'digest', 'domain', 'runId', 'type', 'worldId']) &&
    nonEmpty(value.domain) &&
    cursorValueValid(value.cursor) &&
    nonEmpty(value.type) &&
    digest(value.digest) &&
    nonEmpty(value.worldId) &&
    nonEmpty(value.runId)
  );
}

function evidenceRefValid(value: any) {
  return (
    exactObject(value, ['access', 'kind', 'ref', 'sha256']) &&
    nonEmpty(value.kind) &&
    nonEmpty(value.ref) &&
    digest(value.sha256) &&
    accessValid(value.access)
  );
}

function sourceValid(value: any) {
  return (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    nonEmpty(value.name) &&
    nonEmpty(value.kind)
  );
}

function limitValid(value: any) {
  return (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    nonEmpty(value.code) &&
    nonEmpty(value.detail)
  );
}

function cursorRefValid(value: any) {
  return (
    exactObject(value, ['cursor', 'domain']) &&
    nonEmpty(value.domain) &&
    cursorValueValid(value.cursor)
  );
}

function accessValid(value: any) {
  return (
    exactObject(value, ['audience', 'projection', 'visibility']) &&
    ['private', 'shared', 'public'].includes(String(value?.visibility)) &&
    Array.isArray(value?.audience) &&
    value.audience.every(nonEmpty) &&
    nonEmpty(value?.projection)
  );
}

function controlValid(value: any) {
  return (
    exactObject(value, ['bodyId', 'controllerInstanceId', 'leaseEpoch']) &&
    nonEmpty(value.controllerInstanceId) &&
    nonEmpty(value.bodyId) &&
    (value.leaseEpoch == null || cursorValueValid(value.leaseEpoch))
  );
}

function localOrderValid(value: any) {
  return (
    exactObject(value, ['domain', 'value']) &&
    nonEmpty(value.domain) &&
    cursorValueValid(value.value)
  );
}

function cursorValueValid(value: unknown) {
  return (
    (typeof value === 'string' && value.trim().length > 0) ||
    (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)
  );
}

function exactIdentity(value: any) {
  return exactObject(value, ['id', 'kind']) && nonEmpty(value.id) && nonEmpty(value.kind);
}

function exactObject(value: any, fields: readonly string[]) {
  return (
    value != null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    stableJson(Object.keys(value).sort()) === stableJson([...fields].sort())
  );
}

function recordBody(record: ActionRecordEnvelope) {
  const { protocol: _protocol, id: _id, ...body } = record;
  return body;
}

function actionRecordId(body: unknown) {
  return `ar_${sha256(stableJson(body))}`;
}

function recordId(value: unknown): value is string {
  return typeof value === 'string' && /^ar_[a-f0-9]{64}$/.test(value);
}

function jsonValue(value: unknown): boolean {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return true;
  }
  if (Array.isArray(value)) return value.every(jsonValue);
  if (value && typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    return (
      (prototype === Object.prototype || prototype === null) &&
      Object.values(value as Record<string, unknown>).every(jsonValue)
    );
  }
  return false;
}

function validDate(value: unknown) {
  return typeof value === 'string' && value.trim() && Number.isFinite(Date.parse(value));
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function digest(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function failedAssertions(assertions: Readonly<Record<string, unknown>>) {
  return Object.entries(assertions)
    .filter(([, value]) => !value)
    .map(([name]) => name);
}

function stableJson(value: any): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item);
  }
  return value;
}
