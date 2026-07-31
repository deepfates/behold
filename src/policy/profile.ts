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

/** Product residents share causal progress safeguards without sharing a personality prompt. */
export function usesResidentProgressSafeguards(profile: ResidentPolicyProfile) {
  return profile !== 'neutral-benchmark-v1';
}

/** Profiles ratified for the ordinary human-comparable semantic body/action surface. */
export function usesHumanSemanticPolicySurface(profile: ResidentPolicyProfile) {
  return profile !== 'resident-v1';
}
