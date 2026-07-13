import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorldChangeGuard } from '../src/safety/world-change';

test('world-change guard enforces region and budget', () => {
  const guard = createWorldChangeGuard({
    budget: 1,
    radius: 8,
    anchor: () => ({ x: 10, y: 64, z: 10 }),
    now: () => 123,
  });

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
  guard.commit({
    verb: 'place',
    position: { x: 12, y: 64, z: 10 },
    before: 'air',
    after: 'lantern',
    evidence: {
      source: 'mineflayer:blockUpdate',
      observedAt: 122,
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
  const guard = createWorldChangeGuard({ budget: 1, now: () => now });
  const reservation = guard.reserve({
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
  guard.settle(reservation.reservationId, {
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
  const guard = createWorldChangeGuard({ budget: 1 });
  const reservation = guard.reserve({
    verb: 'dig',
    position: { x: 0, y: 64, z: 0 },
    before: 'stone',
  });
  assert.equal(reservation.ok, true);
  if (!reservation.ok) return;
  assert.throws(
    () => guard.settle(reservation.reservationId, { after: 'air', verified: true }),
    /requires evidence/,
  );
  assert.equal(guard.snapshot().changes[0].status, 'pending');
});
