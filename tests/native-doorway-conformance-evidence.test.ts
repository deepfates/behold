import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assessNativeDoorwayConformance,
  NATIVE_DOORWAY_CONFORMANCE_PROTOCOL,
  NATIVE_DOORWAY_PHASE_PROTOCOL,
} from '../scripts/native-doorway-conformance-evidence';

test('native doorway conformance requires selected passage, own memory, reverse reuse, and witness', () => {
  const report = passingReport();
  const assessment = assessNativeDoorwayConformance(report);
  assert.equal(assessment.pass, true);
  assert.ok(Object.values(assessment.assertions).every(Boolean));

  const cases: Array<[keyof typeof assessment.assertions, (candidate: any) => void]> = [
    [
      'exactFirstPersonSelection',
      (candidate) => (candidate.phase.initialObservation.scene.focus.source = 'scan'),
    ],
    [
      'crossedSelectedAperture',
      (candidate) => (candidate.phase.firstCrossing.result.crossing.doorCellOccupied = false),
    ],
    [
      'attributedDoorUse',
      (candidate) => (candidate.phase.firstCrossing.result.doorOpened.confirmation = null),
    ],
    [
      'residentEarnedMemory',
      (candidate) => candidate.phase.memoryAfterFirst[0].affordances.push('sealed-space'),
    ],
    [
      'restartProjection',
      (candidate) => (candidate.phase.memoryAfterRestart[0].label = 'invented'),
    ],
    ['directionNeutralReuse', (candidate) => (candidate.phase.reusedCrossing.result.toFeet.z = 9)],
    ['independentWitness', (candidate) => (candidate.independentWitness.door.open = true)],
    ['durableTurns', (candidate) => (candidate.phase.resultingTurns = 1)],
    ['cleanManagedStop', (candidate) => (candidate.finalOwnership.port = 'owned')],
  ];
  for (const [assertion, mutate] of cases) {
    const candidate = structuredClone(report);
    mutate(candidate);
    const changed = assessNativeDoorwayConformance(candidate);
    assert.equal(changed.assertions[assertion], false, assertion);
    assert.equal(changed.pass, false, assertion);
  }
});

function passingReport() {
  const south = { x: 3, y: -60, z: 1 };
  const north = { x: 3, y: -60, z: -1 };
  const lower = { x: 3, y: -60, z: 0 };
  const focus = {
    id: 'block:overworld:3:-60:0',
    kind: 'block',
    name: 'oak_door',
    source: 'cursor',
    position: lower,
    reachable: true,
  };
  const transition = (before: boolean, after: boolean) => ({
    ok: true,
    changed: { property: 'open', before, after },
    confirmation: { source: 'mineflayer:blockUpdate' },
  });
  const result = (fromFeet: any, toFeet: any) => ({
    ok: true,
    protocol: 'behold.visible-door-crossing.v1',
    crossed: true,
    focus,
    door: { lower, upper: { ...lower, y: -59 } },
    fromFeet: { ...fromFeet },
    toFeet: { ...toFeet },
    crossing: {
      doorCellOccupied: true,
      confirmation: 'mineflayer:body_crossed_selected_door_cell',
    },
    doorOpened: transition(false, true),
    doorClosed: transition(true, false),
  });
  const remembered = {
    id: 'doorway:world:overworld:3:-60:0',
    label: 'Proof door',
    circleId: 'world',
    evidence: 'doorway_crossed',
    affordances: ['witnessed-doorway-crossing'],
    protectedBodyCells: [],
    entrances: [],
    doorways: [
      {
        lower,
        sideAFeet: north,
        sideBFeet: south,
      },
    ],
    provenance: {
      kind: 'embodied_doorway',
      witnessAction: 'cross_visible_door',
    },
  };
  return {
    protocol: NATIVE_DOORWAY_CONFORMANCE_PROTOCOL,
    repositoryRevision: 'a'.repeat(40),
    worldId: 'world',
    managedRunId: 'world-1',
    phase: {
      protocol: NATIVE_DOORWAY_PHASE_PROTOCOL,
      repositoryRevision: 'a'.repeat(40),
      entityId: 'DoorResident',
      worldId: 'world',
      managedRunId: 'world-1',
      priorTurns: 0,
      resultingTurns: 2,
      initialObservation: {
        circle: { id: 'world', managedRunId: 'world-1' },
        scene: { focus },
      },
      firstCrossing: {
        action: {
          name: 'cross_visible_door',
          source: 'script',
          input: { focus: focus.id },
        },
        result: result(south, north),
        turn: { nextObservation: { self: { pose: { position: north } } } },
      },
      memoryAfterFirst: [remembered],
      memoryAfterRestart: [structuredClone(remembered)],
      reusedCrossing: {
        action: {
          name: 'cross_place_door',
          source: 'script',
          input: { id: remembered.id },
        },
        result: result(north, south),
      },
      finalObservation: { self: { pose: { position: { ...south } } } },
    },
    independentWitness: {
      source: 'fresh_minecraft_connection',
      entityId: 'DoorWitness',
      worldId: 'world',
      managedRunId: 'world-1',
      door: { name: 'oak_door', open: false },
      resident: { username: 'DoorResident', position: { ...south } },
    },
    loomSha256: 'b'.repeat(64),
    lifecycle: { verified: true, tipDigest: 'c'.repeat(64) },
    finalOwnership: { control: 'clear', port: 'clear', leases: 'clear' },
  };
}
