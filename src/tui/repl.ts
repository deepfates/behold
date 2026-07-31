#!/usr/bin/env ts-node
import { config as loadDotenv } from 'dotenv';
import { runConsole } from './console';

if (process.env.BEHOLD_LOAD_DOTENV !== '0') loadDotenv();

runConsole().catch((e) => {
  console.error('[console] fatal:', e);
  process.exit(1);
});
