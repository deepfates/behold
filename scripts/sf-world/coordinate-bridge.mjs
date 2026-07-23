#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

function usage() {
  console.error(
    'Usage:\n' +
      '  coordinate-bridge.mjs <metadata.json> ll-to-xz <latitude> <longitude>\n' +
      '  coordinate-bridge.mjs <metadata.json> xz-to-ll <x> <z>\n' +
      '  coordinate-bridge.mjs --verify-landmarks <metadata.json> <landmarks.json>\n' +
      '  coordinate-bridge.mjs --self-test',
  );
}

function assertMetadata(metadata) {
  if (metadata.projection !== 'local') {
    throw new Error(
      `Unsupported projection: ${metadata.projection}; this bridge is pinned to Arnis local`,
    );
  }
  for (const key of [
    'minMcX',
    'maxMcX',
    'minMcZ',
    'maxMcZ',
    'minGeoLat',
    'maxGeoLat',
    'minGeoLon',
    'maxGeoLon',
  ]) {
    if (!Number.isFinite(metadata[key]))
      throw new Error(`Invalid or missing metadata field: ${key}`);
  }
}

export function llToXz(metadata, latitude, longitude) {
  assertMetadata(metadata);
  const xSpan = metadata.maxMcX - metadata.minMcX;
  const zSpan = metadata.maxMcZ - metadata.minMcZ;
  const rawX =
    metadata.minMcX +
    ((longitude - metadata.minGeoLon) / (metadata.maxGeoLon - metadata.minGeoLon)) * xSpan;
  const rawZ =
    metadata.minMcZ +
    (1 - (latitude - metadata.minGeoLat) / (metadata.maxGeoLat - metadata.minGeoLat)) * zSpan;
  return {
    latitude,
    longitude,
    x: Math.trunc(rawX),
    z: Math.trunc(rawZ),
    rawX,
    rawZ,
    insideBounds:
      latitude >= metadata.minGeoLat &&
      latitude <= metadata.maxGeoLat &&
      longitude >= metadata.minGeoLon &&
      longitude <= metadata.maxGeoLon,
  };
}

export function xzToLl(metadata, x, z) {
  assertMetadata(metadata);
  const xSpan = metadata.maxMcX - metadata.minMcX;
  const zSpan = metadata.maxMcZ - metadata.minMcZ;
  // Resolve a Minecraft block to its center. Using the west/north block edge
  // makes an exact integer land infinitesimally below that integer after an
  // IEEE-754 round trip, which can truncate into the neighboring block.
  const centerX = Math.min(metadata.maxMcX, Math.max(metadata.minMcX, x + 0.5));
  const centerZ = Math.min(metadata.maxMcZ, Math.max(metadata.minMcZ, z + 0.5));
  const longitude =
    metadata.minGeoLon +
    ((centerX - metadata.minMcX) / xSpan) * (metadata.maxGeoLon - metadata.minGeoLon);
  const latitude =
    metadata.maxGeoLat -
    ((centerZ - metadata.minMcZ) / zSpan) * (metadata.maxGeoLat - metadata.minGeoLat);
  return {
    x,
    z,
    latitude,
    longitude,
    blockCenter: true,
    insideBounds:
      x >= metadata.minMcX && x <= metadata.maxMcX && z >= metadata.minMcZ && z <= metadata.maxMcZ,
  };
}

function selfTest() {
  const metadata = {
    minMcX: 0,
    maxMcX: 1406,
    minMcZ: 0,
    maxMcZ: 1334,
    minGeoLat: 37.748,
    maxGeoLat: 37.76,
    minGeoLon: -122.454,
    maxGeoLon: -122.438,
    projection: 'local',
  };
  const block = llToXz(metadata, 37.7544, -122.4477);
  const inverse = xzToLl(metadata, block.x, block.z);
  const reconstructed = llToXz(metadata, inverse.latitude, inverse.longitude);
  if (reconstructed.x !== block.x || reconstructed.z !== block.z) {
    throw new Error(`Round-trip failed: ${JSON.stringify({ block, inverse, reconstructed })}`);
  }
  process.stdout.write(`${JSON.stringify({ status: 'ok', block, inverse }, null, 2)}\n`);
}

function verifyLandmarks(metadataPath, landmarksPath) {
  const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
  const document = JSON.parse(readFileSync(landmarksPath, 'utf8'));
  if (document.schemaVersion !== 1 || !Array.isArray(document.landmarks)) {
    throw new Error(`Malformed landmark document: ${landmarksPath}`);
  }
  let maximumLatitudeError = 0;
  let maximumLongitudeError = 0;
  for (const landmark of document.landmarks) {
    const forward = llToXz(metadata, landmark.latitude, landmark.longitude);
    const inverse = xzToLl(metadata, landmark.x, landmark.z);
    if (!forward.insideBounds || !inverse.insideBounds)
      throw new Error(`${landmark.id} is outside the world bounds`);
    if (forward.x !== landmark.x || forward.z !== landmark.z) {
      throw new Error(`${landmark.id} does not round-trip to its recorded block`);
    }
    if (
      Math.floor(landmark.x / 16) !== landmark.chunkX ||
      Math.floor(landmark.z / 16) !== landmark.chunkZ
    ) {
      throw new Error(`${landmark.id} has an incorrect recorded chunk`);
    }
    maximumLatitudeError = Math.max(
      maximumLatitudeError,
      Math.abs(inverse.latitude - landmark.latitude),
    );
    maximumLongitudeError = Math.max(
      maximumLongitudeError,
      Math.abs(inverse.longitude - landmark.longitude),
    );
  }
  process.stdout.write(
    `${JSON.stringify(
      {
        status: 'ok',
        landmarkCount: document.landmarks.length,
        maximumLatitudeErrorDegrees: maximumLatitudeError,
        maximumLongitudeErrorDegrees: maximumLongitudeError,
      },
      null,
      2,
    )}\n`,
  );
}

function main(arguments_) {
  if (arguments_[0] === '--self-test') selfTest();
  else if (arguments_[0] === '--verify-landmarks' && arguments_.length === 3) {
    verifyLandmarks(arguments_[1], arguments_[2]);
  } else {
    if (arguments_.length !== 4) {
      usage();
      process.exit(64);
    }
    const [metadataPath, operation, first, second] = arguments_;
    const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
    const a = Number(first);
    const b = Number(second);
    if (!Number.isFinite(a) || !Number.isFinite(b))
      throw new Error('Coordinates must be finite numbers');
    const result = operation === 'll-to-xz' ? llToXz(metadata, a, b) : xzToLl(metadata, a, b);
    if (operation !== 'll-to-xz' && operation !== 'xz-to-ll') {
      usage();
      throw new Error(`Unknown operation: ${operation}`);
    }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
