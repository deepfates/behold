import { createHash } from 'node:crypto';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import type {
  ManagedExternalServerAuthority,
  ManagedServerAuthorityExit,
  ManagedServerAuthorityStop,
} from './minecraft-server-authority';

export const PLACE_SERVE_CONTROL_PROTOCOL = 'place-compiler-serve-control/v1' as const;
export const PLACE_SERVE_TRANSCRIPT_PROTOCOL = 'behold.place-serve-transcript.v1' as const;

const IDENTITY_DIGEST_FIELDS = [
  'sourceReleaseManifestSha256',
  'sourceWorldTreeSha256',
  'minecraftServerSha256',
  'runtimeManifestSha256',
] as const;

type PlaceServeCommand = 'status' | 'freeze' | 'save' | 'unfreeze' | 'stop';

export type PlaceServeIdentity = Readonly<{
  placeId: string;
  placeName: string;
  sourceRunId: string;
  sourceReleaseManifestSha256: string;
  sourceWorldTreeSha256: string;
  minecraftServerSha256: string;
  runtimeManifestSha256: string;
  minecraftVersion: string;
  profileId: string;
  releasePath: string;
  runtimePath: string;
  endpoint: Readonly<{ host: '127.0.0.1' | '::1'; port: number }>;
  processes: Readonly<{ controlPid: number; javaPid: number }>;
}>;

export type FrozenPlaceServeAuthority = ManagedExternalServerAuthority &
  Readonly<{
    placeIdentity: PlaceServeIdentity;
    /**
     * Stable compiler identity. Historical checkout authorities use the exact
     * Git revision; installed authorities use npm:NAME@VERSION#DISTRIBUTION.
     */
    placeCompilerRevision: string;
    minecraftServerJar: string;
    transcriptFile: string;
  }>;

export type StartFrozenPlaceServeInput = Readonly<{
  placeCompilerRoot?: string;
  placeCompilerBinary?: string;
  releaseRoot: string;
  runtimeRoot: string;
  profileId: string;
  transcriptFile: string;
  acceptEula: true;
  serverJar?: string;
  port?: number;
  maxPlayers?: number;
  expectedPlaceCompilerRevision?: string;
  expectedPlaceCompilerPackage?: Readonly<{
    name: string;
    version: string;
    distributionSha256: string;
  }>;
  startupTimeoutMs?: number;
}>;

export type PlaceServeDependencies = Readonly<{
  spawn?: typeof spawn;
  inspectPlaceCheckout?: (root: string) => Readonly<{ revision: string; clean: boolean }>;
  verifyRelease?: (
    input: Readonly<{
      kind: 'checkout' | 'installed';
      entrypoint: string;
      releaseRoot: string;
    }>,
  ) => unknown;
  stderr?: (text: string) => void;
  now?: () => Date;
}>;

export type FrozenPlaceServePreflight = Readonly<{
  placeCompilerRevision: string;
  releaseRoot: string;
  serverJar: string;
  sourceReleaseManifestSha256: string;
  sourceWorldTreeSha256: string;
  minecraftServerSha256: string;
  entryQualification: Readonly<{
    protocol: 'place-compiler-entry-qualification/v1' | 'place-compiler-entry-qualification/v2';
    status: 'qualified';
    scope: 'living-entry';
  }>;
}>;

export class PlaceServeError extends Error {
  readonly code: string;
  readonly evidence: unknown;

  constructor(message: string, code: string, evidence: unknown = null) {
    super(message);
    this.name = 'PlaceServeError';
    this.code = code;
    this.evidence = evidence;
  }
}

/** Read-only admission used before an operator episode receives durable state. */
export function preflightFrozenPlaceServeAuthority(
  input: Omit<StartFrozenPlaceServeInput, 'transcriptFile'>,
  dependencies: PlaceServeDependencies = {},
): FrozenPlaceServePreflight {
  return inspectFrozenPlaceServeInput(input, dependencies).evidence;
}

/**
 * Starts Place Compiler's ordinary served-release lifecycle, waits for its
 * exact ready identity, and immediately obtains an acknowledged frozen world.
 * Place remains the Java owner; Behold receives only the narrow authority it
 * needs for its all-ready population barrier and clean shutdown.
 */
export async function startFrozenPlaceServeAuthority(
  input: StartFrozenPlaceServeInput,
  dependencies: PlaceServeDependencies = {},
): Promise<FrozenPlaceServeAuthority> {
  const inspected = inspectFrozenPlaceServeInput(input, dependencies);
  const {
    compiler,
    releaseRoot,
    serverJar,
    declaredWorldTreeSha256,
    releaseManifestSha256,
    serverJarSha256,
  } = inspected;
  const compilerIdentity = inspected.evidence.placeCompilerRevision;
  const runtimeRoot = path.resolve(input.runtimeRoot);
  const profileId = requiredText(input.profileId, 'Place runtime profile');
  const transcript = createTranscript(input.transcriptFile, dependencies.now);
  const serveArgv = [
    'serve',
    releaseRoot,
    '--accept-eula',
    '--profile',
    profileId,
    '--control-jsonl',
    '--runtime',
    runtimeRoot,
    '--server-jar',
    serverJar,
    ...(input.port == null ? [] : ['--port', String(input.port)]),
    ...(input.maxPlayers == null ? [] : ['--max-players', String(input.maxPlayers)]),
  ];
  const command = compiler.kind === 'checkout' ? process.execPath : compiler.binary;
  const argv =
    compiler.kind === 'checkout'
      ? [path.join(compiler.root, 'scripts', 'place-compiler', 'place.mjs'), ...serveArgv]
      : serveArgv;
  const spawnProcess = dependencies.spawn ?? spawn;
  const child = spawnProcess(command, argv, {
    cwd: compiler.kind === 'checkout' ? compiler.root : path.dirname(runtimeRoot),
    stdio: ['pipe', 'pipe', 'pipe'],
    // Keep terminal SIGINT on Behold so it can drain residents before asking
    // Place to save/stop. If Behold dies, its owned stdin still closes and
    // Place's EOF policy performs the fail-closed server shutdown.
    detached: process.platform !== 'win32',
  }) as ChildProcessWithoutNullStreams;
  if (!child.pid) {
    transcript.close();
    throw new PlaceServeError('Place serve process has no PID', 'place_serve_pid_missing');
  }
  const stderr = dependencies.stderr ?? ((text: string) => process.stderr.write(text));
  child.stderr.on('data', (chunk) => stderr(String(chunk)));

  const control = createPlaceServeControl({
    child,
    transcript,
    releaseRoot,
    runtimeRoot,
    profileId,
    placeCompilerRevision: compilerIdentity,
    expected: {
      sourceReleaseManifestSha256: releaseManifestSha256,
      sourceWorldTreeSha256: declaredWorldTreeSha256,
      minecraftServerSha256: serverJarSha256,
    },
    timeoutMs: Math.max(1_000, input.startupTimeoutMs ?? 120_000),
  });
  try {
    const identity = await control.ready;
    const freeze = await control.command('freeze');
    if (freeze.state?.ticks !== 'frozen' || typeof freeze.acknowledgement !== 'string') {
      throw new PlaceServeError(
        'Place freeze did not carry an acknowledged frozen Minecraft state',
        'place_serve_freeze_unproven',
        freeze,
      );
    }
    const durableIdentity = Object.freeze({
      protocol: PLACE_SERVE_CONTROL_PROTOCOL,
      placeCompilerRevision: compilerIdentity,
      ...identity,
    });
    const runtimeWorldPath = resolvePlaceRuntimeWorld(identity);
    let stopPromise: Promise<ManagedServerAuthorityStop> | null = null;
    const authority: FrozenPlaceServeAuthority = Object.freeze({
      protocol: 'behold.external-minecraft-server-authority.v1' as const,
      kind: 'place-release-serve' as const,
      authorityPid: identity.processes.controlPid,
      serverPid: identity.processes.javaPid,
      runtimeWorldPath,
      host: identity.endpoint.host,
      port: identity.endpoint.port,
      minecraftServerSha256: identity.minecraftServerSha256,
      initialTickState: 'frozen' as const,
      initialTickEvidence: freeze,
      identity: durableIdentity,
      placeIdentity: identity,
      placeCompilerRevision: compilerIdentity,
      minecraftServerJar: serverJar,
      transcriptFile: transcript.file,
      exit: control.exit,
      async status() {
        const terminal = await control.command('status');
        if (terminal.state?.lifecycle !== 'ready') {
          throw new PlaceServeError(
            'Place status did not report the admitted ready lifecycle',
            'place_serve_status_unproven',
            terminal,
          );
        }
        return terminal;
      },
      async freeze() {
        const terminal = await control.command('freeze');
        assertCommandState(terminal, 'freeze', 'frozen');
        return terminal;
      },
      async save(_reason: string) {
        const terminal = await control.command('save');
        if (typeof terminal.acknowledgement !== 'string') {
          throw new PlaceServeError(
            'Place save terminal has no Minecraft acknowledgement',
            'place_serve_save_unproven',
            terminal,
          );
        }
        return terminal;
      },
      async unfreeze() {
        const terminal = await control.command('unfreeze');
        assertCommandState(terminal, 'unfreeze', 'running');
        return terminal;
      },
      async stop(_reason: string) {
        if (!stopPromise) {
          stopPromise = (async () => {
            const terminal = await control.command('stop');
            if (
              terminal.state?.lifecycle !== 'stopped' ||
              typeof terminal.acknowledgement !== 'string'
            ) {
              throw new PlaceServeError(
                'Place stop terminal has no clean Minecraft acknowledgement',
                'place_serve_stop_unproven',
                terminal,
              );
            }
            const stopped = await control.stopped;
            const exit = await control.exit;
            if (
              stopped.java?.pid !== identity.processes.javaPid ||
              stopped.java?.cleanExit !== true ||
              stopped.java?.exitCode !== 0 ||
              exit.code !== 0
            ) {
              throw new PlaceServeError(
                'Place or Java did not exit cleanly',
                'place_serve_exit_unclean',
                { stopped, exit },
              );
            }
            return Object.freeze({
              protocol: 'behold.external-minecraft-server-stop.v1' as const,
              saveAcknowledgement: terminal.acknowledgement,
              commandTerminal: terminal,
              stopped,
              exit,
            });
          })();
        }
        return stopPromise;
      },
    });
    return authority;
  } catch (error) {
    child.stdin.end();
    try {
      await withTimeout(
        control.exit,
        Math.max(1_000, input.startupTimeoutMs ?? 120_000),
        'Place fail-closed exit',
      );
    } catch {}
    transcript.close();
    throw error;
  }
}

function inspectFrozenPlaceServeInput(
  input: Omit<StartFrozenPlaceServeInput, 'transcriptFile'>,
  dependencies: PlaceServeDependencies,
) {
  if (input.acceptEula !== true) {
    throw new PlaceServeError(
      'Place served-release entry requires explicit EULA acceptance',
      'place_serve_eula_required',
    );
  }
  const compiler = resolvePlaceCompilerInvocation(input);
  const releaseRoot = plainDirectory(input.releaseRoot, 'Place release');
  let compilerIdentity: string;
  if (compiler.kind === 'checkout') {
    const checkout = (dependencies.inspectPlaceCheckout ?? inspectPlaceCheckout)(compiler.root);
    if (!checkout.clean) {
      throw new PlaceServeError(
        'Place served-release control files differ from their recorded revision',
        'place_serve_checkout_dirty',
        checkout,
      );
    }
    if (checkout.revision !== compiler.expectedRevision) {
      throw new PlaceServeError(
        'Place Compiler revision differs from the admitted session',
        'place_serve_revision_mismatch',
        { expected: compiler.expectedRevision, actual: checkout.revision },
      );
    }
    compilerIdentity = checkout.revision;
  } else {
    const installed = inspectInstalledPlaceCompiler(compiler.binary, compiler.expectedPackage);
    compilerIdentity = `npm:${installed.name}@${installed.version}#${installed.distributionSha256}`;
  }
  const serverJar = resolvePlaceServerJar(
    compiler.kind === 'checkout' ? compiler.root : null,
    input.serverJar,
  );
  const releaseManifestSha256 = sha256File(path.join(releaseRoot, 'release-manifest.json'));
  const releaseManifest = readJson(path.join(releaseRoot, 'release-manifest.json'));
  const declaredWorldTreeSha256 = sha256Value(releaseManifest?.source?.worldTreeSha256);
  if (!declaredWorldTreeSha256) {
    throw new PlaceServeError(
      'Place release manifest has no source world identity',
      'place_serve_release_identity_missing',
    );
  }
  const verification = (dependencies.verifyRelease ?? verifyPlaceRelease)({
    kind: compiler.kind,
    entrypoint:
      compiler.kind === 'checkout'
        ? path.join(compiler.root, 'scripts', 'place-compiler', 'place.mjs')
        : compiler.binary,
    releaseRoot,
  }) as any;
  if (
    verification?.status !== 'verified' ||
    verification?.releaseEligible !== true ||
    verification?.schemaVersion !== 3 ||
    verification?.sourceWorldTreeSha256 !== declaredWorldTreeSha256
  ) {
    throw new PlaceServeError(
      'Place release did not pass exact current verification',
      'place_serve_release_verification_failed',
      verification,
    );
  }
  const entryQualification = verification.entryQualification;
  const supportedEntryQualificationProtocols = new Set([
    'place-compiler-entry-qualification/v1',
    'place-compiler-entry-qualification/v2',
  ]);
  if (
    !supportedEntryQualificationProtocols.has(entryQualification?.protocol) ||
    entryQualification?.status !== 'qualified' ||
    entryQualification?.scope !== 'living-entry'
  ) {
    throw new PlaceServeError(
      'Place release is not qualified for living entry',
      'place_serve_release_unqualified',
      entryQualification ?? null,
    );
  }
  const serverJarSha256 = sha256File(serverJar);
  const evidence = Object.freeze({
    placeCompilerRevision: compilerIdentity,
    releaseRoot,
    serverJar,
    sourceReleaseManifestSha256: releaseManifestSha256,
    sourceWorldTreeSha256: declaredWorldTreeSha256,
    minecraftServerSha256: serverJarSha256,
    entryQualification: Object.freeze({
      protocol: entryQualification.protocol,
      status: entryQualification.status,
      scope: entryQualification.scope,
    }),
  });
  return Object.freeze({
    compiler,
    releaseRoot,
    serverJar,
    releaseManifestSha256,
    declaredWorldTreeSha256,
    serverJarSha256,
    evidence,
  });
}

function verifyPlaceRelease(
  input: Readonly<{
    kind: 'checkout' | 'installed';
    entrypoint: string;
    releaseRoot: string;
  }>,
) {
  const command = input.kind === 'checkout' ? process.execPath : input.entrypoint;
  const args =
    input.kind === 'checkout'
      ? [input.entrypoint, 'verify', input.releaseRoot, '--json']
      : ['verify', input.releaseRoot, '--json'];
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 120_000 });
  if (result.status !== 0) {
    throw new PlaceServeError(
      'Place release verification command failed',
      'place_serve_release_verification_failed',
      { status: result.status, stderr: result.stderr },
    );
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new PlaceServeError(
      'Place release verification was not JSON',
      'place_serve_release_verification_invalid',
    );
  }
}

function createPlaceServeControl(input: {
  child: ChildProcessWithoutNullStreams;
  transcript: ReturnType<typeof createTranscript>;
  releaseRoot: string;
  runtimeRoot: string;
  profileId: string;
  placeCompilerRevision: string;
  expected: Readonly<{
    sourceReleaseManifestSha256: string;
    sourceWorldTreeSha256: string;
    minecraftServerSha256: string;
  }>;
  timeoutMs: number;
}) {
  let prepared: any = null;
  let readyIdentity: PlaceServeIdentity | null = null;
  let ordinal = 0;
  let commandTail = Promise.resolve<unknown>(null);
  let terminalFailure: Error | null = null;
  let stoppedRecord: any = null;
  const pending = new Map<
    string,
    { command: PlaceServeCommand; resolve(value: any): void; reject(error: Error): void }
  >();
  let resolveReady!: (identity: PlaceServeIdentity) => void;
  let rejectReady!: (error: Error) => void;
  const ready = withTimeout(
    new Promise<PlaceServeIdentity>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    }),
    input.timeoutMs,
    'Place served-release readiness',
  );
  let resolveStopped!: (event: any) => void;
  let rejectStopped!: (error: Error) => void;
  const stopped = new Promise<any>((resolve, reject) => {
    resolveStopped = resolve;
    rejectStopped = reject;
  });
  // Startup can fail before an authority is returned to a caller that could
  // observe this promise. Keep the rejection available while preventing an
  // unhandled-rejection substitute for the actual readiness error.
  void stopped.catch(() => {});
  const exit = new Promise<ManagedServerAuthorityExit>((resolve, reject) => {
    input.child.once('error', (error) => reject(error));
    input.child.once('close', (code, signal) => {
      input.transcript.close();
      resolve({ name: 'place-release-serve', code, signal });
    });
  });
  const fail = (error: Error) => {
    if (terminalFailure) return;
    terminalFailure = error;
    rejectReady(error);
    rejectStopped(error);
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
  };
  const lines = createInterface({
    input: input.child.stdout,
    crlfDelay: Infinity,
    terminal: false,
  });
  lines.on('line', (line) => {
    input.transcript.append('received', line);
    let event: any;
    try {
      event = JSON.parse(line);
      if (event?.protocol !== PLACE_SERVE_CONTROL_PROTOCOL || typeof event.event !== 'string') {
        throw new Error('wrong or missing protocol/event');
      }
      if (event.event === 'prepared') {
        if (prepared || readyIdentity) throw new Error('duplicate or late prepared event');
        prepared = parsePlaceIdentity(event.identity, false, input);
        if (event.state?.lifecycle !== 'prepared' || event.state?.ticks !== 'unknown') {
          throw new Error('prepared event has the wrong lifecycle state');
        }
        return;
      }
      if (event.event === 'ready') {
        if (!prepared || readyIdentity) throw new Error('ready event is out of order');
        const identity = parsePlaceIdentity(event.identity, true, input);
        if (stableJson(withoutProcesses(prepared)) !== stableJson(withoutProcesses(identity))) {
          throw new Error('prepared and ready identities differ');
        }
        if (event.state?.lifecycle !== 'ready' || event.state?.ticks !== 'running') {
          throw new Error('ready event has the wrong lifecycle state');
        }
        readyIdentity = identity;
        resolveReady(identity);
        return;
      }
      if (event.event === 'command_terminal') {
        const requestId = typeof event.requestId === 'string' ? event.requestId : '';
        const waiter = pending.get(requestId);
        if (!waiter) throw new Error('command terminal has no matching request');
        pending.delete(requestId);
        if (event.command !== waiter.command)
          throw new Error('command terminal names another command');
        if (!readyIdentity || !samePlaceIdentity(event.identity, readyIdentity)) {
          throw new Error('command terminal identity drifted');
        }
        if (event.ok !== true) {
          waiter.reject(
            new PlaceServeError(
              `Place rejected ${waiter.command}: ${String(event.error || 'unknown error')}`,
              'place_serve_command_rejected',
              event,
            ),
          );
        } else waiter.resolve(event);
        return;
      }
      if (event.event === 'stopped') {
        if (!readyIdentity || !samePlaceIdentity(event.identity, readyIdentity)) {
          throw new Error('stopped identity drifted');
        }
        if (
          stoppedRecord ||
          event.state?.lifecycle !== 'stopped' ||
          !event.java ||
          event.java.pid !== readyIdentity.processes.javaPid ||
          typeof event.java.cleanExit !== 'boolean' ||
          !Number.isInteger(event.java.exitCode)
        ) {
          throw new Error('stopped event has invalid lifecycle or Java evidence');
        }
        stoppedRecord = event;
        resolveStopped(event);
        return;
      }
      if (event.event === 'failed') {
        throw new PlaceServeError(
          `Place served-release lifecycle failed: ${String(event.error || 'unknown error')}`,
          'place_serve_failed',
          event,
        );
      }
      throw new Error(`unsupported Place serve event ${event.event}`);
    } catch (error: any) {
      fail(
        error instanceof PlaceServeError
          ? error
          : new PlaceServeError(
              `Invalid Place serve record: ${error?.message || String(error)}`,
              'place_serve_protocol_invalid',
              { line },
            ),
      );
      input.child.stdin.end();
    }
  });
  void exit.then((result) => {
    if (!terminalFailure && (result.code !== 0 || !stoppedRecord)) {
      fail(
        new PlaceServeError(
          !stoppedRecord
            ? 'Place serve process closed without a final stopped record'
            : `Place serve process exited ${String(result.code ?? result.signal)}`,
          'place_serve_process_exited',
          result,
        ),
      );
    }
  });

  const command = (name: PlaceServeCommand) => {
    const operation = commandTail.then(async () => {
      if (terminalFailure) throw terminalFailure;
      const identity = readyIdentity ?? (await ready);
      const requestId = `behold:${++ordinal}:${name}`;
      const request = {
        protocol: PLACE_SERVE_CONTROL_PROTOCOL,
        requestId,
        command: name,
        ...(name === 'status' ? {} : { expect: expectedIdentity(identity) }),
      };
      const terminal = new Promise<any>((resolve, reject) => {
        pending.set(requestId, { command: name, resolve, reject });
      });
      const line = JSON.stringify(request);
      input.transcript.append('sent', line);
      input.child.stdin.write(`${line}\n`);
      return withTimeout(terminal, input.timeoutMs, `Place ${name} acknowledgement`);
    });
    commandTail = operation.catch(() => null);
    return operation;
  };
  return Object.freeze({ ready, stopped, exit, command });
}

function parsePlaceIdentity(value: any, requireJava: boolean, input: any): PlaceServeIdentity {
  for (const [label, candidate] of [
    ['placeId', value?.placeId],
    ['placeName', value?.placeName],
    ['sourceRunId', value?.sourceRunId],
    ['minecraftVersion', value?.minecraftVersion],
    ['profileId', value?.profileId],
  ])
    requiredText(candidate, `Place identity ${label}`);
  for (const field of IDENTITY_DIGEST_FIELDS) {
    if (!sha256Value(value?.[field])) throw new Error(`Place identity ${field} is invalid`);
  }
  if (
    value.sourceReleaseManifestSha256 !== input.expected.sourceReleaseManifestSha256 ||
    value.sourceWorldTreeSha256 !== input.expected.sourceWorldTreeSha256 ||
    value.minecraftServerSha256 !== input.expected.minecraftServerSha256
  )
    throw new Error('Place ready identity differs from release or server bytes');
  if (
    path.resolve(value.releasePath) !== input.releaseRoot ||
    path.resolve(value.runtimePath) !== input.runtimeRoot ||
    value.profileId !== input.profileId
  )
    throw new Error('Place ready identity differs from the requested release/runtime/profile');
  if (
    !value.endpoint ||
    !['127.0.0.1', '::1'].includes(value.endpoint.host) ||
    !Number.isSafeInteger(value.endpoint.port) ||
    value.endpoint.port < 1 ||
    value.endpoint.port > 65535
  )
    throw new Error('Place ready endpoint is not exact loopback');
  if (
    !value.processes ||
    value.processes.controlPid !== input.child.pid ||
    (requireJava
      ? !Number.isSafeInteger(value.processes.javaPid) || value.processes.javaPid < 1
      : value.processes.javaPid !== null)
  )
    throw new Error('Place ready process identity is invalid');
  if (requireJava) {
    const runtimeManifestSha256 = sha256File(path.join(input.runtimeRoot, 'runtime-manifest.json'));
    if (runtimeManifestSha256 !== value.runtimeManifestSha256) {
      throw new Error('Place runtime manifest changed before Behold adoption');
    }
  }
  return deepFreeze(JSON.parse(JSON.stringify(value))) as PlaceServeIdentity;
}

function resolvePlaceRuntimeWorld(identity: PlaceServeIdentity) {
  const file = path.join(identity.runtimePath, 'runtime-manifest.json');
  if (sha256File(file) !== identity.runtimeManifestSha256) {
    throw new PlaceServeError(
      'Place runtime manifest changed before world adoption',
      'place_serve_runtime_manifest_drift',
    );
  }
  const manifest = readJson(file);
  if (
    manifest?.schemaVersion !== 2 ||
    manifest?.kind !== 'place-release-preview' ||
    manifest?.placeId !== identity.placeId ||
    manifest?.sourceRunId !== identity.sourceRunId ||
    manifest?.sourceReleaseManifestSha256 !== identity.sourceReleaseManifestSha256 ||
    manifest?.sourceWorldTreeSha256 !== identity.sourceWorldTreeSha256 ||
    manifest?.minecraftServerSha256 !== identity.minecraftServerSha256 ||
    manifest?.minecraftVersion !== identity.minecraftVersion ||
    manifest?.profileId !== identity.profileId ||
    manifest?.port !== identity.endpoint.port ||
    typeof manifest?.world !== 'string' ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(manifest.world)
  ) {
    throw new PlaceServeError(
      'Place runtime manifest does not bind the served release identity',
      'place_serve_runtime_manifest_invalid',
      manifest,
    );
  }
  return plainDirectory(path.join(identity.runtimePath, manifest.world), 'Place runtime world');
}

function expectedIdentity(identity: PlaceServeIdentity) {
  return Object.fromEntries(IDENTITY_DIGEST_FIELDS.map((field) => [field, identity[field]]));
}

function samePlaceIdentity(left: any, right: PlaceServeIdentity) {
  try {
    return stableJson(left) === stableJson(right);
  } catch {
    return false;
  }
}

function withoutProcesses(identity: any) {
  const { processes: _processes, ...rest } = identity;
  return rest;
}

function assertCommandState(terminal: any, command: string, ticks: string) {
  if (terminal.state?.ticks !== ticks || typeof terminal.acknowledgement !== 'string') {
    throw new PlaceServeError(
      `Place ${command} did not carry an acknowledged ${ticks} Minecraft state`,
      `place_serve_${command}_unproven`,
      terminal,
    );
  }
}

function inspectPlaceCheckout(root: string) {
  const revision = spawnSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  if (revision.status !== 0 || !/^[a-f0-9]{40}$/.test(revision.stdout.trim())) {
    throw new PlaceServeError(
      'Place Compiler checkout revision is unavailable',
      'place_serve_revision_unavailable',
    );
  }
  const diff = spawnSync('git', ['-C', root, 'diff', '--quiet', 'HEAD', '--', '.']);
  return Object.freeze({ revision: revision.stdout.trim(), clean: diff.status === 0 });
}

function resolvePlaceCompilerInvocation(input: Omit<StartFrozenPlaceServeInput, 'transcriptFile'>) {
  const hasCheckout = typeof input.placeCompilerRoot === 'string';
  const hasInstalled = typeof input.placeCompilerBinary === 'string';
  if (hasCheckout === hasInstalled) {
    throw new PlaceServeError(
      'Select exactly one Place Compiler checkout or installed binary',
      'place_serve_compiler_source_required',
    );
  }
  if (hasCheckout) {
    const root = plainDirectory(input.placeCompilerRoot!, 'Place Compiler root');
    plainFile(
      path.join(root, 'scripts', 'place-compiler', 'place.mjs'),
      'Place Compiler entrypoint',
    );
    return Object.freeze({
      kind: 'checkout' as const,
      root,
      expectedRevision: requiredRevision(input.expectedPlaceCompilerRevision),
    });
  }
  if (input.expectedPlaceCompilerRevision != null) {
    throw new PlaceServeError(
      'Installed Place Compiler selection cannot also pin a Git revision',
      'place_serve_compiler_pin_conflict',
    );
  }
  const expected = input.expectedPlaceCompilerPackage;
  if (!expected) {
    throw new PlaceServeError(
      'Installed Place Compiler selection requires an exact package pin',
      'place_serve_package_pin_required',
    );
  }
  return Object.freeze({
    kind: 'installed' as const,
    binary: executableFile(input.placeCompilerBinary!, 'Place Compiler binary'),
    expectedPackage: Object.freeze({
      name: requiredText(expected.name, 'Place Compiler package name'),
      version: requiredText(expected.version, 'Place Compiler package version'),
      distributionSha256:
        sha256Value(expected.distributionSha256) ??
        (() => {
          throw new PlaceServeError(
            'Place Compiler distribution digest must be an exact SHA-256',
            'place_serve_package_digest_required',
          );
        })(),
    }),
  });
}

function inspectInstalledPlaceCompiler(
  binary: string,
  expected: Readonly<{ name: string; version: string; distributionSha256: string }>,
) {
  const result = spawnSync(binary, ['version', '--json'], {
    encoding: 'utf8',
    timeout: 30_000,
  });
  if (result.status !== 0) {
    throw new PlaceServeError(
      'Installed Place Compiler version preflight failed',
      'place_serve_package_preflight_failed',
      { status: result.status, stderr: result.stderr },
    );
  }
  let version: any;
  try {
    version = JSON.parse(result.stdout);
  } catch {
    throw new PlaceServeError(
      'Installed Place Compiler version preflight was not JSON',
      'place_serve_package_preflight_invalid',
    );
  }
  if (
    version?.name !== expected.name ||
    version?.version !== expected.version ||
    version?.distributionSha256 !== expected.distributionSha256 ||
    version?.serveControlProtocol !== PLACE_SERVE_CONTROL_PROTOCOL ||
    version?.releaseSchemaVersion !== 3
  ) {
    throw new PlaceServeError(
      'Installed Place Compiler differs from the exact package/control pin',
      'place_serve_package_identity_mismatch',
      { expected, actual: version },
    );
  }
  return Object.freeze({
    name: version.name as string,
    version: version.version as string,
    distributionSha256: version.distributionSha256 as string,
  });
}

function requiredRevision(value: unknown) {
  const revision = String(value || '').toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(revision)) {
    throw new PlaceServeError(
      'Place Compiler expected revision must be an exact commit',
      'place_serve_revision_required',
    );
  }
  return revision;
}

function resolvePlaceServerJar(root: string | null, explicit?: string) {
  if (explicit) return plainFile(explicit, 'Minecraft server JAR');
  if (!root) {
    throw new PlaceServeError(
      'Installed Place Compiler serving requires an explicit Minecraft server JAR',
      'place_serve_server_jar_required',
    );
  }
  const lock = readJson(path.join(root, 'docs', 'sf-world', 'tool-lock.json'));
  const relative = requiredText(lock?.tools?.minecraftServer?.path, 'Place server lock path');
  return plainFile(path.join(root, relative), 'Minecraft server JAR');
}

function executableFile(value: string, label: string) {
  const resolved = fs.realpathSync.native(path.resolve(value));
  const stats = fs.statSync(resolved);
  if (!stats.isFile()) throw new Error(`${label} must resolve to a regular file`);
  fs.accessSync(resolved, fs.constants.R_OK | fs.constants.X_OK);
  return resolved;
}

function createTranscript(fileValue: string, now: (() => Date) | undefined) {
  const file = path.resolve(fileValue);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const descriptor = fs.openSync(
    file,
    fs.constants.O_CREAT |
      fs.constants.O_EXCL |
      fs.constants.O_APPEND |
      fs.constants.O_WRONLY |
      fs.constants.O_NOFOLLOW,
    0o600,
  );
  let sequence = 0;
  let previousDigest: string | null = null;
  let closed = false;
  return Object.freeze({
    file,
    append(direction: 'sent' | 'received', line: string) {
      if (closed) throw new Error('Place serve transcript is closed');
      const base = {
        protocol: PLACE_SERVE_TRANSCRIPT_PROTOCOL,
        sequence: ++sequence,
        at: (now?.() ?? new Date()).toISOString(),
        direction,
        line,
        lineSha256: sha256Text(line),
        previousDigest,
      };
      const event = { ...base, digest: sha256Text(stableJson(base)) };
      fs.writeFileSync(descriptor, `${JSON.stringify(event)}\n`, 'utf8');
      fs.fsyncSync(descriptor);
      previousDigest = event.digest;
      return event;
    },
    close() {
      if (closed) return;
      closed = true;
      fs.closeSync(descriptor);
    },
  });
}

export function verifyPlaceServeTranscript(fileValue: string) {
  const file = plainFile(fileValue, 'Place serve transcript');
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  let previousDigest: string | null = null;
  const events = lines.map((line, index) => {
    const event = JSON.parse(line);
    const { digest, ...base } = event;
    if (
      event.protocol !== PLACE_SERVE_TRANSCRIPT_PROTOCOL ||
      event.sequence !== index + 1 ||
      event.previousDigest !== previousDigest ||
      event.lineSha256 !== sha256Text(event.line) ||
      digest !== sha256Text(stableJson(base))
    )
      throw new PlaceServeError(
        'Place serve transcript failed verification',
        'place_serve_transcript_invalid',
      );
    previousDigest = digest;
    return deepFreeze(event);
  });
  return Object.freeze({ file, events: Object.freeze(events), tipDigest: previousDigest });
}

function plainDirectory(value: string, label: string) {
  const resolved = path.resolve(value);
  const stats = fs.lstatSync(resolved);
  if (!stats.isDirectory() || stats.isSymbolicLink())
    throw new Error(`${label} must be a plain directory`);
  return fs.realpathSync.native(resolved);
}

function plainFile(value: string, label: string) {
  const resolved = path.resolve(value);
  const stats = fs.lstatSync(resolved);
  if (!stats.isFile() || stats.isSymbolicLink()) throw new Error(`${label} must be a plain file`);
  return fs.realpathSync.native(resolved);
}

function readJson(file: string) {
  return JSON.parse(fs.readFileSync(plainFile(file, 'JSON input'), 'utf8'));
}

function sha256File(file: string) {
  return createHash('sha256')
    .update(fs.readFileSync(plainFile(file, 'digest input')))
    .digest('hex');
}

function sha256Text(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function sha256Value(value: unknown): string | null {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) ? value : null;
}

function requiredText(value: unknown, label: string) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new Error(`${label} is required`);
  return text;
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

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new PlaceServeError(`${label} timed out`, 'place_serve_timeout')),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
