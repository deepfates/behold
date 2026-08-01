export const RESIDENT_PERCEPTION_PROFILES = [
  'semantic-only-v1',
  'semantic-plus-camera-v1',
] as const;

export type ResidentPerceptionProfile = (typeof RESIDENT_PERCEPTION_PROFILES)[number];

export function residentPerceptionProfile(value: unknown): ResidentPerceptionProfile {
  const profile = String(value || 'semantic-only-v1').trim();
  if (!RESIDENT_PERCEPTION_PROFILES.includes(profile as ResidentPerceptionProfile)) {
    throw new Error(`Unsupported resident perception profile: ${profile}`);
  }
  return profile as ResidentPerceptionProfile;
}

export function usesResidentCamera(profile: ResidentPerceptionProfile) {
  return profile === 'semantic-plus-camera-v1';
}
