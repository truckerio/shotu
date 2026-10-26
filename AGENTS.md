# Engineering workflow

Load and apply `/Users/karanpreetsingh/.codex/skills/engineering-orchestrator/SKILL.md` at the start of every turn. Preserve the user's requested mode and authority boundaries.

## Regression tests for every issue fixed

- Every bug fix must add or extend an automated regression test that reproduces the reported failure and checks the intended behavior.
- Demonstrate that the regression test fails against the unfixed behavior and passes with the fix. Record the commands and results; disclose any inability to verify the failing baseline.
- Test observable behavior at the appropriate boundary: domain/unit, API, database, or browser. For UI interaction bugs, cover the affected user interaction rather than relying only on source-text assertions.
- Include the regression test in the normal automated test command or CI suite so future runs check it automatically. Report the command that runs it.
- Run the new regression test and relevant existing checks before declaring the issue fixed. Do not weaken existing assertions or mock away the failure.
- If automation is blocked, report the exact blocker and leave regression coverage incomplete; manual verification alone does not satisfy this rule.

This requirement applies to each future fix, including the G2026 missing pricing totals issue when implementation is authorized. It does not authorize fixes, commits, pushes, or deployments by itself.
