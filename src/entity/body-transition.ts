export const BODY_TRANSITION_PROTOCOL = 'behold.body-transition.v1' as const;

export type BodyTransition = Readonly<{
  protocol: typeof BODY_TRANSITION_PROTOCOL;
  observation: 'motion_observed_during_control_interval_cause_unknown';
  frame: 'egocentric_at_control_start';
  units: Readonly<{ distance: 'blocks'; angle: 'radians' }>;
  requestedAxisProgress: number;
  lateralDisplacement: number;
  verticalDisplacement: number;
  netDistance: number;
  pathDistance: number;
  maxExcursion: number;
  yawDelta: number;
  pitchDelta: number;
  sampleCount: number;
}>;

const SIGNED_DISTANCE_LIMIT = 1_000_000;
const PATH_DISTANCE_LIMIT = 10_000_000;
const SAMPLE_COUNT_LIMIT = 1_000_000;

/**
 * Admit only the exact coordinate-free bodily receipt supplied to a resident.
 * Unknown fields stay in canonical source, but never enter continuity views.
 */
export function projectBodyTransition(value: unknown): BodyTransition | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, any>;
  if (
    candidate.protocol !== BODY_TRANSITION_PROTOCOL ||
    candidate.observation !== 'motion_observed_during_control_interval_cause_unknown' ||
    candidate.frame !== 'egocentric_at_control_start' ||
    candidate.units?.distance !== 'blocks' ||
    candidate.units?.angle !== 'radians'
  ) {
    return null;
  }
  const signed = [
    candidate.requestedAxisProgress,
    candidate.lateralDisplacement,
    candidate.verticalDisplacement,
  ];
  const distances = [candidate.netDistance, candidate.pathDistance, candidate.maxExcursion];
  const angles = [candidate.yawDelta, candidate.pitchDelta];
  if (
    !signed.every((item) => finiteInRange(item, -SIGNED_DISTANCE_LIMIT, SIGNED_DISTANCE_LIMIT)) ||
    !distances.every((item) => finiteInRange(item, 0, PATH_DISTANCE_LIMIT)) ||
    !angles.every((item) => finiteInRange(item, -Math.PI * 2, Math.PI * 2)) ||
    !Number.isSafeInteger(candidate.sampleCount) ||
    candidate.sampleCount < 0 ||
    candidate.sampleCount > SAMPLE_COUNT_LIMIT
  ) {
    return null;
  }
  return {
    protocol: BODY_TRANSITION_PROTOCOL,
    observation: 'motion_observed_during_control_interval_cause_unknown',
    frame: 'egocentric_at_control_start',
    units: { distance: 'blocks', angle: 'radians' },
    requestedAxisProgress: candidate.requestedAxisProgress,
    lateralDisplacement: candidate.lateralDisplacement,
    verticalDisplacement: candidate.verticalDisplacement,
    netDistance: candidate.netDistance,
    pathDistance: candidate.pathDistance,
    maxExcursion: candidate.maxExcursion,
    yawDelta: candidate.yawDelta,
    pitchDelta: candidate.pitchDelta,
    sampleCount: candidate.sampleCount,
  };
}

export function bodyTransitionShowsPoseChange(value: unknown) {
  const transition = projectBodyTransition(value);
  return (
    transition !== null &&
    [
      transition.requestedAxisProgress,
      transition.lateralDisplacement,
      transition.verticalDisplacement,
      transition.netDistance,
      transition.pathDistance,
      transition.maxExcursion,
      transition.yawDelta,
      transition.pitchDelta,
    ].some((item) => Math.abs(item) > 0.0001)
  );
}

function finiteInRange(value: unknown, minimum: number, maximum: number) {
  return (
    typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum
  );
}
