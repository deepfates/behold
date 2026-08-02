export const RESIDENT_POLICY_PROFILES = [
  'resident-v4',
  'resident-v3',
  'resident-v2',
  'resident-v1',
  'neutral-benchmark-v1',
  'legible-resident-v1',
] as const;
export type ResidentPolicyProfile = (typeof RESIDENT_POLICY_PROFILES)[number];

export function residentPolicyProfile(value: unknown): ResidentPolicyProfile {
  const normalized = String(value || 'resident-v2').trim();
  if (RESIDENT_POLICY_PROFILES.includes(normalized as ResidentPolicyProfile)) {
    return normalized as ResidentPolicyProfile;
  }
  throw new Error(
    `Unsupported resident policy profile ${JSON.stringify(value)}; expected ${RESIDENT_POLICY_PROFILES.join(' or ')}`,
  );
}

/** The ordinary uncoached action-or-yield treatment. */
export function usesMinimalResidentChoice(profile: ResidentPolicyProfile) {
  return profile === 'resident-v4' || profile === 'resident-v3' || profile === 'resident-v2';
}

/** The ordinary uncoached treatment whose context is its chronological private transcript. */
export function usesContinuousResidentTranscript(profile: ResidentPolicyProfile) {
  return profile === 'resident-v3';
}

/** The ordinary uncoached treatment with explicit chronological context epochs. */
export function usesResidentContextEpochs(profile: ResidentPolicyProfile) {
  return profile === 'resident-v4';
}

/** Profiles whose stable charter and own-life context form a resident session. */
export function usesResidentSessionPolicy(profile: ResidentPolicyProfile) {
  return (
    profile === 'resident-v4' ||
    profile === 'resident-v3' ||
    profile === 'resident-v2' ||
    profile === 'legible-resident-v1'
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
