export const RESIDENT_POLICY_PROFILES = ['resident-v1', 'neutral-benchmark-v1'] as const;
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
