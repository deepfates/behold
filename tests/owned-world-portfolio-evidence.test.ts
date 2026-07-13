import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { summarizeUsage } from '../scripts/owned-world-model-evidence';
import {
  attributeRequestBody,
  buildOwnedWorldEvaluationPortfolio,
} from '../scripts/owned-world-portfolio-evidence';
import { sha256File } from '../scripts/owned-world-fixture';

test('request attribution is an exact additive partition with one latest user message', () => {
  const body = requestBody('test/model');
  const attributed = attributeRequestBody(body);

  assert.equal(attributed.bodyChars, JSON.stringify(body).length);
  assert.equal(
    Object.values(attributed.components).reduce((total, value) => total + value, 0),
    attributed.bodyChars,
  );
  assert.equal(attributed.messageCount, 5);
  assert.equal(attributed.toolDefinitionCount, 1);
  assert.equal(attributed.latestUserLooksLikeWorldExperience, true);
  assert.ok(attributed.components.systemMessageChars > 0);
  assert.ok(attributed.components.latestUserMessageChars > 0);
  assert.ok(attributed.components.priorUserMessageChars > 0);
  assert.ok(attributed.components.assistantHistoryChars > 0);
  assert.ok(attributed.components.toolResultHistoryChars > 0);
  assert.ok(attributed.components.structuralChars > 0);
});

test('portfolio keeps real-proof scenarios distinct and exposes weak coverage as nonclaims', (t) => {
  const root = temporaryRoot(t);
  const immediate = scenario(root, 'immediate', 'model');
  const project = scenario(root, 'project', 'project');
  const portfolio = buildOwnedWorldEvaluationPortfolio(
    [immediate.reassessmentFile, project.reassessmentFile],
    {
      now: () => new Date('2026-07-13T00:00:00.000Z'),
      repositoryRevision: 'abc123',
    },
  );

  assert.equal(portfolio.status, 'passed');
  assert.equal(portfolio.summary.scenarioCount, 2);
  assert.equal(portfolio.summary.usage.callCount, 4);
  assert.equal(portfolio.summary.actionCount, 4);
  assert.equal(portfolio.summary.modelFailureCount, 0);
  assert.equal(
    Object.values(portfolio.summary.requestAttribution.components).reduce(
      (total: number, value: number) => total + value,
      0,
    ),
    portfolio.summary.requestAttribution.bodyChars,
  );
  assert.deepEqual(
    portfolio.scenarios.map((entry) => entry.runId),
    ['immediate', 'project'],
  );
  assert.deepEqual(
    portfolio.scenarios.map((entry) => entry.sourceStatus),
    ['failed', 'failed'],
  );
  assert.deepEqual(
    portfolio.scenarios.map((entry) => entry.uniqueActionNames),
    [
      ['inspect_volume', 'wait_for_event'],
      ['inspect_volume', 'wait_for_event'],
    ],
  );
  assert.deepEqual(
    portfolio.nonclaims.map((entry) => entry.code),
    [
      'model_interchange_not_proven',
      'cross_world_generality_not_proven',
      'statistical_reliability_not_proven',
    ],
  );
});

test('portfolio refuses non-passing reassessment, failed integrity, and duplicate run identity', (t) => {
  const root = temporaryRoot(t);
  const fixture = scenario(root, 'one', 'model');

  const failed = read(fixture.reassessmentFile);
  failed.status = 'failed';
  write(fixture.reassessmentFile, failed);
  assert.throws(
    () => buildOwnedWorldEvaluationPortfolio([fixture.reassessmentFile]),
    /reassessment is not passed/,
  );

  failed.status = 'passed';
  failed.integrity.loom = false;
  write(fixture.reassessmentFile, failed);
  assert.throws(
    () => buildOwnedWorldEvaluationPortfolio([fixture.reassessmentFile]),
    /does not prove loom/,
  );

  failed.integrity.loom = true;
  write(fixture.reassessmentFile, failed);
  assert.throws(
    () => buildOwnedWorldEvaluationPortfolio([fixture.reassessmentFile, fixture.reassessmentFile]),
    /duplicate scenario run identity/,
  );
});

test('portfolio independently detects source and journal tampering', (t) => {
  const root = temporaryRoot(t);
  const sourceTampered = scenario(root, 'source-tampered', 'model');
  fs.appendFileSync(sourceTampered.sourceFile, ' ');
  assert.throws(
    () => buildOwnedWorldEvaluationPortfolio([sourceTampered.reassessmentFile]),
    /source report sha256 mismatch/,
  );

  const journalTampered = scenario(root, 'journal-tampered', 'model');
  fs.appendFileSync(journalTampered.actJournal, '\n');
  assert.throws(
    () => buildOwnedWorldEvaluationPortfolio([journalTampered.reassessmentFile]),
    /act journal sha256 mismatch/,
  );
});

test('portfolio counts auxiliary calls and visible model failures without dropping either', (t) => {
  const root = temporaryRoot(t);
  const fixture = scenario(root, 'auxiliary-and-failure', 'model');
  const events = journal(fixture.actJournal);
  const auxiliary = modelCall('fold-call');
  events.push(envelope(3, 'model_auxiliary_call', { purpose: 'loom_fold', call: auxiliary }));
  events.push(
    envelope(4, 'model_auxiliary_call_failed', {
      purpose: 'loom_fold',
      error: 'provider unavailable',
    }),
  );
  writeJournal(fixture.actJournal, events);
  refreshEvidenceChain(fixture);
  const resumeCall = journal(fixture.resumeJournal)[0].data.call;
  const reassessment = read(fixture.reassessmentFile);
  reassessment.assessment.usage = summarizeUsage([events[0].data.call, auxiliary, resumeCall]);
  write(fixture.reassessmentFile, reassessment);

  const portfolio = buildOwnedWorldEvaluationPortfolio([fixture.reassessmentFile]);
  assert.equal(portfolio.summary.usage.callCount, 3);
  assert.equal(portfolio.summary.modelFailureCount, 1);
  assert.deepEqual(
    portfolio.scenarios[0].callAttribution.map((entry) => entry.purpose),
    ['resident_decision', 'auxiliary:loom_fold', 'resident_decision'],
  );
  assert.equal(portfolio.scenarios[0].modelFailures[0].type, 'model_auxiliary_call_failed');
});

test('portfolio rejects malformed calls, journal envelopes, and canonical usage disagreement', (t) => {
  const root = temporaryRoot(t);
  const malformedCall = scenario(root, 'malformed-call', 'model');
  const callEvents = journal(malformedCall.actJournal);
  callEvents[0].data.call.protocol = 'not-a-model-call';
  writeJournal(malformedCall.actJournal, callEvents);
  refreshEvidenceChain(malformedCall);
  assert.throws(
    () => buildOwnedWorldEvaluationPortfolio([malformedCall.reassessmentFile]),
    /invalid model call protocol/,
  );

  const malformedEnvelope = scenario(root, 'malformed-envelope', 'model');
  const envelopeEvents = journal(malformedEnvelope.actJournal);
  envelopeEvents[0].sequence = 2;
  writeJournal(malformedEnvelope.actJournal, envelopeEvents);
  refreshEvidenceChain(malformedEnvelope);
  assert.throws(
    () => buildOwnedWorldEvaluationPortfolio([malformedEnvelope.reassessmentFile]),
    /invalid envelope/,
  );

  const usageMismatch = scenario(root, 'usage-mismatch', 'model');
  const reassessment = read(usageMismatch.reassessmentFile);
  reassessment.assessment.usage.promptTokens += 1;
  write(usageMismatch.reassessmentFile, reassessment);
  assert.throws(
    () => buildOwnedWorldEvaluationPortfolio([usageMismatch.reassessmentFile]),
    /journal usage disagrees with canonical reassessment/,
  );
});

function scenario(root: string, runId: string, kind: 'model' | 'project') {
  const directory = path.join(root, runId);
  fs.mkdirSync(directory, { recursive: true });
  const loomFile = path.join(directory, 'entity.lync');
  const actJournal = path.join(directory, 'act.jsonl');
  const resumeJournal = path.join(directory, 'resume.jsonl');
  const sourceFile = path.join(directory, 'source.json');
  const reassessmentFile = path.join(directory, 'reassessment.json');
  fs.writeFileSync(loomFile, '{"protocol":"lync.test.v1"}\n');

  const actCall = modelCall(`${runId}-act`);
  const resumeCall = modelCall(`${runId}-resume`);
  writeJournal(actJournal, phaseEvents(actCall, 'inspect_volume'));
  writeJournal(resumeJournal, phaseEvents(resumeCall, 'wait_for_event'));

  const calls = [actCall, resumeCall];
  const sourceProtocol =
    kind === 'model' ? 'behold.owned-world-model-proof.v1' : 'behold.owned-world-project-proof.v1';
  const reassessmentProtocol =
    kind === 'model'
      ? 'behold.owned-world-model-reassessment.v1'
      : 'behold.owned-world-project-reassessment.v1';
  const source = {
    protocol: sourceProtocol,
    status: 'failed',
    runId,
    worldId: 'test-world',
    entityId: `${runId}-resident`,
    model: 'test/model',
    repository: { path: root, revision: 'source-revision' },
    evidence: {
      loomFile,
      loomSha256: sha256File(loomFile),
      act: {
        managedRunId: 'test-world-1',
        journalFile: actJournal,
        journalSha256: sha256File(actJournal),
      },
      resume: {
        managedRunId: 'test-world-2',
        journalFile: resumeJournal,
        journalSha256: sha256File(resumeJournal),
      },
    },
  };
  write(sourceFile, source);
  write(reassessmentFile, {
    protocol: reassessmentProtocol,
    status: 'passed',
    verifierRevision: 'verifier-revision',
    source: {
      file: sourceFile,
      sha256: sha256File(sourceFile),
      protocol: sourceProtocol,
      status: 'failed',
    },
    failedIntegrity: [],
    integrity: { actJournal: true, resumeJournal: true, loom: true },
    assessment: {
      failed: [],
      assertions: { productionModelRan: true, independentlyWitnessed: true },
      usage: summarizeUsage(calls),
    },
  });
  return { reassessmentFile, sourceFile, actJournal, resumeJournal, loomFile };
}

function modelCall(id: string) {
  return {
    protocol: 'behold.model-call.v1',
    requestId: `${id}-request`,
    latencyMs: 7,
    request: { model: 'test/model', body: requestBody('test/model') },
    response: {
      id: `${id}-response`,
      usage: {
        prompt_tokens: 10,
        completion_tokens: 2,
        total_tokens: 12,
        cost: 0.0001,
      },
    },
  };
}

function requestBody(model: string) {
  return {
    model,
    messages: [
      { role: 'system', content: 'remain embodied' },
      { role: 'user', content: 'World observation:\n{}\nPrevious action: none' },
      { role: 'assistant', content: 'I observed it' },
      { role: 'tool', tool_call_id: 'prior', content: '{"ok":true}' },
      {
        role: 'user',
        content: 'New world experience:\n{"sequence":2}\nPrevious action: inspect_volume',
      },
    ],
    tools: [{ type: 'function', function: { name: 'inspect_volume' } }],
    tool_choice: 'auto',
  };
}

function phaseEvents(call: any, actionName: string) {
  return [
    envelope(1, 'model_turn', { call }),
    envelope(2, 'entity_turn', {
      action: { name: actionName, source: 'llm' },
      outcome: { ok: true, result: { ok: true } },
    }),
  ];
}

function envelope(sequence: number, type: string, data: any) {
  return { sequence, at: new Date(sequence).toISOString(), agent: 'resident', type, data };
}

function refreshEvidenceChain(fixture: ReturnType<typeof scenario>) {
  const source = read(fixture.sourceFile);
  source.evidence.act.journalSha256 = sha256File(fixture.actJournal);
  source.evidence.resume.journalSha256 = sha256File(fixture.resumeJournal);
  write(fixture.sourceFile, source);
  const reassessment = read(fixture.reassessmentFile);
  reassessment.source.sha256 = sha256File(fixture.sourceFile);
  write(fixture.reassessmentFile, reassessment);
}

function temporaryRoot(t: any) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-portfolio-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function writeJournal(file: string, events: any[]) {
  fs.writeFileSync(file, `${events.map((event) => JSON.stringify(event)).join('\n')}\n`);
}

function journal(file: string) {
  return fs
    .readFileSync(file, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
}

function write(file: string, value: any) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function read(file: string) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
