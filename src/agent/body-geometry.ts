export type BodyPosition = Readonly<{ x: number; y: number; z: number }>;
export type BodyBlockPosition = Readonly<{ x: number; y: number; z: number }>;

/**
 * Pure player-body safety shared by action publication and execution. It does
 * not inspect terrain or choose a target; it only rejects a block below the
 * body's support plane or directly supporting the body's footprint.
 */
export function digPositionIssueForBody(
  body: BodyPosition | null | undefined,
  position: BodyBlockPosition,
  width = 0.6,
): 'supporting_body' | 'below_support_plane' | null {
  if (![body?.x, body?.y, body?.z].every((value) => Number.isFinite(Number(value)))) return null;
  const feetY = Math.floor(Number(body!.y));
  if (position.y === feetY - 1) {
    const halfWidth = Math.max(0.1, Number(width) || 0.6) / 2;
    if (
      rangesOverlap(
        position.x,
        position.x + 1,
        Number(body!.x) - halfWidth,
        Number(body!.x) + halfWidth,
      ) &&
      rangesOverlap(
        position.z,
        position.z + 1,
        Number(body!.z) - halfWidth,
        Number(body!.z) + halfWidth,
      )
    ) {
      return 'supporting_body';
    }
  }
  if (position.y < feetY - 1) return 'below_support_plane';
  return null;
}

function rangesOverlap(aMin: number, aMax: number, bMin: number, bMax: number) {
  return aMin < bMax - 1e-6 && aMax > bMin + 1e-6;
}
