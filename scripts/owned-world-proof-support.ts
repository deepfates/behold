export interface ExpectedWorldChange {
  verb: string;
  position: { x: number; y: number; z: number };
  before: string;
  after: string;
  confirmationSource: string;
}

export function findConfirmedWorldChange(result: any, expected: ExpectedWorldChange) {
  if (!result?.ok || !Array.isArray(result.changes)) return null;
  return (
    result.changes.find(
      (change: any) =>
        change?.verb === expected.verb &&
        samePosition(change?.position, expected.position) &&
        change?.before === expected.before &&
        change?.after === expected.after &&
        change?.verified === true &&
        change?.observed === true &&
        change?.confirmation?.source === expected.confirmationSource,
    ) ?? null
  );
}

function samePosition(value: any, expected: { x: number; y: number; z: number }) {
  return (
    Number(value?.x) === expected.x &&
    Number(value?.y) === expected.y &&
    Number(value?.z) === expected.z
  );
}
