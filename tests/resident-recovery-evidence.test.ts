import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assessResidentRecoveryWitness,
  RESIDENT_RECOVERY_WITNESS_PROTOCOL,
} from '../scripts/resident-recovery-evidence';

const digest = 'a'.repeat(64);

function report() {
  return {
    protocol: RESIDENT_RECOVERY_WITNESS_PROTOCOL,
    source: {
      entityId: 'WrenLife',
      worldId: 'first-life-v1',
      managedRunId: 'first-life-v1-30',
      finalPosition: { x: 53.5, y: 65, z: 91.5 },
      finalCondition: { health: 2, food: 13, oxygen: 20 },
      bodyMoved: true,
      verifiedWorldChange: true,
      journalSha256Before: digest,
      journalSha256After: digest,
      loomSha256Before: digest,
      loomSha256After: digest,
    },
    witness: {
      entityId: 'WrenLife',
      worldId: 'first-life-v1',
      managedRunId: 'first-life-v1-31',
      source: 'fresh_minecraft_connection',
      authority: 'external_evaluator',
      worldStateCertified: true,
      position: { x: 53.5, y: 65, z: 91.5 },
      condition: { health: 2, food: 13, oxygen: 20 },
      inspection: {
        ok: true,
        source: 'loaded_local_terrain',
        sealed: true,
        fullyCovered: true,
        protectedRegionCellCount: 1,
        closableEntranceCount: 1,
        problems: ['fewer than two reachable body cells fit'],
      },
    },
    lifecycle: { verified: true },
    finalOwnership: { control: 'clear', port: 'closed', leases: 'clear' },
  };
}

test('independent sealed single-body cover proves critical-body recovery without certifying a shared home', () => {
  const assessment = assessResidentRecoveryWitness(report());
  assert.equal(assessment.pass, true);
  assert.equal(assessment.measurements.defensibleCover, true);
  assert.equal(assessment.measurements.healthImproved, false);
  assert.equal(assessment.measurements.shelter.protectedRegionCellCount, 1);
});

test('body or food improvement is an alternative Minecraft recovery witness', () => {
  const input = report();
  input.witness.inspection.sealed = false;
  input.witness.inspection.fullyCovered = false;
  input.witness.inspection.closableEntranceCount = 0;
  input.witness.condition.health = 3;
  const assessment = assessResidentRecoveryWitness(input);
  assert.equal(assessment.pass, true);
  assert.equal(assessment.measurements.healthImproved, true);
  assert.equal(assessment.measurements.defensibleCover, false);
});

test('a controller claim, displaced body, or mutated autobiography cannot prove recovery', () => {
  const input = report();
  input.witness.source = 'controller_report';
  input.witness.position.x = 60;
  input.source.loomSha256After = 'b'.repeat(64);
  const assessment = assessResidentRecoveryWitness(input);
  assert.equal(assessment.pass, false);
  assert.equal(assessment.assertions.freshMinecraftWitness, false);
  assert.equal(assessment.assertions.persistedBodyPosition, false);
  assert.equal(assessment.assertions.inhabitantLoomUnchanged, false);
});

test('missing body telemetry cannot masquerade as a critical condition or improvement', () => {
  const input = report();
  input.source.finalCondition = { health: null, food: null, oxygen: null };
  input.witness.condition = { health: 1, food: 1, oxygen: 1 };
  input.witness.inspection.sealed = false;
  input.witness.inspection.fullyCovered = false;
  input.witness.inspection.closableEntranceCount = 0;
  const assessment = assessResidentRecoveryWitness(input);
  assert.equal(assessment.pass, false);
  assert.equal(assessment.assertions.sourceBodyWasCritical, false);
  assert.equal(assessment.measurements.healthImproved, false);
  assert.equal(assessment.measurements.foodImproved, false);
});
