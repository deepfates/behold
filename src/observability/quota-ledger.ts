import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const QUOTA_LEDGER_EVENT_PROTOCOL = 'behold.quota-ledger-event.v1' as const;

export type QuotaLimits = Readonly<Record<string, number>>;

export type QuotaLedgerEvent = Readonly<{
  protocol: typeof QUOTA_LEDGER_EVENT_PROTOCOL;
  sequence: number;
  at: number;
  scopeId: string;
  worldId: string;
  accountId: string;
  layer: string;
  type: 'configured' | 'charged' | 'settled';
  purpose: string | null;
  chargeId: string | null;
  data: unknown;
  previousDigest: string | null;
  digest: string;
}>;

export type QuotaCharge = Readonly<{
  ok: true;
  purpose: string;
  chargeId: string;
  ordinal: number;
  limit: number;
  remaining: number;
  event: QuotaLedgerEvent;
}>;

export type QuotaRefusal = Readonly<{
  ok: false;
  purpose: string;
  chargeId: string;
  used: number;
  limit: number;
  remaining: 0;
}>;

export type QuotaLedgerSnapshot = Readonly<{
  protocol: 'behold.quota-ledger-snapshot.v1';
  file: string;
  scopeId: string;
  worldId: string;
  accountId: string;
  layer: string;
  limits: QuotaLimits;
  used: Readonly<Record<string, number>>;
  remaining: Readonly<Record<string, number>>;
  settled: number;
  unsettled: number;
  usage: Readonly<
    Record<
      string,
      Readonly<{
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
        costUsd: number;
        promptTokenReports: number;
        completionTokenReports: number;
        totalTokenReports: number;
        costReports: number;
        settlementsWithAnyUsage: number;
        settlementsWithoutUsage: number;
      }>
    >
  >;
  eventCount: number;
  tipDigest: string;
}>;

export type QuotaLedger = Readonly<{
  file: string;
  charge(purpose: string, chargeId: string, data?: unknown): QuotaCharge | QuotaRefusal;
  settle(chargeId: string, data?: unknown): QuotaLedgerEvent;
  snapshot(): QuotaLedgerSnapshot;
  close(): void;
}>;

export function openQuotaLedger(input: {
  file: string;
  scopeId: string;
  worldId: string;
  accountId: string;
  layer: string;
  limits: QuotaLimits;
  now?: () => number;
}): QuotaLedger {
  const file = path.resolve(input.file);
  const identity = {
    scopeId: boundedIdentity(input.scopeId, 'quota scope'),
    worldId: boundedIdentity(input.worldId, 'quota world'),
    accountId: digestIdentity(input.accountId, 'quota account'),
    layer: boundedIdentity(input.layer, 'quota layer'),
  };
  const limits = normalizeLimits(input.limits);
  const now = input.now ?? Date.now;
  ensurePrivateDirectory(path.dirname(file));
  const existed = fs.existsSync(file);
  let events: QuotaLedgerEvent[] = existed ? [...verifyQuotaLedger(file).events] : [];
  let descriptor: number | null = null;
  try {
    if (existed) {
      const configured = events[0];
      const expected = stableJson({ identity, limits });
      const actual = stableJson({
        identity: {
          scopeId: configured.scopeId,
          worldId: configured.worldId,
          accountId: configured.accountId,
          layer: configured.layer,
        },
        limits: (configured.data as any)?.limits,
      });
      if (actual !== expected) {
        throw new Error('quota ledger configuration differs from its durable scope');
      }
      descriptor = fs.openSync(
        file,
        fs.constants.O_APPEND | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW,
      );
    } else {
      descriptor = fs.openSync(
        file,
        fs.constants.O_CREAT |
          fs.constants.O_EXCL |
          fs.constants.O_APPEND |
          fs.constants.O_WRONLY |
          fs.constants.O_NOFOLLOW,
        0o600,
      );
      const configured = appendEvent('configured', null, null, { limits });
      events = [configured];
      fsyncDirectory(path.dirname(file));
    }
  } catch (error) {
    if (descriptor != null) fs.closeSync(descriptor);
    throw error;
  }

  const charges = new Map<string, QuotaLedgerEvent>();
  const settlements = new Map<string, QuotaLedgerEvent>();
  const used = new Map(Object.keys(limits).map((purpose) => [purpose, 0]));
  hydrate(events);

  function appendEvent(
    type: QuotaLedgerEvent['type'],
    purpose: string | null,
    chargeId: string | null,
    data: unknown,
  ) {
    if (descriptor == null) throw new Error('quota ledger is closed');
    const previous = events.at(-1) ?? null;
    const base = {
      protocol: QUOTA_LEDGER_EVENT_PROTOCOL,
      sequence: (previous?.sequence ?? 0) + 1,
      at: now(),
      ...identity,
      type,
      purpose,
      chargeId,
      data: cloneJson(data),
      previousDigest: previous?.digest ?? null,
    };
    const event: QuotaLedgerEvent = Object.freeze({
      ...base,
      digest: sha256(stableJson(base)),
    });
    fs.writeSync(descriptor, `${JSON.stringify(event)}\n`);
    fs.fsyncSync(descriptor);
    events.push(event);
    return event;
  }

  function hydrate(source: readonly QuotaLedgerEvent[]) {
    for (const event of source.slice(1)) {
      if (event.type === 'charged') {
        charges.set(event.chargeId!, event);
        used.set(event.purpose!, (used.get(event.purpose!) ?? 0) + 1);
      } else if (event.type === 'settled') {
        settlements.set(event.chargeId!, event);
      }
    }
  }

  function charge(purposeValue: string, chargeIdValue: string, data: unknown = {}) {
    const purpose = boundedIdentity(purposeValue, 'quota purpose');
    const chargeId = boundedIdentity(chargeIdValue, 'quota charge');
    const limit = limits[purpose];
    if (limit == null) throw new Error(`quota purpose is not configured: ${purpose}`);
    const existing = charges.get(chargeId);
    if (existing) {
      if (existing.purpose !== purpose || stableJson(existing.data) !== stableJson(data)) {
        throw new Error(`quota charge ${chargeId} was replayed with different evidence`);
      }
      const ordinal = chargeOrdinal(events, existing);
      return Object.freeze({
        ok: true as const,
        purpose,
        chargeId,
        ordinal,
        limit,
        remaining: Math.max(0, limit - ordinal),
        event: existing,
      });
    }
    const count = used.get(purpose) ?? 0;
    if (count >= limit) {
      return Object.freeze({
        ok: false as const,
        purpose,
        chargeId,
        used: count,
        limit,
        remaining: 0 as const,
      });
    }
    const event = appendEvent('charged', purpose, chargeId, data);
    charges.set(chargeId, event);
    used.set(purpose, count + 1);
    return Object.freeze({
      ok: true as const,
      purpose,
      chargeId,
      ordinal: count + 1,
      limit,
      remaining: limit - count - 1,
      event,
    });
  }

  function settle(chargeIdValue: string, data: unknown = {}) {
    const chargeId = boundedIdentity(chargeIdValue, 'quota charge');
    if (!charges.has(chargeId)) throw new Error(`quota settlement has no charge: ${chargeId}`);
    const existing = settlements.get(chargeId);
    if (existing) {
      if (stableJson(existing.data) !== stableJson(data)) {
        throw new Error(`quota charge ${chargeId} was settled with different evidence`);
      }
      return existing;
    }
    const charge = charges.get(chargeId)!;
    const event = appendEvent('settled', charge.purpose, chargeId, data);
    settlements.set(chargeId, event);
    return event;
  }

  function snapshot() {
    return quotaSnapshot(file, events, limits);
  }

  function close() {
    if (descriptor == null) return;
    try {
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
    } finally {
      descriptor = null;
    }
  }

  return Object.freeze({ file, charge, settle, snapshot, close });
}

export function verifyQuotaLedger(fileValue: string) {
  const file = path.resolve(fileValue);
  const stats = fs.lstatSync(file);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error(`quota ledger is not a plain file: ${file}`);
  }
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) throw new Error('quota ledger is empty');
  const events: QuotaLedgerEvent[] = [];
  for (const [index, line] of lines.entries()) {
    let event: any;
    try {
      event = JSON.parse(line);
    } catch {
      throw new Error(`quota ledger line ${index + 1} is malformed`);
    }
    const prior = events.at(-1) ?? null;
    const { digest, ...base } = event;
    const configuredEvent = index === 0;
    if (
      event.protocol !== QUOTA_LEDGER_EVENT_PROTOCOL ||
      event.sequence !== index + 1 ||
      event.previousDigest !== (prior?.digest ?? null) ||
      digest !== sha256(stableJson(base)) ||
      !Number.isFinite(event.at) ||
      event.at < 0 ||
      (event.type !== 'configured' && event.type !== 'charged' && event.type !== 'settled') ||
      configuredEvent !== (event.type === 'configured') ||
      !isBoundedIdentity(event.scopeId) ||
      !isBoundedIdentity(event.worldId) ||
      !isDigestIdentity(event.accountId) ||
      !isBoundedIdentity(event.layer) ||
      (configuredEvent && (event.purpose !== null || event.chargeId !== null)) ||
      (!configuredEvent &&
        (!isBoundedIdentity(event.purpose) || !isBoundedIdentity(event.chargeId))) ||
      (event.scopeId !== events[0]?.scopeId && index > 0) ||
      (event.worldId !== events[0]?.worldId && index > 0) ||
      (event.accountId !== events[0]?.accountId && index > 0) ||
      (event.layer !== events[0]?.layer && index > 0)
    ) {
      throw new Error(`invalid quota ledger chain at sequence ${index + 1}`);
    }
    events.push(Object.freeze(event));
  }
  const configured = events[0];
  const limits = normalizeLimits((configured.data as any)?.limits);
  const charges = new Map<string, QuotaLedgerEvent>();
  const settlements = new Set<string>();
  const used = new Map(Object.keys(limits).map((purpose) => [purpose, 0]));
  for (const event of events.slice(1)) {
    if (!Object.hasOwn(limits, String(event.purpose || '')) || !event.chargeId) {
      throw new Error(`invalid quota ledger event at sequence ${event.sequence}`);
    }
    if (event.type === 'charged') {
      if (charges.has(event.chargeId) || settlements.has(event.chargeId)) {
        throw new Error(`duplicate quota charge ${event.chargeId}`);
      }
      const purposeUsed = (used.get(event.purpose) ?? 0) + 1;
      if (purposeUsed > limits[event.purpose]) {
        throw new Error(`quota ledger exceeds ${event.purpose} limit`);
      }
      used.set(event.purpose, purposeUsed);
      charges.set(event.chargeId, event);
    } else if (event.type === 'settled') {
      if (!charges.has(event.chargeId) || settlements.has(event.chargeId)) {
        throw new Error(`invalid quota settlement ${event.chargeId}`);
      }
      settlements.add(event.chargeId);
    }
  }
  return Object.freeze({
    file,
    events: Object.freeze(events),
    snapshot: quotaSnapshot(file, events, limits),
  });
}

function quotaSnapshot(file: string, events: readonly QuotaLedgerEvent[], limits: QuotaLimits) {
  const configured = events[0];
  const used = Object.fromEntries(Object.keys(limits).map((purpose) => [purpose, 0]));
  const usage = Object.fromEntries(
    Object.keys(limits).map((purpose) => [
      purpose,
      {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        costUsd: 0,
        promptTokenReports: 0,
        completionTokenReports: 0,
        totalTokenReports: 0,
        costReports: 0,
        settlementsWithAnyUsage: 0,
        settlementsWithoutUsage: 0,
      },
    ]),
  );
  const charges = new Map<string, QuotaLedgerEvent>();
  let settled = 0;
  for (const event of events.slice(1)) {
    if (event.type === 'charged') {
      used[event.purpose!] += 1;
      charges.set(event.chargeId!, event);
      continue;
    }
    if (event.type !== 'settled') continue;
    settled += 1;
    const purpose = charges.get(event.chargeId!)!.purpose!;
    const providerUsage = normalizedUsage((event.data as any)?.usage);
    if (providerUsage) {
      for (const [valueField, totalField, reportsField] of [
        ['promptTokens', 'promptTokens', 'promptTokenReports'],
        ['completionTokens', 'completionTokens', 'completionTokenReports'],
        ['totalTokens', 'totalTokens', 'totalTokenReports'],
        ['costUsd', 'costUsd', 'costReports'],
      ] as const) {
        const value = providerUsage[valueField];
        if (value == null) continue;
        usage[purpose][totalField] += value;
        usage[purpose][reportsField] += 1;
      }
      usage[purpose].settlementsWithAnyUsage += 1;
    } else {
      usage[purpose].settlementsWithoutUsage += 1;
    }
  }
  return Object.freeze({
    protocol: 'behold.quota-ledger-snapshot.v1' as const,
    file,
    scopeId: configured.scopeId,
    worldId: configured.worldId,
    accountId: configured.accountId,
    layer: configured.layer,
    limits: Object.freeze({ ...limits }),
    used: Object.freeze({ ...used }),
    remaining: Object.freeze(
      Object.fromEntries(
        Object.entries(limits).map(([purpose, limit]) => [
          purpose,
          Math.max(0, limit - used[purpose]),
        ]),
      ),
    ),
    settled,
    unsettled: events.filter((event) => event.type === 'charged').length - settled,
    usage: Object.freeze(
      Object.fromEntries(
        Object.entries(usage).map(([purpose, totals]) => [purpose, Object.freeze(totals)]),
      ),
    ),
    eventCount: events.length,
    tipDigest: events.at(-1)!.digest,
  });
}

function normalizeLimits(value: unknown): QuotaLimits {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('quota limits must be an object');
  }
  const entries = Object.entries(value);
  if (entries.length === 0 || entries.length > 32) {
    throw new Error('quota limits must contain 1 through 32 purposes');
  }
  const limits: Record<string, number> = {};
  for (const [purpose, raw] of entries.sort(([left], [right]) => left.localeCompare(right))) {
    boundedIdentity(purpose, 'quota purpose');
    if (!Number.isSafeInteger(raw) || Number(raw) < 1 || Number(raw) > 100_000_000) {
      throw new Error(`quota limit for ${purpose} must be an integer from 1 through 100000000`);
    }
    limits[purpose] = Number(raw);
  }
  return Object.freeze(limits);
}

function normalizedUsage(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as any;
  const usage = {
    promptTokens: optionalNonnegativeNumber(input.prompt_tokens),
    completionTokens: optionalNonnegativeNumber(input.completion_tokens),
    totalTokens: optionalNonnegativeNumber(input.total_tokens),
    costUsd: optionalNonnegativeNumber(input.cost),
  };
  return Object.values(usage).some((part) => part != null) ? usage : null;
}

function optionalNonnegativeNumber(value: unknown) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function chargeOrdinal(events: readonly QuotaLedgerEvent[], target: QuotaLedgerEvent) {
  return events
    .slice(1, target.sequence)
    .filter((event) => event.type === 'charged' && event.purpose === target.purpose).length;
}

function boundedIdentity(value: unknown, label: string) {
  const text = String(value || '').trim();
  if (!isBoundedIdentity(text)) {
    throw new Error(`${label} must be a bounded identifier`);
  }
  return text;
}

function digestIdentity(value: unknown, label: string) {
  const text = String(value || '');
  if (!isDigestIdentity(text)) throw new Error(`${label} must be a SHA-256 digest`);
  return text;
}

function isBoundedIdentity(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value);
}

function isDigestIdentity(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function ensurePrivateDirectory(directory: string) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stats = fs.lstatSync(directory);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(`quota ledger parent is not a plain directory: ${directory}`);
  }
  fs.chmodSync(directory, 0o700);
}

function fsyncDirectory(directory: string) {
  const descriptor = fs.openSync(directory, 'r');
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function cloneJson(value: unknown) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.keys(value as Record<string, unknown>)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson((value as any)[key])}`)
    .join(',')}}`;
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}
