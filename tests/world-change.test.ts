import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorldChangeAuthority } from '../src/safety/world-change';

test('world-change guard enforces region and budget', () => {
  const { guard, executor } = createWorldChangeAuthority({
    budget: 1,
    radius: 8,
    anchor: () => ({ x: 10, y: 64, z: 10 }),
    now: () => 123,
  });
  assert.equal('reserve' in guard, false);
  assert.equal('settle' in guard, false);

  const outside = guard.authorize({
    verb: 'dig',
    position: { x: 30, y: 64, z: 10 },
    before: 'stone',
  });
  assert.equal(outside.ok, false);
  if (!outside.ok) assert.equal(outside.error, 'change_outside_allowed_region');

  const allowed = guard.authorize({
    verb: 'place',
    position: { x: 12, y: 64, z: 10 },
    before: 'air',
  });
  assert.equal(allowed.ok, true);
  const reservation = executor.reserve({
    verb: 'place',
    position: { x: 12, y: 64, z: 10 },
    before: 'air',
  });
  assert.equal(reservation.ok, true);
  if (!reservation.ok) return;
  executor.settle(reservation.reservationId, {
    after: 'lantern',
    verified: true,
    evidence: {
      source: 'mineflayer:blockUpdate',
      observedAt: 122,
      dimension: 'overworld',
      position: { x: 12, y: 64, z: 10 },
      before: { name: 'air', stateId: 0 },
      after: { name: 'lantern', stateId: 12 },
      beforeStateId: 0,
      afterStateId: 12,
    },
  });

  const exhausted = guard.authorize({
    verb: 'dig',
    position: { x: 11, y: 64, z: 10 },
    before: 'grass_block',
  });
  assert.equal(exhausted.ok, false);
  if (!exhausted.ok) assert.equal(exhausted.error, 'change_budget_exhausted');
  assert.equal(guard.snapshot().remaining, 0);
  assert.equal(guard.snapshot().changes[0].at, 123);
  assert.equal(guard.snapshot().changes[0].status, 'verified');
});

test('a pending or uncertain attempt consumes the budget before a side effect can race', () => {
  let now = 10;
  const { guard, executor } = createWorldChangeAuthority({ budget: 1, now: () => now });
  const reservation = executor.reserve({
    verb: 'dig',
    position: { x: 1, y: 64, z: 1 },
    before: 'stone',
  });
  assert.equal(reservation.ok, true);
  assert.equal(guard.snapshot().used, 1);
  assert.equal(guard.snapshot().changes[0].status, 'pending');
  assert.equal(
    guard.authorize({ verb: 'place', position: { x: 2, y: 64, z: 1 }, before: 'air' }).ok,
    false,
  );

  assert.equal(reservation.ok, true);
  if (!reservation.ok) return;
  now = 20;
  executor.settle(reservation.reservationId, {
    after: 'air',
    verified: false,
    error: 'world_change_unconfirmed',
  });
  const snapshot = guard.snapshot();
  assert.equal(snapshot.used, 1);
  assert.equal(snapshot.remaining, 0);
  assert.equal(snapshot.changes[0].status, 'uncertain');
  assert.equal(snapshot.changes[0].settledAt, 20);
});

test('the guard refuses to label a change verified without Minecraft evidence', () => {
  const { guard, executor } = createWorldChangeAuthority({ budget: 1 });
  const reservation = executor.reserve({
    verb: 'dig',
    position: { x: 0, y: 64, z: 0 },
    before: 'stone',
  });
  assert.equal(reservation.ok, true);
  if (!reservation.ok) return;
  assert.throws(
    () => executor.settle(reservation.reservationId, { after: 'air', verified: true }),
    /requires evidence/,
  );
  assert.equal(guard.snapshot().changes[0].status, 'pending');
});

test('world-change authority does not leak mutable request, settlement, or snapshot state', () => {
  const anchor = { x: 10, y: 64, z: 10 };
  const request = {
    verb: 'place' as const,
    position: { x: 11, y: 64, z: 10 },
    before: 'air',
  };
  const evidence = {
    source: 'mineflayer:blockUpdate' as const,
    observedAt: 30,
    dimension: 'overworld',
    position: { x: 11, y: 64, z: 10 },
    before: { name: 'air', stateId: 0 },
    after: { name: 'lantern', stateId: 12 },
    beforeStateId: 0,
    afterStateId: 12,
  };
  const { guard, executor } = createWorldChangeAuthority({
    budget: 1,
    anchor: () => anchor,
  });
  const reservation = executor.reserve(request);
  assert.equal(reservation.ok, true);
  if (!reservation.ok) return;
  request.position.x = 999;
  const settled = executor.settle(reservation.reservationId, {
    after: 'lantern',
    verified: true,
    evidence,
  });
  evidence.afterStateId = 999;
  settled.position.x = 888;
  settled.evidence!.afterStateId = 888;
  anchor.x = 777;

  const first = guard.snapshot();
  assert.equal(first.anchor?.x, 777);
  assert.equal(first.changes[0].position.x, 11);
  assert.equal(first.changes[0].evidence?.afterStateId, 12);
  first.anchor!.x = 666;
  first.changes[0].position.x = 666;
  first.changes[0].evidence!.afterStateId = 666;

  const second = guard.snapshot();
  assert.equal(second.anchor?.x, 777);
  assert.equal(second.changes[0].position.x, 11);
  assert.equal(second.changes[0].evidence?.afterStateId, 12);
});
