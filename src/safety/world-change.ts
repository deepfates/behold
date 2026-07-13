export type BlockPosition = { x: number; y: number; z: number };

export type WorldChangeRequest = {
  verb: 'dig' | 'place';
  position: BlockPosition;
  before?: string | null;
};

export type WorldChangeEvidence = {
  source: 'mineflayer:blockUpdate';
  observedAt: number;
  beforeStateId: number | null;
  afterStateId: number | null;
};

export type WorldChange = WorldChangeRequest & {
  id: string;
  after?: string | null;
  status: 'pending' | 'verified' | 'uncertain';
  verified: boolean;
  at: number;
  settledAt?: number;
  evidence?: WorldChangeEvidence;
  error?: string;
};

export type Authorization =
  | { ok: true }
  | {
      ok: false;
      error:
        | 'change_budget_exhausted'
        | 'change_outside_allowed_region'
        | 'safety_anchor_unavailable';
      reason: string;
    };

export type Reservation =
  | { ok: true; reservationId: string }
  | Exclude<Authorization, { ok: true }>;

export type WorldChangeSettlement = {
  after?: string | null;
  verified: boolean;
  evidence?: WorldChangeEvidence;
  error?: string;
};

export interface WorldChangeGuard {
  authorize(request: WorldChangeRequest): Authorization;
  reserve(request: WorldChangeRequest): Reservation;
  settle(reservationId: string, result: WorldChangeSettlement): WorldChange;
  commit(
    change: WorldChangeRequest & Omit<WorldChangeSettlement, 'verified'> & { verified?: boolean },
  ): WorldChange;
  snapshot(): {
    budget: number;
    used: number;
    remaining: number;
    radius: number | null;
    anchor: BlockPosition | null;
    changes: WorldChange[];
  };
}

export type BudgetGuardOptions = {
  budget: number;
  radius?: number | null;
  anchor?: () => BlockPosition | null;
  now?: () => number;
};

/** Enforces a small, inspectable block-change capability for live-world tasks. */
export function createWorldChangeGuard(opts: BudgetGuardOptions): WorldChangeGuard {
  const budget = Math.max(0, Math.floor(Number(opts.budget) || 0));
  const radius = opts.radius == null ? null : Math.max(0, Number(opts.radius));
  const now = opts.now ?? (() => Date.now());
  const changes: WorldChange[] = [];
  let nextReservation = 0;

  function currentAnchor() {
    return opts.anchor?.() ?? null;
  }

  function authorize(request: WorldChangeRequest): Authorization {
    if (changes.length >= budget) {
      return {
        ok: false,
        error: 'change_budget_exhausted',
        reason: `This task permits ${budget} block change${budget === 1 ? '' : 's'} and the budget is exhausted.`,
      };
    }
    if (radius != null) {
      const anchor = currentAnchor();
      if (!anchor) {
        return {
          ok: false,
          error: 'safety_anchor_unavailable',
          reason:
            'The protected task anchor is not currently observed, so the allowed region cannot be established.',
        };
      }
      if (distance(anchor, request.position) > radius) {
        return {
          ok: false,
          error: 'change_outside_allowed_region',
          reason: `The requested block is more than ${radius} blocks from the task anchor.`,
        };
      }
    }
    return { ok: true };
  }

  function reserve(request: WorldChangeRequest): Reservation {
    const authorization = authorize(request);
    if (authorization.ok === false) return authorization;
    const reservationId = `world-change-${++nextReservation}`;
    changes.push({
      ...request,
      id: reservationId,
      status: 'pending',
      verified: false,
      at: now(),
    });
    return { ok: true, reservationId };
  }

  function settle(reservationId: string, result: WorldChangeSettlement): WorldChange {
    const index = changes.findIndex((change) => change.id === reservationId);
    if (index < 0) throw new Error(`unknown world-change reservation: ${reservationId}`);
    const pending = changes[index];
    if (pending.status !== 'pending') {
      throw new Error(`world-change reservation already settled: ${reservationId}`);
    }
    if (result.verified && !result.evidence) {
      throw new Error(`verified world-change settlement requires evidence: ${reservationId}`);
    }
    const settled: WorldChange = {
      ...pending,
      ...result,
      status: result.verified ? 'verified' : 'uncertain',
      verified: result.verified,
      settledAt: now(),
    };
    changes[index] = settled;
    return { ...settled };
  }

  return {
    authorize,
    reserve,
    settle,
    commit(change) {
      const reservation = reserve(change);
      if (reservation.ok === false) throw new Error(reservation.error);
      return settle(reservation.reservationId, {
        after: change.after,
        verified: change.verified ?? change.evidence != null,
        evidence: change.evidence,
        error: change.error,
      });
    },
    snapshot() {
      return {
        budget,
        used: changes.length,
        remaining: Math.max(0, budget - changes.length),
        radius,
        anchor: currentAnchor(),
        changes: changes.map((change) => ({ ...change })),
      };
    },
  };
}

function distance(a: BlockPosition, b: BlockPosition) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
}
