/**
 * BEAST AGENT: Multi-Model AI Router
 * Dynamically routes queries between Claude, Gemini, and OpenAI based on speed, context size, and task complexity.
 */

export class ModelRouter {
  constructor(config = {}) {
    this.defaultModel = config.defaultModel || 'claude-3-7-sonnet';
    this.fallbackModel = config.fallbackModel || 'gemini-2.5-flash';
  }

  /**
   * Determine optimal model for task
   */
  selectModel(taskType, contextLength = 0) {
    // Large context (>100k tokens) or image vision tasks -> Gemini
    if (contextLength > 100000 || taskType === 'vision') {
      return {
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        reason: 'Large context / vision optimized with 2M token capacity'
      };
    }

    // Architecture, PRD, and deep coding -> Claude
    if (['plan', 'prd', 'refactor', 'architecture'].includes(taskType)) {
      return {
        provider: 'claude',
        model: 'claude-3-7-sonnet',
        reason: 'Superior architectural planning and skill execution'
      };
    }

    // Deep mathematical or algorithmic reasoning -> OpenAI o3/GPT-4o
    if (['math', 'complex-logic'].includes(taskType)) {
      return {
        provider: 'openai',
        model: 'o3-mini',
        reason: 'Deep step-by-step reasoning capability'
      };
    }

    // Default fast coding & commands -> Claude
    return {
      provider: 'claude',
      model: this.defaultModel,
      reason: 'General primary beast agent brain'
    };
  }

  /**
   * Format prompt with Beast Agent system instructions
   */
  wrapPrompt(userPrompt, options = {}) {
    const role = options.role || 'Full-Stack Autonomous Beast Engineer';
    return `[SYSTEM INSTRUCTION: You are the BEAST AGENT (${role}). Execute with maximum precision, enforce strict security, and output verified code without unnecessary placeholders.]\n\n${userPrompt}`;
  }
}
