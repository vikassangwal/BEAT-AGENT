/**
 * BEAST AGENT: High Security Guardrail Engine
 * Enforces unbreakable rules: secret protection, dangerous command blocking, and sandboxed execution.
 */

const BLOCKED_COMMANDS = [
  /rm\s+-rf\s+[\/\\]/i,
  /rmdir\s+\/s\s+\/q\s+[c-z]:\\/i,
  /format\s+[a-z]:/i,
  /drop\s+database/i,
  /drop\s+table/i,
  /truncate\s+table/i,
  />\s*\/dev\/sd[a-z]/i,
  /:(){ :|:& };:/i,
  /del\s+\/f\s+\/s\s+\/q\s+C:\\Windows/i
];

const PROTECTED_FILES = [
  /\.env(\..+)?$/i,
  /id_rsa/i,
  /\.pem$/i,
  /credentials\.json/i,
  /service-account.*\.json/i,
  /\.git[\/\\]config/i
];

export class SecurityGuard {
  /**
   * Validate a shell command before execution
   */
  static validateCommand(command) {
    if (!command || typeof command !== 'string') {
      return { allowed: false, reason: "Command must be a non-empty string" };
    }

    const trimmed = command.trim();

    for (const pattern of BLOCKED_COMMANDS) {
      if (pattern.test(trimmed)) {
        return {
          allowed: false,
          reason: `SECURITY ALERT: Command blocked by guardrail rule (${pattern})`,
          critical: true
        };
      }
    }

    return { allowed: true };
  }

  /**
   * Validate file access (read/write/delete)
   */
  static validateFileAccess(filePath, action = 'write') {
    if (!filePath || typeof filePath !== 'string') {
      return { allowed: false, reason: "Invalid file path" };
    }

    for (const pattern of PROTECTED_FILES) {
      if (pattern.test(filePath)) {
        return {
          allowed: false,
          reason: `SECURITY ALERT: Access to sensitive file '${filePath}' is strictly blocked for action: ${action}`,
          critical: true
        };
      }
    }

    return { allowed: true };
  }

  /**
   * Audit and sanitize text before printing or logging
   */
  static sanitizeOutput(text) {
    if (typeof text !== 'string') return text;
    // Mask potential API keys (Anthropic, Google, OpenAI)
    return text
      .replace(/sk-ant-[a-zA-Z0-9_-]{20,}/g, 'sk-ant-***[PROTECTED]***')
      .replace(/AIzaSy[a-zA-Z0-9_-]{33}/g, 'AIzaSy***[PROTECTED]***')
      .replace(/sk-[a-zA-Z0-9_-]{20,}/g, 'sk-***[PROTECTED]***');
  }
}
