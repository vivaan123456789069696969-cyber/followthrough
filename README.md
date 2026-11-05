# FollowThrough — Claude Code Build Kit

Built from `FollowThrough-App-Concept.pptx` plus the decisions you confirmed.

## How to use
1. Create an empty folder for the project and open it in Claude Code.
2. Copy this kit's contents into the folder root (keep `.claude/` and `docs/`).
3. Start Claude Code and paste the one-line starter below.

**Starter message to paste:**
> Read CLAUDE.md and 00-MASTER-PROMPT.md fully. Then read docs/OPEN-QUESTIONS.md and ask me every open question before writing any code. Do not assume anything that is not written down. After I answer, show me the Phase 0 plan and wait for my approval.

## What is inside
| File | Purpose |
|---|---|
| `00-MASTER-PROMPT.md` | Full product brief, scope, requirements, phases, acceptance tests |
| `CLAUDE.md` | Permanent project rules Claude Code reads every session |
| `docs/OPEN-QUESTIONS.md` | Things not yet decided; Claude Code must ask you |
| `docs/DATA-MODEL.md` | Team-ready Supabase schema and RLS rules |
| `docs/BUILD-PLAN.md` | Phased plan with a checklist and acceptance tests per phase |
| `.claude/skills/*` | 6 reusable skills (extraction, DB/RLS, Google, reminders, design, Wispr import) |
| `.claude/agents/*` | 4 subagents (architect, UI builder, QA, security reviewer) |

## Confirmed decisions (from you)
Responsive web app · Next.js + Supabase · Anthropic Claude API for extraction · single-user now with team-ready data model · Wispr Flow via paste/file import plus an adapter slot · Google Calendar read meetings + write task deadlines · Google Tasks as the external task app · Resend for email reminders · Google + email sign-in · deck is inspiration, improve it.
