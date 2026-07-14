#!/usr/bin/env node
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { verifyWorldLifecycleJournal } from '../src/runtime/world-control';

const REPORT_PROTOCOL = 'behold.owned-world-proof.v1';
const INHABITANT_PROTOCOL = 'behold.owned-world-inhabitant-proof.v1';
const REQUIRED_ASSERTIONS = [
  'initialAffordanceObserved',
  'collectionConfirmedByMinecraft',
  'independentConsequenceObserved',
  'firstLifePersistedOneTurn',
  'restartLoadedPriorLife',
  'consequencePersistedAcrossRestart',
  'restartDidNotRepeatCollection',
  'restartExtendedSameLoom',
  'lifecycleOwnedBothRuns',
] as const;

export type OwnedWorldProofVerification = Readonly<{
  status: 'verified';
  reportFile: string;
  reportSha256: string;
  worldId: string;
  entityId: string;
  epochs: readonly [number, number];
  placeEpoch: null | Readonly<{
    placeId: string;
    runId: string;
    profileId: string;
    releaseManifestSha256: string;
    placeWorldTreeSha256: string;
    beholdBaselineTreeSha256: string;
  }>;
  files: ReadonlyArray<Readonly<{ role: string; path: string; sha256: string }>>;
}>;

export function packageOwnedWorldProof(options: {
  reportFile: string;
  releaseRoot: string;
  outputRoot: string;
}) {
  const verification = verifyOwnedWorldProof(options.reportFile);
  if (!verification.placeEpoch) throw new Error('Portable package requires a Place epoch proof');
  const output = path.resolve(options.outputRoot);
  if (fs.existsSync(output)) throw new Error(`Proof package already exists: ${output}`);
  fs.mkdirSync(output, { recursive: true });
  try {
    const report = readJson(path.resolve(options.reportFile));
    const fileByRole = new Map(verification.files.map((file) => [file.role, file]));
    const destinations = new Map([
      ['act-proof', 'evidence/act.json'],
      ['resume-proof', 'evidence/resume.json'],
      ['act-lifecycle', 'lifecycle/lifecycle-1.jsonl'],
      ['resume-lifecycle', 'lifecycle/lifecycle-2.jsonl'],
      ['inhabitant-loom', 'inhabitant/turns.lync'],
    ]);
    for (const [role, relative] of destinations) {
      const source = fileByRole.get(role)?.path;
      if (!source) throw new Error(`Verified proof lacks ${role}`);
      copyPlainFile(source, path.join(output, relative));
    }
    const sanitized = JSON.parse(JSON.stringify(report));
    sanitized.repository.path = null;
    sanitized.server.jar = null;
    sanitized.server.java = null;
    if (sanitized.server.preparation) sanitized.server.preparation.transcriptFile = null;
    if (sanitized.placeEpoch) {
      sanitized.placeEpoch.paths = {
        source: null,
        baseline: null,
        runtime: null,
        archiveRoot: null,
        serverDirectory: null,
        worldDefinition: null,
      };
    }
    sanitized.artifacts.root = '.';
    sanitized.artifacts.loomFile = 'inhabitant/turns.lync';
    sanitized.artifacts.act.proofFile = 'evidence/act.json';
    sanitized.artifacts.act.lifecycleFile = 'lifecycle/lifecycle-1.jsonl';
    sanitized.artifacts.resume.proofFile = 'evidence/resume.json';
    sanitized.artifacts.resume.lifecycleFile = 'lifecycle/lifecycle-2.jsonl';
    writeJson(path.join(output, 'evidence', 'report.json'), sanitized);

    const releaseRoot = path.resolve(options.releaseRoot);
    const releaseManifest = path.join(releaseRoot, 'release-manifest.json');
    const releaseChecksums = path.join(releaseRoot, 'SHA256SUMS');
    if (sha256File(releaseManifest) !== verification.placeEpoch.releaseManifestSha256) {
      throw new Error('Selected Place release manifest does not match proof');
    }
    if (sha256File(releaseChecksums) !== report.placeEpoch.place.releaseChecksumsSha256) {
      throw new Error('Selected Place release checksums do not match proof');
    }
    copyPlainFile(releaseManifest, path.join(output, 'place-release', 'release-manifest.json'));
    copyPlainFile(releaseChecksums, path.join(output, 'place-release', 'SHA256SUMS'));

    const entries = listPlainFiles(output).map((file) => ({
      path: portableRelative(output, file),
      sizeBytes: fs.statSync(file).size,
      sha256: sha256File(file),
    }));
    const manifest = {
      protocol: 'behold.portable-owned-world-proof.v1',
      runId: report.runId,
      worldId: report.worldId,
      createdAt: report.completedAt,
      report: 'evidence/report.json',
      placeRelease: {
        manifest: 'place-release/release-manifest.json',
        checksums: 'place-release/SHA256SUMS',
      },
      entries,
    };
    writeJson(path.join(output, 'package-manifest.json'), manifest);
    return verifyPortableOwnedWorldProof(output);
  } catch (error) {
    fs.rmSync(output, { recursive: true, force: true });
    throw error;
  }
}

export function verifyPortableOwnedWorldProof(rootPath: string) {
  const root = path.resolve(rootPath);
  const manifest = readJson(path.join(root, 'package-manifest.json'));
  if (
    manifest.protocol !== 'behold.portable-owned-world-proof.v1' ||
    !Array.isArray(manifest.entries) ||
    typeof manifest.report !== 'string'
  ) {
    throw new Error('Malformed portable owned-world proof manifest');
  }
  const expectedPaths = manifest.entries.map((entry: any) => entry.path).sort();
  const actualPaths = listPlainFiles(root)
    .map((file) => portableRelative(root, file))
    .filter((relative) => relative !== 'package-manifest.json')
    .sort();
  if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) {
    throw new Error('Portable owned-world proof file closure mismatch');
  }
  for (const entry of manifest.entries) {
    if (
      typeof entry.path !== 'string' ||
      path.posix.isAbsolute(entry.path) ||
      entry.path.split('/').includes('..') ||
      !Number.isSafeInteger(entry.sizeBytes) ||
      entry.sizeBytes < 1
    ) {
      throw new Error('Malformed portable proof entry');
    }
    assertDigest(entry.sha256, `${entry.path} digest`);
    const file = path.join(root, ...entry.path.split('/'));
    if (fs.statSync(file).size !== entry.sizeBytes || sha256File(file) !== entry.sha256) {
      throw new Error(`Portable proof entry mismatch: ${entry.path}`);
    }
  }
  const reportFile = path.join(root, ...manifest.report.split('/'));
  const report = readJson(reportFile);
  const releaseManifest = path.join(root, ...manifest.placeRelease.manifest.split('/'));
  const releaseChecksums = path.join(root, ...manifest.placeRelease.checksums.split('/'));
  if (
    sha256File(releaseManifest) !== report.placeEpoch?.place?.releaseManifestSha256 ||
    sha256File(releaseChecksums) !== report.placeEpoch?.place?.releaseChecksumsSha256
  ) {
    throw new Error('Portable Place release identity mismatch');
  }
  const verification = verifyOwnedWorldProof(reportFile);
  return {
    status: 'verified' as const,
    root,
    packageManifestSha256: sha256File(path.join(root, 'package-manifest.json')),
    entries: manifest.entries.length,
    proof: verification,
  };
}

export function verifyOwnedWorldProof(reportPath: string): OwnedWorldProofVerification {
  const reportFile = path.resolve(reportPath);
  const report = readJson(reportFile);
  const root = path.dirname(path.dirname(reportFile));
  if (
    report.protocol !== REPORT_PROTOCOL ||
    !safeSegment(report.runId) ||
    !safeSegment(report.worldId) ||
    !safeSegment(report.entityId)
  ) {
    throw new Error('Malformed owned-world proof report identity');
  }
  if (
    Object.keys(report.assertions ?? {}).length !== REQUIRED_ASSERTIONS.length ||
    REQUIRED_ASSERTIONS.some((name) => report.assertions?.[name] !== true)
  ) {
    throw new Error('Owned-world proof assertions are incomplete or false');
  }
  const target = report.target;
  if (target?.item !== 'apple' || target?.count !== 1) {
    throw new Error('Owned-world proof target is unsupported');
  }

  const files: Array<{ role: string; path: string; sha256: string }> = [];
  const phases = (['act', 'resume'] as const).map((phase, index) => {
    const evidence = report.artifacts?.[phase];
    const proofFile = resolveEvidencePath(root, evidence?.proofFile, `${phase} proof`);
    const lifecycleFile = resolveEvidencePath(root, evidence?.lifecycleFile, `${phase} lifecycle`);
    assertDigest(evidence?.proofSha256, `${phase} proof digest`);
    if (sha256File(proofFile) !== evidence.proofSha256) {
      throw new Error(`${phase} proof digest mismatch`);
    }
    const proof = readJson(proofFile);
    if (
      proof.protocol !== INHABITANT_PROTOCOL ||
      proof.phase !== phase ||
      proof.entityId !== report.entityId ||
      proof.circleId !== report.worldId
    ) {
      throw new Error(`${phase} inhabitant proof identity mismatch`);
    }
    const lifecycle = verifyWorldLifecycleJournal(lifecycleFile);
    if (lifecycle.tipDigest !== evidence.lifecycleTipDigest) {
      throw new Error(`${phase} lifecycle tip mismatch`);
    }
    const epoch = index + 1;
    if (
      lifecycle.world !== report.worldId ||
      lifecycle.epoch !== epoch ||
      proof.runId !== `${report.worldId}-${epoch}`
    ) {
      throw new Error(`${phase} did not run in expected world epoch ${epoch}`);
    }
    const configured = lifecycle.events.find((event) => event.type === 'run_configured');
    const stopped = lifecycle.events.find((event) => event.type === 'run_stopped');
    const released = lifecycle.events.at(-1);
    const configuredData = configured?.data as any;
    const stoppedData = stopped?.data as any;
    if (
      configuredData?.runId !== proof.runId ||
      configuredData?.world?.id !== report.worldId ||
      configuredData?.world?.sourceDigest !== report.artifacts.sourceTree.digest ||
      configuredData?.world?.preparedBaselineDigest !== report.artifacts.baselineTree.digest ||
      configuredData?.serverJarSha256 !== report.server.sha256 ||
      stoppedData?.reason !== `owned_world_${phase}_complete` ||
      released?.type !== 'control_released'
    ) {
      throw new Error(`${phase} lifecycle does not close the declared managed run`);
    }
    files.push(
      { role: `${phase}-proof`, path: proofFile, sha256: evidence.proofSha256 },
      { role: `${phase}-lifecycle`, path: lifecycleFile, sha256: sha256File(lifecycleFile) },
    );
    return { phase, proof, epoch };
  });

  const act = phases[0].proof;
  const resume = phases[1].proof;
  if (
    act.priorTurns !== 0 ||
    act.resultingTurns !== 1 ||
    act.collectionAttempts !== 1 ||
    act.collection?.result?.ok !== true ||
    act.collection?.result?.item !== target.item ||
    act.collection?.result?.confirmation !== 'mineflayer:playerCollect' ||
    act.independentWitness?.source !== 'fresh_minecraft_connection' ||
    act.independentWitness?.managedRunId !== act.runId ||
    act.independentWitness?.droppedItems?.some((item: any) => item?.name === target.item) ||
    resume.priorTurns !== 1 ||
    resume.resultingTurns !== 2 ||
    resume.collectionAttempts !== 0 ||
    inventoryCount(resume.initialObservation, target.item) !== target.count ||
    resume.initialDroppedItems?.some((item: any) => item?.name === target.item)
  ) {
    throw new Error('Owned-world inhabitant consequence does not survive restart exactly once');
  }

  const loomFile = resolveEvidencePath(root, report.artifacts?.loomFile, 'inhabitant loom');
  assertDigest(report.artifacts?.loomSha256, 'inhabitant loom digest');
  if (sha256File(loomFile) !== report.artifacts.loomSha256) {
    throw new Error('Inhabitant loom digest mismatch');
  }
  files.push({ role: 'inhabitant-loom', path: loomFile, sha256: report.artifacts.loomSha256 });

  const placeEpoch = verifyPlaceBinding(report);
  const trees = report.artifacts;
  if (
    trees.sourceTree?.profile !== 'behold-tree-v2' ||
    trees.baselineTree?.profile !== 'behold-tree-v2' ||
    (placeEpoch && trees.admittedRuntimeTree?.digest !== trees.baselineTree.digest) ||
    trees.afterActTree?.digest === trees.initialRuntimeTree?.digest ||
    trees.afterResumeTree?.digest === trees.afterActTree?.digest
  ) {
    throw new Error('Owned-world tree progression is incomplete or inconsistent');
  }

  return {
    status: 'verified',
    reportFile,
    reportSha256: sha256File(reportFile),
    worldId: report.worldId,
    entityId: report.entityId,
    epochs: [phases[0].epoch, phases[1].epoch],
    placeEpoch,
    files,
  };
}

function verifyPlaceBinding(report: any): OwnedWorldProofVerification['placeEpoch'] {
  const admitted = report.placeEpoch;
  if (admitted == null) return null;
  if (
    admitted.protocol !== 'behold.place-epoch-admission.v1' ||
    admitted.worldId !== report.worldId ||
    admitted.place?.declaredWorldTreeSha256 !== admitted.place?.verifiedWorldTreeSha256 ||
    admitted.behold?.sourceTree?.digest !== report.artifacts?.sourceTree?.digest ||
    admitted.behold?.baselineTree?.digest !== report.artifacts?.baselineTree?.digest ||
    admitted.behold?.serverJarSha256 !== report.server?.sha256
  ) {
    throw new Error('Packaged Place identity is not bound to the managed proof');
  }
  for (const [label, value] of [
    ['release manifest', admitted.place.releaseManifestSha256],
    ['release checksums', admitted.place.releaseChecksumsSha256],
    ['world archive', admitted.place.worldArchiveSha256],
    ['evidence archive', admitted.place.evidenceArchiveSha256],
    ['Place world tree', admitted.place.verifiedWorldTreeSha256],
    ['runtime profile', admitted.profile?.sha256],
    ['Behold source tree', admitted.behold.sourceTree.digest],
    ['Behold baseline tree', admitted.behold.baselineTree.digest],
    ['server JAR', admitted.behold.serverJarSha256],
    ['world definition', admitted.behold.worldDefinitionSha256],
  ] as const) {
    assertDigest(value, `${label} digest`);
  }
  return {
    placeId: admitted.place.id,
    runId: admitted.place.runId,
    profileId: admitted.profile.id,
    releaseManifestSha256: admitted.place.releaseManifestSha256,
    placeWorldTreeSha256: admitted.place.verifiedWorldTreeSha256,
    beholdBaselineTreeSha256: admitted.behold.baselineTree.digest,
  };
}

function resolveEvidencePath(root: string, candidate: unknown, label: string) {
  if (typeof candidate !== 'string' || !candidate.length) throw new Error(`Missing ${label}`);
  const resolved = path.resolve(root, candidate);
  const relative = path.relative(root, resolved);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${label} escapes proof root`);
  }
  const status = fs.lstatSync(resolved);
  if (!status.isFile() || status.isSymbolicLink()) throw new Error(`${label} is not a plain file`);
  return resolved;
}

function inventoryCount(observation: any, name: string) {
  return (Array.isArray(observation?.self?.inventory) ? observation.self.inventory : [])
    .filter((item: any) => item?.name === name)
    .reduce((sum: number, item: any) => sum + Math.max(0, Number(item?.count) || 0), 0);
}

function assertDigest(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`Invalid ${label}`);
  }
}

function safeSegment(value: unknown) {
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value);
}

function readJson(file: string) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file: string, value: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
}

function copyPlainFile(source: string, destination: string) {
  const status = fs.lstatSync(source);
  if (!status.isFile() || status.isSymbolicLink()) throw new Error(`Not a plain file: ${source}`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
}

function listPlainFiles(root: string): string[] {
  return fs
    .readdirSync(root, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name, 'en'))
    .flatMap((entry) => {
      const file = path.join(root, entry.name);
      if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) {
        throw new Error(`Unsupported portable proof entry: ${file}`);
      }
      return entry.isDirectory() ? listPlainFiles(file) : [file];
    });
}

function portableRelative(root: string, file: string) {
  return path.relative(root, file).split(path.sep).join('/');
}

function sha256File(file: string) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

if (require.main === module) {
  try {
    const [command, ...args] = process.argv.slice(2);
    let result: unknown;
    if (command === 'package') {
      const values = new Map<string, string>();
      for (let index = 0; index < args.length; index += 2) {
        const name = args[index];
        const value = args[index + 1];
        if (!name?.startsWith('--') || !value) throw new Error('Malformed package arguments');
        values.set(name.slice(2), value);
      }
      for (const name of ['report', 'release', 'output']) {
        if (!values.has(name)) throw new Error(`--${name} is required`);
      }
      result = packageOwnedWorldProof({
        reportFile: values.get('report')!,
        releaseRoot: values.get('release')!,
        outputRoot: values.get('output')!,
      });
    } else if (command === 'verify-package') {
      if (args.length !== 1) throw new Error('verify-package requires one package directory');
      result = verifyPortableOwnedWorldProof(args[0]);
    } else {
      if (!command || args.length)
        throw new Error(
          'Usage: verify-owned-world-proof <report> | package --report <file> --release <dir> --output <dir> | verify-package <dir>',
        );
      result = verifyOwnedWorldProof(command);
    }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error: any) {
    process.stderr.write(`[verify-owned-world-proof] ${error?.message || String(error)}\n`);
    process.exitCode = 1;
  }
}
