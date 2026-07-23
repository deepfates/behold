#!/usr/bin/env node
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { verifyWorldLifecycleJournal } from '../src/runtime/world-control';

const REPORT_PROTOCOL = 'behold.owned-world-proof.v1';
const INHABITANT_PROTOCOL = 'behold.owned-world-inhabitant-proof.v1';
const COMMON_ASSERTIONS = [
  'initialAffordanceObserved',
  'observationProtocolV2',
  'inhabitantSurfaceHasNoLoadedWorldScans',
  'boundedObservationLatency',
  'collectionConfirmedByMinecraft',
  'independentConsequenceObserved',
  'inhabitantBoundToManagedIdentity',
  'independentWitnessBoundToActEpoch',
  'managedEpochAdvancedOnRestart',
  'restartLoadedPriorLife',
  'consequencePersistedAcrossRestart',
  'restartDidNotRepeatCollection',
  'restartExtendedSameLoom',
  'lifecycleOwnedBothRuns',
] as const;
const ASSERTION_PROFILES = Object.freeze({
  'behold.first-person-continuity.v1': Object.freeze([
    ...COMMON_ASSERTIONS,
    'locomotionBudgetOwnedByBody',
    'exactMovingEntityApproachConfirmed',
    'occludedEntityTrackedButNotPerceived',
    'occludedTargetDeniedBeforeMotion',
    'visibleEntityEarnedExactTarget',
    'firstLifePersistedFourTurns',
  ]),
  'behold.packaged-place-continuity.v1': Object.freeze([
    ...COMMON_ASSERTIONS,
    'packagedPlaceIdentityBound',
    'firstLifePersistedOneTurn',
  ]),
} as const);
type AssertionProfile = keyof typeof ASSERTION_PROFILES;

export type OwnedWorldProofVerification = Readonly<{
  status: 'verified';
  reportFile: string;
  reportSha256: string;
  assertionProfile: AssertionProfile;
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
    !safeSegment(manifest.runId) ||
    !safeSegment(manifest.worldId) ||
    !Array.isArray(manifest.entries) ||
    typeof manifest.report !== 'string' ||
    typeof manifest.placeRelease?.manifest !== 'string' ||
    typeof manifest.placeRelease?.checksums !== 'string'
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
  const reportFile = resolvePortableFile(root, manifest.report, 'portable report');
  const report = readJson(reportFile);
  if (manifest.runId !== report.runId || manifest.worldId !== report.worldId) {
    throw new Error('Portable proof identity does not match its report');
  }
  const releaseManifest = resolvePortableFile(
    root,
    manifest.placeRelease.manifest,
    'Place release manifest',
  );
  const releaseChecksums = resolvePortableFile(
    root,
    manifest.placeRelease.checksums,
    'Place release checksums',
  );
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
    !isAssertionProfile(report.assertionProfile) ||
    !safeSegment(report.runId) ||
    !safeSegment(report.worldId) ||
    !safeSegment(report.entityId)
  ) {
    throw new Error('Malformed owned-world proof report identity');
  }
  const requiredAssertions = ASSERTION_PROFILES[report.assertionProfile as AssertionProfile];
  if (
    Object.keys(report.assertions ?? {}).length !== requiredAssertions.length ||
    requiredAssertions.some((name) => report.assertions?.[name] !== true)
  ) {
    throw new Error('Owned-world proof assertions are incomplete or false');
  }
  const target = report.target;
  if (
    target?.item !== 'apple' ||
    target?.count !== 1 ||
    ![target?.x, target?.y, target?.z].every(Number.isSafeInteger)
  ) {
    throw new Error('Owned-world proof target is unsupported');
  }
  assertDigest(report.server?.sha256, 'server JAR digest');
  if (
    typeof report.repository?.revision !== 'string' ||
    !/^[a-f0-9]{40}$/.test(report.repository.revision)
  ) {
    throw new Error('Owned-world proof lacks a clean source revision');
  }
  const expectedActTurns =
    report.assertionProfile === 'behold.packaged-place-continuity.v1' ? 1 : 4;
  const expectedResumeTurns = expectedActTurns + 1;
  const expectedScenario =
    report.assertionProfile === 'behold.packaged-place-continuity.v1'
      ? 'place-continuity'
      : 'perception-continuity';

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
      proof.scenario !== expectedScenario ||
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
    act.resultingTurns !== expectedActTurns ||
    act.collectionAttempts !== 1 ||
    act.collection?.result?.ok !== true ||
    act.collection?.result?.item !== target.item ||
    act.collection?.result?.confirmation !== 'mineflayer:playerCollect' ||
    act.independentWitness?.source !== 'fresh_minecraft_connection' ||
    act.independentWitness?.managedRunId !== act.runId ||
    act.independentWitness?.droppedItems?.some((item: any) => item?.name === target.item) ||
    resume.priorTurns !== expectedActTurns ||
    resume.resultingTurns !== expectedResumeTurns ||
    resume.collectionAttempts !== 0 ||
    inventoryCount(resume.initialObservation, target.item) !== target.count ||
    resume.initialDroppedItems?.some((item: any) => item?.name === target.item)
  ) {
    throw new Error('Owned-world inhabitant consequence does not survive restart exactly once');
  }
  verifyFirstPersonEvidence(report, act, resume);

  const loomFile = resolveEvidencePath(root, report.artifacts?.loomFile, 'inhabitant loom');
  assertDigest(report.artifacts?.loomSha256, 'inhabitant loom digest');
  if (sha256File(loomFile) !== report.artifacts.loomSha256) {
    throw new Error('Inhabitant loom digest mismatch');
  }
  verifyLyncTrajectory(loomFile, report, expectedActTurns);
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
    assertionProfile: report.assertionProfile,
    worldId: report.worldId,
    entityId: report.entityId,
    epochs: [phases[0].epoch, phases[1].epoch],
    placeEpoch,
    files,
  };
}

function verifyFirstPersonEvidence(report: any, act: any, resume: any) {
  const forbiddenScans = [
    'find_blocks',
    'inspect_volume',
    'inspect_reachable_space',
    'nearest_entity',
    'get_nearby',
    'survey_area',
  ];
  const initial = act.initialObservation;
  const resumeInitial = resume.initialObservation;
  const target = report.target;
  const performance =
    report.assertionProfile === 'behold.packaged-place-continuity.v1'
      ? act.observationPerformance
      : act.approach?.observationPerformance;
  if (
    initial?.protocol !== 'behold.inhabitant.v2' ||
    resumeInitial?.protocol !== 'behold.inhabitant.v2' ||
    initial?.scene?.terrain?.source !== 'vision' ||
    initial?.scene?.terrain?.raysCast !== 45 ||
    !initial?.scene?.entities?.some(
      (entity: any) => entity?.kind === 'item' && entity?.name === target.item,
    ) ||
    forbiddenScans.some((tool) => act.inhabitantActions?.includes(tool)) ||
    performance?.samples !== 20 ||
    performance?.raysPerObservation !== 45 ||
    report.budgets?.observationP95Ms !== 50 ||
    performance?.p95Ms > report.budgets?.observationP95Ms ||
    report.budgets?.visualTerrainRaysPerObservation !== 45 ||
    report.budgets?.modelCalls !== 0 ||
    report.budgets?.modelCostUsd !== 0 ||
    initial?.circle?.id !== report.worldId ||
    initial?.circle?.managedRunId !== act.runId ||
    resumeInitial?.circle?.id !== report.worldId ||
    resumeInitial?.circle?.managedRunId !== resume.runId ||
    act.collection?.result?.ok !== true ||
    act.collection?.result?.item !== target.item ||
    act.collection?.result?.confirmation !== 'mineflayer:playerCollect' ||
    !/^entity:\d+$/.test(String(act.collection?.result?.target || '')) ||
    Object.keys(act.collection?.action?.input ?? {}).join(',') !== 'target' ||
    act.independentWitness?.worldId !== report.worldId ||
    act.independentWitness?.managedRunId !== act.runId
  ) {
    throw new Error('Owned-world proof does not establish the declared first-person contract');
  }

  if (report.assertionProfile === 'behold.packaged-place-continuity.v1') {
    if (act.locomotion !== null || act.approach !== null || report.placeEpoch == null) {
      throw new Error(
        'Packaged Place proof contains the wrong scenario or lacks its Place binding',
      );
    }
    return;
  }

  const hidden = act.approach?.hidden;
  const approach = act.approach?.turn;
  if (
    report.placeEpoch !== null ||
    act.locomotion?.result?.ok !== true ||
    act.locomotion?.result?.status !== 'advanced_toward' ||
    act.locomotion?.result?.bodyLegLimit !== 6 ||
    act.locomotion?.result?.arrivedAtRequestedDestination !== false ||
    Object.keys(act.locomotion?.action?.input ?? {})
      .sort()
      .join(',') !== 'x,y,z' ||
    hidden?.rawTracked !== true ||
    !hidden?.observation?.scene?.social?.playersOnline?.includes('ProofWitness') ||
    hidden?.turn?.result?.ok !== false ||
    hidden?.turn?.result?.error !== 'target_not_perceived' ||
    positionDistance(hidden?.residentBefore, hidden?.residentAfter) >= 0.1 ||
    hidden?.eventsNamingTarget !== 0 ||
    hidden?.observation?.scene?.entities?.some(
      (entity: any) => entity?.id === 'player:ProofWitness',
    ) ||
    !act.approach?.visibleObservation?.scene?.entities?.some(
      (entity: any) =>
        entity?.id === 'player:ProofWitness' &&
        entity?.source === 'vision' &&
        entity?.visibility === 'visible',
    ) ||
    approach?.result?.ok !== true ||
    approach?.result?.target !== 'player:ProofWitness' ||
    approach?.result?.confirmation !== 'mineflayer:body_target_proximity' ||
    approach?.result?.pathfinderStopAcknowledged !== true ||
    positionDistance(act.approach?.witnessStartedAt, act.approach?.witnessFinishedAt) < 3 ||
    approach?.result?.finalDistance > approach?.result?.bodyStopDistance + 0.75 ||
    Object.keys(approach?.action?.input ?? {}).join(',') !== 'target'
  ) {
    throw new Error('First-person continuity proof lacks its occlusion and body-action evidence');
  }
}

function verifyLyncTrajectory(file: string, report: any, expectedActTurns: number) {
  const records = fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch {
        throw new Error(`Authoritative Lync has malformed JSON on line ${index + 1}`);
      }
    });
  const roots = records.filter((record) => record?.kind === 'lync/loom');
  const links = records.filter((record) => record?.kind === 'lync/turn');
  if (
    records.length !== roots.length + links.length ||
    roots.length !== 1 ||
    roots[0]?.payload?.meta?.protocol !== 'behold.entity-loom.v1' ||
    roots[0]?.payload?.meta?.entityId !== report.entityId ||
    roots[0]?.payload?.meta?.circleId !== report.worldId ||
    links.length !== expectedActTurns + 1
  ) {
    throw new Error('Authoritative Lync root or exact turn closure is invalid');
  }
  const expectedActions =
    expectedActTurns === 1
      ? ['collect_nearby_item', 'status']
      : ['move_to', 'approach_entity', 'approach_entity', 'collect_nearby_item', 'status'];
  for (const [index, link] of links.entries()) {
    const sequence = index + 1;
    const turn = link?.payload?.payload;
    const meta = link?.payload?.meta;
    const managedRunId =
      sequence <= expectedActTurns
        ? report.artifacts.act.managedRunId
        : report.artifacts.resume.managedRunId;
    if (
      turn?.protocol !== 'behold.entity-turn.v1' ||
      turn?.circleId !== report.worldId ||
      turn?.entityId !== report.entityId ||
      turn?.id !== `${report.entityId}:turn:${sequence}` ||
      turn?.sequence !== sequence ||
      turn?.parentId !== (sequence === 1 ? null : `${report.entityId}:turn:${sequence - 1}`) ||
      turn?.action?.id !== `${report.entityId}:script:${sequence}` ||
      turn?.action?.source !== 'script' ||
      turn?.action?.name !== expectedActions[index] ||
      turn?.observation?.protocol !== 'behold.inhabitant.v2' ||
      turn?.observation?.circle?.id !== report.worldId ||
      turn?.observation?.circle?.managedRunId !== managedRunId ||
      turn?.nextObservation?.protocol !== 'behold.inhabitant.v2' ||
      turn?.nextObservation?.circle?.id !== report.worldId ||
      turn?.nextObservation?.circle?.managedRunId !== managedRunId ||
      meta?.protocol !== 'behold.entity-turn-link.v1' ||
      meta?.entityId !== report.entityId ||
      meta?.sequence !== sequence ||
      meta?.legacyId !== turn.id
    ) {
      throw new Error(`Authoritative Lync turn ${sequence} is not the declared trajectory`);
    }
  }
  const collection = links[expectedActTurns - 1]?.payload?.payload;
  const resumed = links.at(-1)?.payload?.payload;
  if (
    collection?.outcome?.ok !== true ||
    collection?.outcome?.result?.item !== report.target.item ||
    collection?.outcome?.result?.confirmation !== 'mineflayer:playerCollect' ||
    resumed?.action?.name !== 'status' ||
    resumed?.outcome?.ok !== true
  ) {
    throw new Error('Authoritative Lync does not retain the consequence and resumed turn');
  }
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

function resolvePortableFile(root: string, candidate: string, label: string) {
  if (
    !candidate.length ||
    path.posix.isAbsolute(candidate) ||
    candidate.split('/').some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw new Error(`Malformed ${label} path`);
  }
  return resolveEvidencePath(root, path.join(root, ...candidate.split('/')), label);
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

function isAssertionProfile(value: unknown): value is AssertionProfile {
  return typeof value === 'string' && Object.hasOwn(ASSERTION_PROFILES, value);
}

function positionDistance(before: any, after: any) {
  if (!before || !after) return Number.POSITIVE_INFINITY;
  return Math.hypot(
    Number(after.x) - Number(before.x),
    Number(after.y) - Number(before.y),
    Number(after.z) - Number(before.z),
  );
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
