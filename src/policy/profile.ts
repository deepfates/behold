export const RESIDENT_POLICY_PROFILES = [
  'resident-v1',
  'neutral-benchmark-v1',
  'legible-resident-v1',
] as const;
export type ResidentPolicyProfile = (typeof RESIDENT_POLICY_PROFILES)[number];

export function residentPolicyProfile(value: unknown): ResidentPolicyProfile {
  const normalized = String(value || 'resident-v1').trim();
  if (RESIDENT_POLICY_PROFILES.includes(normalized as ResidentPolicyProfile)) {
    return normalized as ResidentPolicyProfile;
  }
  throw new Error(
    `Unsupported resident policy profile ${JSON.stringify(value)}; expected ${RESIDENT_POLICY_PROFILES.join(' or ')}`,
  );
}

export function isNeutralPolicy(profile: ResidentPolicyProfile) {
  return profile === 'neutral-benchmark-v1';
}

/** Detailed survival, project, and loop-shaping behavior retained by the legacy product profile. */
export function usesResidentV1Behavior(profile: ResidentPolicyProfile) {
  return profile === 'resident-v1';
}

/** The legacy coached profile may reject choices it classifies as non-progress. */
export function usesResidentProgressSafeguards(profile: ResidentPolicyProfile) {
  return profile === 'resident-v1';
}

/** Profiles ratified for the ordinary human-comparable semantic body/action surface. */
export function usesHumanSemanticPolicySurface(profile: ResidentPolicyProfile) {
  return profile !== 'resident-v1';
}
