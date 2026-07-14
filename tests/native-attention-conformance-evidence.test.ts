import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assessNativeAttentionConformance,
  NATIVE_ATTENTION_CONFORMANCE_PROTOCOL,
  NATIVE_ATTENTION_PHASE_PROTOCOL,
} from '../scripts/native-attention-conformance-evidence';

test('native attention conformance requires real bodily urgency and acknowledged action yield', () => {
  const report = passingReport();
  const assessment = assessNativeAttentionConformance(report);
  assert.equal(assessment.pass, true);
  assert.ok(Object.values(assessment.assertions).every(Boolean));
});

test('native attention conformance rejects synthetic urgency and unacknowledged cancellation', () => {
  const synthetic = passingReport();
  synthetic.phase.bodilyUrgency.event.source = 'event';
  synthetic.phase.turns[0].nextObservation.events[0].source = 'event';
  assert.equal(assessNativeAttentionConformance(synthetic).assertions.realBodilyUrgency, false);

  const unacknowledged = passingReport();
  unacknowledged.phase.engineEvents[2].data.cancellation.acknowledged = false;
  unacknowledged.phase.engineEvents[2].data.failureKind = 'unacknowledged_cancellation';
  assert.equal(
    assessNativeAttentionConformance(unacknowledged).assertions.acknowledgedCancellation,
    false,
  );
});

function passingReport(): any {
  const start = { x: 0.5, y: -60, z: 0.5 };
  const destination = { x: 12, y: -60, z: 0 };
  const bodilyEvent = {
    sequence: 8,
    at: 110,
    type: 'condition_changed',
    salience: 'urgent',
    source: 'body',
    data: {
      previous: { health: 20, food: 20, oxygen: 6 },
      current: { health: 20, food: 20, oxygen: 5 },
    },
    isNew: true,
  };
  const intent = {
    id: 'attention-move',
    source: 'llm',
    tool: 'move_to',
    input: destination,
  };
  const outerCancellation = {
    requested: true,
    reason: 'bodily_urgent_attention',
    acknowledged: true,
    adapter: 'mineflayer-pathfinder',
  };
  const adapterResult = {
    ok: false,
    error: 'interrupted_by_human',
    requestedDestination: destination,
    final: { x: 2, y: -60, z: 0.5 },
    cancellation: { acknowledged: true, adapter: 'mineflayer-pathfinder' },
  };
  return {
    protocol: NATIVE_ATTENTION_CONFORMANCE_PROTOCOL,
    repositoryRevision: 'a'.repeat(40),
    worldId: 'world',
    managedRunId: 'world-1',
    phaseSha256: 'b'.repeat(64),
    serverPropertiesSha256: 'c'.repeat(64),
    loomSha256: 'd'.repeat(64),
    phase: {
      protocol: NATIVE_ATTENTION_PHASE_PROTOCOL,
      repositoryRevision: 'a'.repeat(40),
      entityId: 'AttentionBody',
      model: 'script/native-attention-conformance-v1',
      worldId: 'world',
      managedRunId: 'world-1',
      priorTurns: 0,
      resultingTurns: 1,
      destination,
      fixtureSetup: {
        kind: 'underwater_corridor_before_recorded_action',
        startBody: start,
        startFeet: { x: 0, y: -60, z: 0 },
        startHead: { x: 0, y: -59, z: 0 },
        destination,
        destinationFeet: destination,
        destinationHead: { x: 12, y: -59, z: 0 },
        startFeetBlock: 'water',
        startHeadBlock: 'water',
        destinationFeetBlock: 'water',
        destinationHeadBlock: 'water',
      },
      mindRequest: {
        protocol: 'behold.mind-request.v1',
        attention: { mode: 'deliberative', context: 'bounded_loom', triggers: [] },
        observation: {
          circle: { id: 'world', managedRunId: 'world-1' },
          self: { pose: { position: start }, condition: { oxygen: 8 } },
        },
      },
      bodilyUrgency: {
        event: bodilyEvent,
        bodyPosition: { x: 1, y: -60, z: 0.5 },
      },
      engineEvents: [
        { type: 'action_started', at: 100, data: { intent } },
        {
          type: 'cancellation_requested',
          at: 111,
          data: {
            intent,
            reason: 'bodily_urgent_attention',
            requestedBy: {
              source: 'system',
              input: {
                eventSequence: 8,
                eventType: 'condition_changed',
                eventSource: 'body',
              },
            },
          },
        },
        {
          type: 'action_failed',
          at: 120,
          data: {
            intent,
            result: adapterResult,
            cancellation: outerCancellation,
            failureKind: 'adapter_acknowledged_cancellation',
          },
        },
      ],
      turns: [
        {
          model: 'script/native-attention-conformance-v1',
          action: {
            id: intent.id,
            source: 'llm',
            name: 'move_to',
            input: destination,
          },
          outcome: {
            ok: false,
            eventType: 'action_failed',
            result: adapterResult,
            cancellation: outerCancellation,
          },
          nextObservation: { events: [{ ...bodilyEvent }] },
        },
      ],
      settledBodyPosition: adapterResult.final,
      policyState: { pendingIntentId: null },
      engineState: { inFlightIntent: null, queuedLease: null },
    },
    independentWitness: {
      source: 'fresh_minecraft_connection',
      entityId: 'AttentionSeen',
      blocks: [
        { position: { x: 0, y: -60, z: 0 }, name: 'water' },
        { position: { x: 0, y: -59, z: 0 }, name: 'water' },
        { position: { x: 12, y: -60, z: 0 }, name: 'water' },
        { position: { x: 12, y: -59, z: 0 }, name: 'water' },
      ],
    },
    lifecycle: { verified: true, tipDigest: 'e'.repeat(64) },
    finalOwnership: { control: 'clear', port: 'clear', leases: 'clear' },
  };
}
