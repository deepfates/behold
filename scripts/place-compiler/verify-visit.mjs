#!/usr/bin/env node
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBenchmark } from './benchmark-core.mjs';
import { sha256 } from './core.mjs';
import { deriveVisitPlan, loadVisitContract } from './visit-core.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const REQUIRED_EVIDENCE = [
  'GUIDE.md',
  'visit-guide.json',
  'progress.jsonl',
  'evidence/checkpoint-map.png',
  'evidence/runtime-manifest.json',
  'evidence/server.log',
];

const fail = (message) => {
  throw new Error(`Place visit verification: ${message}`);
};
const assert = (condition, message) => {
  if (!condition) fail(message);
};

function parse(argv) {
  const options = {
    benchmark: path.join(repositoryRoot, 'docs/place-compiler/benchmarks/living-places-v3.json'),
    contract: path.join(repositoryRoot, 'docs/place-compiler/visits/living-places-v1.json'),
    reports: [],
    requireCapture: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--benchmark') options.benchmark = path.resolve(argv[++index]);
    else if (argv[index] === '--contract') options.contract = path.resolve(argv[++index]);
    else if (argv[index] === '--report') options.reports.push(path.resolve(argv[++index]));
    else if (argv[index] === '--require-capture') options.requireCapture = true;
    else fail(`unknown or incomplete argument ${argv[index]}`);
  }
  assert(options.reports.length > 0, 'at least one --report is required');
  return options;
}

export async function verifyVisitSet(options) {
  const benchmark = await loadBenchmark(options.benchmark, repositoryRoot);
  const contract = await loadVisitContract(options.contract, repositoryRoot, benchmark);
  const results = [];
  const seen = new Set();
  for (const reportPath of options.reports) {
    const result = await verifyVisitReport(reportPath, {
      benchmark,
      contract,
    });
    assert(!seen.has(result.placeId), `duplicate place ${result.placeId}`);
    seen.add(result.placeId);
    results.push(result);
  }
  if (options.reports.length > 1) {
    const expected = Object.keys(contract.places).sort();
    assert(
      JSON.stringify([...seen].sort()) === JSON.stringify(expected),
      `cross-place set must cover ${expected.join(', ')}`,
    );
  }
  if (options.requireCapture) {
    assert(results.some((result) => result.captured), 'cross-place set lacks required capture');
  }
  return {
    schemaVersion: 1,
    kind: 'place-human-visit-verification',
    status: 'verified',
    contractId: contract.contract.id,
    contractSha256: contract.sha256,
    capturedVisits: results.filter((result) => result.captured).length,
    visits: results.sort((left, right) => left.placeId.localeCompare(right.placeId)),
  };
}

export async function verifyVisitReport(reportPath, context) {
  const reportFile = path.resolve(reportPath);
  const root = path.dirname(reportFile);
  const report = readJson(reportFile, 'report');
  assert(
    report.schemaVersion === 1 &&
      report.kind === 'place-human-visit' &&
      report.status === 'completed',
    'unsupported or incomplete report',
  );
  assert(safeSegment(report.runId), 'invalid run id');
  const place = context.contract.places[report.placeId];
  assert(place, `unaccepted place ${report.placeId}`);
  const expectedPlan = deriveVisitPlan(place);
  assert(report.sourceRunId === expectedPlan.sourceRunId, 'source run mismatch');
  assert(report.worldTreeSha256 === expectedPlan.worldTreeSha256, 'world tree mismatch');
  assert(context.benchmark.profiles[report.profileId], 'unknown runtime profile');
  assert(
    report.contract?.id === context.contract.contract.id &&
      report.contract?.sha256 === context.contract.sha256,
    'contract binding mismatch',
  );
  assert(
    JSON.stringify(report.plan) === JSON.stringify(expectedPlan),
    'visit plan differs from accepted evidence',
  );

  verifyArrival(report.stages?.arrival, expectedPlan.arrival);
  verifyGroundLeg(report.stages?.groundLeg, expectedPlan.groundLeg);
  verifyReveal(report.stages?.reveal, expectedPlan.reveal);
  assert(report.join?.noAgentRequired === true, 'ordinary visit requires an agent');
  assert(report.shutdown?.clean === true && report.shutdown?.exitCode === 0, 'unclean shutdown');

  const evidence = await verifyEvidence(root, report, context, place);
  const progressFile = resolvePlainFile(root, report.progress?.path, 'progress');
  assert((await sha256(progressFile)) === report.progress?.sha256, 'progress digest mismatch');
  const progress = readProgress(progressFile, report.runId);
  verifyProgress(progress, expectedPlan.groundLeg.waypoints.length - 1);
  const captured = evidence.has('evidence/visit.mov');
  assert(report.client?.captured === captured, 'capture claim differs from evidence');

  return {
    placeId: report.placeId,
    runId: report.runId,
    profileId: report.profileId,
    worldTreeSha256: report.worldTreeSha256,
    report: path.relative(repositoryRoot, reportFile),
    reportSha256: await sha256(reportFile),
    evidenceFiles: evidence.size,
    captured,
    groundDistanceBlocks: report.stages.groundLeg.plannedDistanceBlocks,
    revealLiftBlocks: report.stages.reveal.liftBlocks,
  };
}

function verifyArrival(actual, expected) {
  assert(actual?.checkpointId === expected.checkpointId, 'arrival checkpoint mismatch');
  assert(actual.expectedSupport === expected.support.replace(/^minecraft:/, ''), 'arrival support claim mismatch');
  assert(actual.support === actual.expectedSupport, 'arrival support was not observed');
  assert(actual.feet === 'air' && actual.head === 'air' && actual.accepted === true, 'arrival is obstructed');
  assert(distance(actual.position, { x: expected.x + 0.5, y: expected.y, z: expected.z + 0.5 }) <= 2, 'arrival position mismatch');
}

function verifyGroundLeg(actual, expected) {
  assert(actual?.routeId === expected.routeId, 'ground route mismatch');
  assert(actual.plannedDistanceBlocks === expected.distanceBlocks, 'ground distance mismatch');
  assert(actual.waypointCount === expected.waypoints.length, 'ground waypoint count mismatch');
  assert(actual.collisionValidEvidence === expected.evidence, 'ground evidence claim mismatch');
  assert(Array.isArray(actual.observed) && actual.observed.length === expected.waypoints.length, 'ground observations incomplete');
  assert(Array.isArray(actual.traversals) && actual.traversals.length === expected.waypoints.length - 1, 'ground traversals incomplete');
  for (const [index, traversal] of actual.traversals.entries()) {
    const waypoint = expected.waypoints[index + 1];
    assert(
      traversal.waypointIndex === index + 1 && traversal.sampleIndex === waypoint.sampleIndex,
      `ground traversal ${index + 1} identity mismatch`,
    );
    assert(traversal.elapsedMilliseconds > 0, `ground traversal ${index + 1} lacks timing`);
    assert(
      traversal.pathUpdates?.some((update) => update.status === 'success' && update.pathNodes > 0),
      `ground traversal ${index + 1} lacks successful Minecraft path`,
    );
    assert(distance(actual.observed[index + 1], waypoint) <= 2.5, `ground traversal ${index + 1} missed waypoint`);
  }
  assert(actual.finalDistance <= 2.5, 'ground traversal missed final waypoint');
}

function verifyReveal(actual, expected) {
  assert(actual?.sightlineId === expected.sightlineId, 'reveal identity mismatch');
  assert(actual.measuredClear === expected.clear, 'reveal clearance mismatch');
  assert(actual.liftBlocks === expected.liftBlocks, 'reveal lift mismatch');
  assert(actual.limitation === expected.limitation, 'reveal limitation mismatch');
  assert(distance(actual.position, expected.observer) <= 2, 'reveal position drifted');
}

async function verifyEvidence(root, report, context, place) {
  assert(Array.isArray(report.evidence), 'evidence list missing');
  const entries = new Map();
  for (const entry of report.evidence) {
    assert(typeof entry.path === 'string' && !entries.has(entry.path), 'invalid or duplicate evidence path');
    assert(/^[a-f0-9]{64}$/.test(entry.sha256), `${entry.path} digest invalid`);
    const file = resolvePlainFile(root, entry.path, entry.path);
    assert(lstatSync(file).size === entry.sizeBytes, `${entry.path} size mismatch`);
    assert((await sha256(file)) === entry.sha256, `${entry.path} digest mismatch`);
    entries.set(entry.path, entry);
  }
  for (const required of REQUIRED_EVIDENCE) assert(entries.has(required), `missing ${required}`);
  const allowed = new Set([...REQUIRED_EVIDENCE, 'evidence/visit.mov']);
  assert([...entries.keys()].every((name) => allowed.has(name)), 'unexpected evidence file');
  assert(
    entries.get('evidence/checkpoint-map.png').sha256 === place.references.map.sha256,
    'checkpoint map is not the accepted map',
  );
  assert(entries.get('progress.jsonl').sha256 === report.progress.sha256, 'progress evidence mismatch');

  const guide = readJson(resolvePlainFile(root, 'visit-guide.json', 'visit guide'), 'visit guide');
  assert(guide.placeId === report.placeId && guide.profileId === report.profileId, 'visit guide identity mismatch');
  assert(JSON.stringify(guide.plan) === JSON.stringify(report.plan), 'visit guide plan mismatch');
  const markdown = readFileSync(resolvePlainFile(root, 'GUIDE.md', 'guide'), 'utf8');
  assert(markdown.includes(guide.joinAddress) && markdown.includes('No agent'), 'human guide lacks join/no-agent guidance');

  const runtime = readJson(
    resolvePlainFile(root, 'evidence/runtime-manifest.json', 'runtime manifest'),
    'runtime manifest',
  );
  assert(
    runtime.placeId === report.placeId &&
      runtime.sourceRunId === report.sourceRunId &&
      runtime.profileId === report.profileId &&
      runtime.profile?.minecraft?.gameMode === 'creative',
    'runtime manifest binding mismatch',
  );
  const serverLog = readFileSync(resolvePlainFile(root, 'evidence/server.log', 'server log'), 'utf8');
  assert(
    serverLog.includes('Done (') &&
      serverLog.includes('VisitProof joined the game') &&
      serverLog.includes('Stopping server') &&
      serverLog.includes('All dimensions are saved'),
    'server log does not prove ready/join/save/stop lifecycle',
  );
  return entries;
}

function readProgress(file, runId) {
  const lines = readFileSync(file, 'utf8').trim().split('\n');
  return lines.map((line, index) => {
    const event = JSON.parse(line);
    assert(
      event.schemaVersion === 1 &&
        event.kind === 'place-compiler-progress' &&
        event.lane === 'human-visit' &&
        event.runId === runId &&
        event.sequence === index + 1,
      `progress event ${index + 1} malformed`,
    );
    return event;
  });
}

function verifyProgress(events, traversals) {
  assert(!events.some((event) => event.status === 'failed'), 'progress contains failure');
  const indexOf = (stage, status) =>
    events.findIndex((event) => event.stage === stage && event.status === status);
  const required = [
    ['contract', 'verified'],
    ['runtime', 'materialized'],
    ['server', 'ready'],
    ['observer', 'connected'],
    ['arrival', 'completed'],
    ['ground-corridor', 'ready'],
    ['ground-leg', 'completed'],
    ['reveal', 'completed'],
    ['server', 'stopped'],
  ];
  let prior = -1;
  for (const [stage, status] of required) {
    const index = indexOf(stage, status);
    assert(index > prior, `progress lacks ordered ${stage}:${status}`);
    prior = index;
  }
  assert(
    events.filter((event) => event.stage === 'ground-waypoint' && event.status === 'completed').length === traversals,
    'progress ground-waypoint count mismatch',
  );
  const stopped = events.at(-1);
  assert(stopped.stage === 'server' && stopped.status === 'stopped' && stopped.clean === true, 'progress does not end at clean stop');
}

function resolvePlainFile(root, candidate, label) {
  assert(typeof candidate === 'string' && candidate.length > 0, `missing ${label}`);
  assert(!path.isAbsolute(candidate) && !candidate.split(/[\\/]/).includes('..'), `${label} path escapes root`);
  const file = path.resolve(root, candidate);
  const relative = path.relative(root, file);
  assert(relative && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative), `${label} path escapes root`);
  assert(existsSync(file), `${label} file missing`);
  const status = lstatSync(file);
  assert(status.isFile() && !status.isSymbolicLink(), `${label} is not a plain file`);
  return file;
}

function readJson(file, label) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    fail(`${label} is not valid JSON: ${error.message}`);
  }
}

function distance(left, right) {
  return Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);
}

function safeSegment(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value);
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  const options = parse(process.argv.slice(2));
  const result = await verifyVisitSet(options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
