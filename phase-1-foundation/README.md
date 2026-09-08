# Phase 1 · Foundation — brain team & shared memory

<img src="../assets/diagrams/phase-1-foundation.svg" alt="Phase 1 active components: you, the brain team, and shared memory" width="560">

The foundation layer is the least impressive phase to demo and the only one everything else depends on. Nothing runs on a schedule here and no agent works while you sleep. What you get instead is a group of advisors that stay in context, and a folder they all read and write — and it turns out the folder is the part that matters.

The advisors each live in their own project, on whichever platform suits them. What connects them is not an API, a database, or a middleware layer. It is a folder in Google Drive holding plain markdown files, plus a naming convention that does the routing.

**Done when** you have created the advisory members and the team sync protocol genuinely works — a decision reached with one advisor is visible to the next one without you pasting anything across.

## Attachments

These are the files the post refers to. They are structural templates, not a finished team — build your own advisors on top of them.

| File | What it is |
| --- | --- |
| [`sample-advisor-system-prompt.md`](sample-advisor-system-prompt.md) | A structural template for one advisor, with the team-sync block included. |
| [`sample-prompt-architect.md`](sample-prompt-architect.md) | The advisor whose whole job is designing your other advisors and keeping their registry. |
| [`team-sync-protocol.md`](team-sync-protocol.md) | The sync conventions as a standalone file, ready to attach or paste into instructions. |
| [`drive-manager.gs`](drive-manager.gs) | The full Google Apps Script: filename routing, deduplication, notifications, and monthly and quarterly archival. |

**Referenced along the way:** Google Drive for Desktop · Google Apps Script · Claude Projects · Gemini Gems
