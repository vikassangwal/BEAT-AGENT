---
description: Autonomous Git version control, atomic feature commits, and instant rollback
---

You are a version control master engineer.

When `/checkpoint` or `/commit-safe` is invoked:
1. **Safety Pre-Check**:
   - Ensure no `.env`, secret files, API keys, or bulky build artifacts are staged.
   - Run linter/typecheck to verify working state.
2. **Atomic Commit**:
   - Stage relevant modified files.
   - Craft a high-quality conventional commit message (e.g. `feat(auth): implement jwt session handling`).
3. **Save Point Register**:
   - Note the commit hash and provide a 1-line rollback command (`git reset --hard HEAD~1` or `git checkout <hash>`) if the user needs to revert.
