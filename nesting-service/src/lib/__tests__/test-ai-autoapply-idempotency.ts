import assert from 'node:assert/strict';
import type {
  ProjectAnalysisClaim,
  ProjectAnalysisCoordinationDependencies,
} from '../ai/analysis-coordinator';
import { AI_RECALC_REQUIRED_MESSAGE } from '../ai/apply-control';

async function main(): Promise<void> {
  process.env.DATABASE_URL ??= 'postgresql://user:pass@localhost:5432/test?schema=nesting';
  const { coordinateProjectAnalysis } = await import('../ai/analysis-coordinator');
  const {
    appendProjectRecalculationViolation,
    projectRecalculationUpdateForStatus,
  } = await import('../ai/project-recalculation');
  const { resolveCompletedProjectStatus } = await import('../project-status');

  const calculatingUpdate = projectRecalculationUpdateForStatus('calculating');
  assert.equal('status' in calculatingUpdate, false, 'an active calculation must not be reset to parsed');
  assert.equal(calculatingUpdate.aiRecalcRequired, true);
  assert.equal(calculatingUpdate.errorMessage, AI_RECALC_REQUIRED_MESSAGE);

  const parsedUpdate = projectRecalculationUpdateForStatus('done');
  assert.equal(parsedUpdate.status, 'parsed', 'a completed project with a real AI change must require recalculation');
  assert.equal(parsedUpdate.aiRecalcRequired, true);

  const report = appendProjectRecalculationViolation(
    { valid: true, violations: [], checkedAt: 'test' },
    true
  );
  assert.equal(report.valid, true, 'recalculation warning must preserve valid semantics');
  assert.equal(report.violations[0].type, 'AI_RECALC_REQUIRED');
  assert.equal(report.violations[0].severity, 'warning');
  assert.equal(report.violations[0].message, AI_RECALC_REQUIRED_MESSAGE);
  assert.equal(
    resolveCompletedProjectStatus(report, false),
    'completed_with_warnings',
    'the completed calculation must visibly retain the recalculation warning'
  );

  let activeClaim: ProjectAnalysisClaim | null = null;
  let providerCalls = 0;
  let releaseLeader!: () => void;
  let resolveSharedResult!: (value: string) => void;
  const leaderGate = new Promise<void>((resolve) => {
    releaseLeader = resolve;
  });
  const sharedResult = new Promise<string>((resolve) => {
    resolveSharedResult = resolve;
  });

  const createDependencies = (): ProjectAnalysisCoordinationDependencies<string> => ({
    claim: async () => {
      if (activeClaim) return { ...activeClaim, acquired: false };
      activeClaim = {
        acquired: true,
        runId: 'analysis-1',
        startedAt: new Date('2026-07-22T12:50:43.000Z'),
      };
      return activeClaim;
    },
    release: async () => {
      activeClaim = null;
    },
    waitForResult: async () => sharedResult,
  });

  const runProvider = async (): Promise<string> => {
    providerCalls += 1;
    await leaderGate;
    resolveSharedResult('shared-analysis-result');
    return 'shared-analysis-result';
  };

  const firstAnalyze = coordinateProjectAnalysis(runProvider, createDependencies());
  await Promise.resolve();
  const parallelAnalyze = coordinateProjectAnalysis(runProvider, createDependencies());
  releaseLeader();

  const [first, parallel] = await Promise.all([firstAnalyze, parallelAnalyze]);
  assert.equal(providerCalls, 1, 'parallel /analyze must not start a second provider request');
  assert.equal(first.alreadyInProgress, false);
  assert.equal(parallel.alreadyInProgress, true);
  assert.equal(parallel.result, first.result);

  console.log('[ai-autoapply-idempotency] value-aware recalculation and concurrent analysis dedup passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
