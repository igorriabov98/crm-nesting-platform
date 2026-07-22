import assert from 'node:assert/strict';
import {
  areLayoutViolationsValid,
  type LayoutViolation,
} from '../validation/layout-validator';
import { resolveCompletedProjectStatus } from '../project-status';

const info = violation('EXCLUDED_FROM_NESTING', 'info');
const warning = violation('AI_ANALYSIS_WARNING', 'warning');
const error = violation('AI_ANALYSIS_FAILED', 'error');
const implicitError = violation('overlap');

assert.equal(areLayoutViolationsValid([]), true, 'empty violations must be valid');
assert.equal(areLayoutViolationsValid([info]), true, 'info-only violations must be valid');
assert.equal(areLayoutViolationsValid([info, warning]), true, 'warnings must not invalidate a reliable layout');
assert.equal(areLayoutViolationsValid([error]), false, 'explicit errors must invalidate the layout');
assert.equal(areLayoutViolationsValid([implicitError]), false, 'missing severity must default to error');

const warningReport = { valid: areLayoutViolationsValid([warning]), violations: [warning], checkedAt: 'test' };
assert.equal(warningReport.valid, true, 'warning-only report must stay valid');
assert.equal(
  resolveCompletedProjectStatus(warningReport, false),
  'completed_with_warnings',
  'warning-only report must keep the warning project status'
);
assert.equal(
  resolveCompletedProjectStatus({ violations: [info] }, false),
  'done',
  'info-only report may complete without warnings'
);
assert.equal(
  resolveCompletedProjectStatus({ violations: [implicitError] }, false),
  'completed_with_warnings',
  'implicit geometry errors must keep the warning project status'
);
assert.equal(
  resolveCompletedProjectStatus({ violations: [] }, true),
  'completed_with_warnings',
  'unplaced parts must keep the warning project status'
);

console.log('[validation-semantics] severity matrix and completed project status passed');

function violation(
  type: LayoutViolation['type'],
  severity?: LayoutViolation['severity']
): LayoutViolation {
  return {
    type,
    severity,
    partIds: [],
    message: type,
  };
}
