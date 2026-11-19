/**
 * BEAST AGENT: Auto-Testing & Self-Healing Engine
 * Automatically executes test suites and iterates up to 3 cycles to repair failures.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { SecurityGuard } from './security.js';

const execAsync = promisify(exec);

export class AutoTester {
  constructor(options = {}) {
    this.maxRetries = options.maxRetries || 3;
    this.testCommand = options.testCommand || 'npm test';
  }

  /**
   * Run the test suite safely through security guard
   */
  async runSuite() {
    const check = SecurityGuard.validateCommand(this.testCommand);
    if (!check.allowed) {
      return { success: false, error: check.reason };
    }

    try {
      const { stdout, stderr } = await execAsync(this.testCommand, { timeout: 30000 });
      return {
        success: true,
        output: stdout,
        diagnostics: null
      };
    } catch (err) {
      return {
        success: false,
        output: err.stdout || '',
        error: err.stderr || err.message,
        exitCode: err.code
      };
    }
  }

  /**
   * Self-Healing Loop: Run, Diagnose, Fix, Re-run
   */
  async selfHeal(fixCallback) {
    let attempt = 0;
    const history = [];

    while (attempt < this.maxRetries) {
      attempt++;
      console.log(`[AutoTester] Executing test cycle ${attempt}/${this.maxRetries}...`);
      
      const result = await this.runSuite();
      history.push({ attempt, ...result });

      if (result.success) {
        return {
          status: 'PASSED',
          attempts: attempt,
          message: `All tests passed cleanly on cycle ${attempt}.`,
          history
        };
      }

      console.warn(`[AutoTester] Cycle ${attempt} failed. Triggering root-cause diagnosis...`);
      
      if (typeof fixCallback === 'function' && attempt < this.maxRetries) {
        const fixApplied = await fixCallback(result);
        if (!fixApplied) {
          console.warn(`[AutoTester] Self-repair could not apply a fix. Aborting early.`);
          break;
        }
      }
    }

    return {
      status: 'FAILED',
      attempts: attempt,
      message: `Tests failed after ${attempt} cycles. Manual inspection recommended.`,
      history
    };
  }
}
