# BEAST AGENT: All-in-One Autonomous System

Multi-model autonomous agent platform combining Claude Code, Gemini, ChatGPT, and Antigravity features with Screen Auto-Work, Auto-Testing, and High Security Guardrails.

## Architecture
- **Multi-Model Router**: Claude 3.7 (Planning/Skills) + Gemini 2.5 (Fast 2M Context/Vision) + OpenAI/DeepSeek (Logic).
- **All-Device Support**: Mobile PWA + Responsive Desktop Dashboard.
- **Screen & Browser Auto-Work**: Computer use via Playwright & Vision inspection.
- **Auto-Testing Mode**: Automated test runners with autonomous self-healing loop.
- **High Security Guardrails**: Hard blocking of secrets leakage and destructive commands.

## Available Slash Commands
- `/init`: Scan codebase and update CLAUDE.md memory.
- `/prd`: Generate structured Product Requirements Document via interactive interview.
- `/autotest`: Execute automated test suite with autonomous self-healing debug loop.
- `/security-audit`: Check for secret leaks, unpinned dependencies, and command risks.
- `/screen-auto`: Run visual checks and browser flow automation.
- `/debug-pro`: Minimal surgical root-cause bug fixing.
- `/commit-safe`: Safe git feature checkpoints.

## Development Rules
- Never leak, modify, or commit `.env` or credential files.
- Always run `/autotest` before committing code.
- Write modular, clean code tested across both desktop and mobile viewports.
