#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { buildOwnedWorldEvaluationPortfolio } from './owned-world-portfolio-evidence';
import { durableWriteJson, gitRevision, sha256File } from './owned-world-fixture';

function main() {
  const parsed = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      out: { type: 'string' },
      help: { type: 'boolean', default: false },
    },
  });
  if (parsed.values.help) {
    process.stdout.write(
      'Usage: owned-world-portfolio [--out <portfolio.json>] <canonical-reassessment.json> [...]\n',
    );
    return;
  }
  if (parsed.positionals.length === 0) {
    throw new Error('provide at least one canonical owned-world reassessment report');
  }

  const generatedAt = new Date();
  const output = path.resolve(
    String(
      parsed.values.out ||
        path.join(
          '.behold-runtime',
          'owned-world-evaluations',
          `portfolio-${generatedAt.toISOString().replace(/[:.]/g, '-')}.json`,
        ),
    ),
  );
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const portfolio = buildOwnedWorldEvaluationPortfolio(parsed.positionals, {
    now: () => generatedAt,
    repositoryRevision: gitRevision(),
  });
  durableWriteJson(output, portfolio);
  process.stdout.write(
    `[owned-world-portfolio] PASS ${output}\n[owned-world-portfolio] sha256 ${sha256File(output)}\n`,
  );
}

try {
  main();
} catch (error) {
  process.stderr.write(`[owned-world-portfolio] ${String(error)}\n`);
  process.exitCode = 1;
}
