import { parseArgs } from 'node:util';

/**
 * The process interface used by startManagedWorld for every resident entrypoint.
 * Custom proof residents deliberately share this parser with the production
 * resident so a launcher change cannot silently make the live proofs unbootable.
 */
export const MANAGED_RESIDENT_CLI_OPTIONS = Object.freeze({
  server: { type: 'string' },
  port: { type: 'string' },
  world: { type: 'string' },
  body: { type: 'string' },
  model: { type: 'string' },
  urgentModel: { type: 'string' },
  policyProfile: { type: 'string' },
  actionProfile: { type: 'string' },
  safetyProfile: { type: 'string' },
  tickMs: { type: 'string' },
  task: { type: 'string' },
  target: { type: 'string' },
  allowTools: { type: 'string' },
  paused: { type: 'boolean', default: false },
} as const);

export function parseManagedResidentArgs(argv = process.argv.slice(2)) {
  return parseArgs({
    args: argv,
    options: MANAGED_RESIDENT_CLI_OPTIONS,
    allowPositionals: true,
  });
}
