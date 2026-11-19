/**
 * BEAST AGENT: Self-Test Runner
 */

import { SecurityGuard } from '../src/security.js';
import { ModelRouter } from '../src/router.js';
import { ScreenAutoEngine } from '../src/screen.js';

let passed = 0;
let total = 0;

function assert(condition, testName) {
  total++;
  if (condition) {
    console.log(`✅ PASS: ${testName}`);
    passed++;
  } else {
    console.error(`❌ FAIL: ${testName}`);
  }
}

console.log('=== RUNNING BEAST AGENT AUTO-TESTS ===\n');

// 1. Security Tests
const badCmd = SecurityGuard.validateCommand('rm -rf /');
assert(!badCmd.allowed, 'Security Blocks "rm -rf /"');

const envFile = SecurityGuard.validateFileAccess('.env', 'write');
assert(!envFile.allowed, 'Security Blocks access to .env file');

const safeCmd = SecurityGuard.validateCommand('git status');
assert(safeCmd.allowed, 'Security Allows safe command "git status"');

// 2. Multi-Model Router Tests
const router = new ModelRouter();
const visionRoute = router.selectModel('vision');
assert(visionRoute.provider === 'gemini', 'Routes vision to Gemini');

const planRoute = router.selectModel('plan');
assert(planRoute.provider === 'claude', 'Routes plan to Claude');

// 3. Screen Auto-Work Tests
const screen = new ScreenAutoEngine();
const plan = screen.planAction('click submit button');
assert(plan.steps.length === 4, 'Screen Auto-Work generates 4-step action plan');

const validClick = screen.dispatchClick(100, 200);
assert(validClick.success, 'Valid screen coordinate click succeeds');

const invalidClick = screen.dispatchClick(-50, 9999);
assert(!invalidClick.success, 'Out of bounds screen click blocked safely');

console.log(`\n========================================`);
console.log(`RESULTS: ${passed}/${total} TESTS PASSED CLEANLY`);
console.log(`========================================\n`);

if (passed !== total) {
  process.exit(1);
}
