import type { Intent } from '../loop/arbiter';

export type InhabitantActionSpec = {
  type: 'function';
  function: { name: string; description?: string; parameters?: any };
};

/**
 * The complete boundary a controller needs in order to inhabit a world.
 *
 * World-specific clients own sensing and execution. A controller receives a
 * current observation, discovers the available action space, and attempts one
 * intent at a time. Consequences return separately through the engine event
 * stream, so accepting an intent is never confused with succeeding in-world.
 */
export type InhabitantInterface = {
  entityId: string;
  observe: (sinceSequence: number) => any;
  /** Complete capability catalog. It is not a claim that every action is meaningful now. */
  actions: readonly InhabitantActionSpec[];
  /**
   * World/body-owned, observation-bound action surface.
   *
   * If omitted, every catalog action is continuously available. Implementations
   * may narrow schemas to exact perceived targets, but may never introduce a
   * capability absent from actions. The controller still owns cognitive and
   * authorization constraints after this physical affordance boundary.
   */
  actionsFor?: (observation: any) => readonly InhabitantActionSpec[];
  attempt: (intent: Intent) => boolean | void;
};
