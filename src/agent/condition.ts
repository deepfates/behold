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

function finiteAtMost(value: unknown, threshold: number) {
  if (value == null) return false;
  const number = Number(value);
  return Number.isFinite(number) && number <= threshold;
}
