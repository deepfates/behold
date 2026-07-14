#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { benchmarkDimensions, hardwareFingerprint, loadBenchmark } from './benchmark-core.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const benchmarkPath = path.resolve(
  process.argv[2] ??
    path.join(repositoryRoot, 'docs/place-compiler/benchmarks/living-places-v1.json'),
);
const loaded = await loadBenchmark(benchmarkPath, repositoryRoot);
const result = {
  schemaVersion: 1,
  status: 'ready',
  benchmarkId: loaded.benchmark.id,
  benchmarkPath: path.relative(repositoryRoot, loaded.path),
  hardware: hardwareFingerprint(),
  dimensions: benchmarkDimensions,
  profiles: loaded.profiles,
  fixtures: loaded.fixtures.map((fixture) => ({
    placeId: fixture.placeId,
    runId: fixture.runId,
    worldTreeSha256: fixture.worldTreeSha256,
    worldFileCount: fixture.worldFileCount,
    worldSizeBytes: fixture.worldSizeBytes,
    world: fixture.world,
    minecraftBounds: {
      minX: fixture.metadata.minMcX,
      maxX: fixture.metadata.maxMcX,
      minZ: fixture.metadata.minMcZ,
      maxZ: fixture.metadata.maxMcZ,
    },
    checkpoints: fixture.checkpoints,
    experience: fixture.experience,
  })),
  execution: {
    inspections: loaded.benchmark.inspections,
    ecologySoak: loaded.benchmark.ecologySoak,
    performanceSweep: loaded.benchmark.performanceSweep,
  },
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
