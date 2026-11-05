---
name: followthrough-design-system
description: Use when building any UI for FollowThrough — tokens, layout, components, copy tone, and the improvements over the concept deck.
---
# FollowThrough Design System

## Tokens extracted from the deck (starting point)
| Token | Hex | Use |
|---|---|---|
| ink | #172B2A | primary text |
| ink-muted | #62716E | secondary text |
| brand | #176B58 | primary buttons, links, active nav |
| brand-deep | #102321 | dark surfaces, hero |
| brand-deep-2 | #1A3933 / #285348 | dark cards |
| sage-50 | #EEF0EC | app background |
| sage-100 | #DCEBE4 | tinted panels |
| line | #D9E0DA | borders |
| surface | #FFFFFF | cards |
| lime (accent) | #D6F278 | highlight, “today”, key CTA on dark |
| warm (accent) | #F7E6D9 / #9A542C | overdue / attention |
| lilac (accent) | #E9E7FA | “waiting on others” |
Font in deck: Aptos (not a web font). Use **Inter** or **Geist** (self-hosted via next/font) and say so to the user.

## Improve the deck (do these)
- Verify contrast: #62716E on sage/white must be ≥ 4.5:1; darken if not. Lime text never on white.
- Add dark mode via CSS variables.
- Define full state set for every component: default, hover, focus-visible, active, disabled, loading, error, empty.
- Mobile-first layout: left nav → bottom tab bar (My day, My tasks, Meetings, Settings).
- Larger tap targets (≥44px), type scale min 14px body (deck uses 9–12pt for a slide, not for product).
- Status is never color-only: pair with icon + text (Overdue, Due today, Waiting).
- Real empty states with one clear action; skeleton loaders; toasts with undo for confirm/dismiss.

## Layout & components
App shell (nav + content), Greeting header, StatTile (Due soon / Overdue / Waiting on others), NextActionList item, SourceCard card (Wispr / Calendar / Task destination), SuggestionCard (quote block with source label), TaskDetailsForm, NotesViewer with highlight, Drawer, Dialog, Toast, Badge, EmptyState, ReminderPreview, SyncBadge. Build with Tailwind + accessible primitives (Radix UI or Headless UI).

## Copy tone
Calm, plain, short, second person. Examples from deck: "Good morning, Maya", "Your focus today", "3 actions need you", "Confirm task", "Edit details", "Choose later". No exclamation marks.

## Motion
Subtle (150–200ms); respect `prefers-reduced-motion`.

## Process
Before building a screen: list states, check against tokens, build mobile first, run axe + keyboard pass. Ask the user for approval of the first dashboard + review screen before building the rest.
