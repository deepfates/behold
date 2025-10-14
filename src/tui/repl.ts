#!/usr/bin/env ts-node
import { runConsole } from './console';

runConsole().catch((e) => { console.error('[console] fatal:', e); process.exit(1); });
