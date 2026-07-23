#!/usr/bin/env node
import { initializeLocalWorldLabConfig } from './world-lab';

try {
  const result = initializeLocalWorldLabConfig();
  process.stdout.write(
    `[world-init] Created ${result.target} from ${result.source}. Edit its paths and digests for this machine before use.\n`,
  );
} catch (error: any) {
  process.stderr.write(`[world-init] ${error?.message || String(error)}\n`);
  process.exitCode = 1;
}
