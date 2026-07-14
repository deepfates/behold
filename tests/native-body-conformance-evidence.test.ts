import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assessNativeBodyConformance,
  NATIVE_BODY_CONFORMANCE_PROTOCOL,
  NATIVE_BODY_PHASE_PROTOCOL,
} from '../scripts/native-body-conformance-evidence';

test('native body conformance requires one bounded reposition and independently witnessed exact mutation', () => {
  const report = passingReport();
  const assessment = assessNativeBodyConformance(report);
  assert.equal(assessment.pass, true);
  assert.ok(Object.values(assessment.assertions).every(Boolean));

  const cases: Array<[string, (candidate: any) => void]> = [
    ['bodyInitiallyOccupiesTarget', (candidate) => (candidate.phase.bodyBefore.x = 1.5)],
    ['sameAdmittedPlayerAction', (candidate) => (candidate.phase.turn.action.input.x = 1)],
    ['boundedStepAside', (candidate) => (candidate.phase.turn.result.navigation.final.x = 4.5)],
    [
      'exactMinecraftConsequence',
      (candidate) => (candidate.phase.turn.result.changes[0].observed = false),
    ],
    [
      'inventoryConsequence',
      (candidate) => (candidate.phase.finalObservation.self.inventory[0].count = 1),
    ],
    ['independentWitness', (candidate) => (candidate.independentWitness.blocks[0].name = 'air')],
    ['cleanManagedStop', (candidate) => (candidate.finalOwnership.port = 'owned')],
  ];
  for (const [assertion, mutate] of cases) {
    const candidate = structuredClone(report);
    mutate(candidate);
    const changed = assessNativeBodyConformance(candidate);
    assert.equal(
      changed.assertions[assertion as keyof typeof changed.assertions],
      false,
      assertion,
    );
    assert.equal(changed.pass, false, assertion);
  }
});

function passingReport() {
  const target = { x: 0, y: -60, z: 0 };
  const body = { x: 0.5, y: -60, z: 0.5 };
  const inventory = (count: number) => ({ self: { inventory: [{ name: 'dirt', count }] } });
  return {
    protocol: NATIVE_BODY_CONFORMANCE_PROTOCOL,
    repositoryRevision: 'a'.repeat(40),
    worldId: 'world',
    managedRunId: 'world-1',
    phase: {
      protocol: NATIVE_BODY_PHASE_PROTOCOL,
      repositoryRevision: 'a'.repeat(40),
      entityId: 'BodyResident',
      model: 'script/native-body-conformance-v1',
      worldId: 'world',
      managedRunId: 'world-1',
      priorTurns: 0,
      resultingTurns: 1,
      bodyBefore: body,
      target,
      initialObservation: {
        ...inventory(1),
        circle: { id: 'world', managedRunId: 'world-1' },
      },
      turn: {
        action: {
          name: 'place_block',
          source: 'script',
          input: { ...target, name: 'dirt' },
        },
        result: {
          ok: true,
          navigation: {
            ok: true,
            target: 'placement step-aside',
            start: body,
            final: { x: 1.5, y: -60, z: 0.5 },
          },
          changes: [
            {
              verb: 'place',
              position: target,
              before: 'air',
              after: 'dirt',
              verified: true,
              observed: true,
              confirmation: { source: 'mineflayer:blockUpdate' },
            },
          ],
        },
      },
      finalObservation: inventory(0),
    },
    independentWitness: {
      source: 'fresh_minecraft_connection',
      entityId: 'BodyWitness',
      worldId: 'world',
      managedRunId: 'world-1',
      blocks: [{ position: target, name: 'dirt' }],
    },
    loomSha256: 'b'.repeat(64),
    lifecycle: { verified: true, tipDigest: 'c'.repeat(64) },
    finalOwnership: { control: 'clear', port: 'clear', leases: 'clear' },
  };
}
