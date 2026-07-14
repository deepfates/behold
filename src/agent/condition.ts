export const CRITICAL_BODY_THRESHOLDS = Object.freeze({
  health: 6,
  food: 2,
  oxygen: 5,
});

/** Minecraft-specific body pressure that remains urgent until the value improves. */
export function isCriticalBodyCondition(condition: any) {
  return (
    finiteAtMost(condition?.health, CRITICAL_BODY_THRESHOLDS.health) ||
    finiteAtMost(condition?.food, CRITICAL_BODY_THRESHOLDS.food) ||
    finiteAtMost(condition?.oxygen, CRITICAL_BODY_THRESHOLDS.oxygen)
  );
}

/**
 * A new emergency signal, not merely the continued presence of an old one.
 * Unknown sensor state becoming healthy and non-critical hunger/oxygen drift
 * must not repeatedly re-trigger urgent cognition because another metric (for
 * example health) is already critical.
 */
export function bodyConditionBecameOrWorsenedCritical(previous: any, current: any) {
  return (
    metricBecameOrWorsenedCritical(
      previous?.health,
      current?.health,
      CRITICAL_BODY_THRESHOLDS.health,
    ) ||
    metricBecameOrWorsenedCritical(previous?.food, current?.food, CRITICAL_BODY_THRESHOLDS.food) ||
    metricBecameOrWorsenedCritical(
      previous?.oxygen,
      current?.oxygen,
      CRITICAL_BODY_THRESHOLDS.oxygen,
    )
  );
}

function metricBecameOrWorsenedCritical(
  previousValue: unknown,
  currentValue: unknown,
  threshold: number,
) {
  const current = finiteNumber(currentValue);
  if (current == null || current > threshold) return false;
  const previous = finiteNumber(previousValue);
  return previous == null || previous > threshold || current < previous;
}

function finiteAtMost(value: unknown, threshold: number) {
  if (value == null) return false;
  const number = Number(value);
  return Number.isFinite(number) && number <= threshold;
}

function finiteNumber(value: unknown) {
  if (value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
