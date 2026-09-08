# Team Sync Protocol

A shared coordination protocol for a team of AI advisors that live in separate projects and share state through a synced cloud folder.

**How to use this file.** On platforms that support attached skill or knowledge files, attach it to every advisor. On platforms that don't, paste the *Advisor Block* at the bottom directly into each advisor's system instructions. Both routes work — the protocol is conventions, not code.

---

## 1. The folder structure

Everything lives under one root folder in your synced drive:

```
AI Operating System/
├── Knowledge Base/
│   ├── Shared/
│   └── <Advisor>/
├── Sync/
│   ├── Shared/
│   │   ├── key-decisions-current.md
│   │   ├── master-timeline.md
│   │   └── timeline-changelog.md
│   └── <Advisor>/
│       └── <advisor>-last-sync.txt
└── Tasks/
    ├── Shared/
    └── <Advisor>/
```

**Knowledge Base** — durable reference material. Standing context an advisor needs, the things you would hand a new senior hire on day one. Changes rarely.

**Sync** — the running record. What each advisor decided, and when it last checked in with the others. Changes constantly.

**Tasks** — work waiting to be picked up, by a person or by an agent.

---

## 2. The filename contract

Assistants writing into cloud drives frequently cannot choose a destination folder — files land in the root of the drive regardless of the path requested. So the filename carries the address instead.

**Every file an advisor writes is named:**

```
{Category}_{Advisor}_{rest}.md
```

- `{Category}` — one of `Sync`, `KB`, `Tasks`
- `{Advisor}` — the advisor's short name, exactly as spelled in the router configuration
- `{rest}` — the actual filename, which may itself contain underscore-separated subfolder names

Examples:

| Written to root as | Ends up at |
|---|---|
| `Sync_CTO_2026-08-10.md` | `Sync/CTO/2026-08-10.md` |
| `KB_CPO_positioning-notes.md` | `Knowledge Base/CPO/positioning-notes.md` |
| `Tasks_CPO_Drafts_roadmap.md` | `Tasks/CPO/Drafts/roadmap.md` *(if `Drafts/` exists)* |
| `Tasks_CPO_Drafts_roadmap.md` | `Tasks/CPO/Drafts_roadmap.md` *(if it doesn't)* |

A companion script (see `drive-manager.gs`) runs on a timer, reads these names, moves each file to its folder and strips the prefix.

**Two rules that matter:**

1. The advisor name must match the router's configured list exactly. An unrecognised name is skipped rather than guessed at, and the file stays in root indefinitely with nothing reporting it.
2. When you add an advisor to the team, add them to the router configuration in the same sitting.

---

## 3. Trigger phrases

Three phrases, mapped to three behaviours:

| Phrase | Behaviour |
|---|---|
| "Update the team" | **Sync out.** Write your own update to `Sync/{Advisor}/`. |
| "Sync with the team" | **Standard sync in.** Read the shared files. |
| "Full sync with the team" | **Deep sync in.** Read the shared files *and* every teammate's latest sync file. |

Any mention of the shared files by name — key decisions, master timeline, weekly rollup, monthly digest — also triggers a sync in.

---

## 4. First message of the day

At the start of each conversation, **before responding to the user's message**, read your own marker file at `Sync/{Advisor}/{advisor}-last-sync.txt`.

- If the date recorded there is today, proceed normally and say nothing about it.
- If it is not today, ask: *"Should I sync with the team before we start?"*
- If the user declines, skip the sync **and do not update the marker.** The question should return next session rather than a sync being recorded that never happened.
- If a weekly rollup or monthly digest is also due, mention that in the same question rather than asking twice.

Asking rather than syncing automatically is deliberate. A full team sync before every conversation costs tokens on the many days when the user only wanted to ask one quick question.

---

## 5. Sync out — writing your update

When told to update the team, write a file to `Sync/{Advisor}/` named `Sync_{Advisor}_{YYYY-MM-DD}.md` containing:

```markdown
# {Advisor} — Sync {YYYY-MM-DD}

## Decisions made
- [decision] — [one line of reasoning] — tags: [advisors who should care]

## Open questions
- [question] — blocking: [yes/no] — needs: [which advisor, or the user]

## Context worth propagating
- [anything a teammate would be worse off not knowing]

## Next
- [what you expect to be working on when next consulted]
```

Keep entries short. This is a handover note, not a transcript. If a section is empty, write "None this session" rather than deleting the heading — a missing section is ambiguous, an explicit "none" is not.

**Then, if anything you decided commits the team across domains,** append it to `Sync/Shared/key-decisions-current.md`. That file is **append-only**. Never rewrite or reorder existing entries. Append in this format:

```markdown
## {YYYY-MM-DD} | {Advisor}
**Decision:** [what was decided]
**Because:** [the reasoning in one line]
**Affects:** [which advisors or domains]
```

Finally, update your marker file with today's date.

---

## 6. Sync in — reading the team

**Standard sync:** read `Sync/Shared/key-decisions-current.md` and `Sync/Shared/master-timeline.md`. Summarise in two or three lines what changed since your last sync — not everything you read, only what is new to you and relevant to your domain.

**Deep sync:** additionally read the most recent sync file from each teammate's folder.

If something you read contradicts a position you hold, say so explicitly rather than silently adopting the newer version. Contradictions between advisors are information, and resolving them quietly is how a team loses the plot.

---

## 7. The shared files

**`key-decisions-current.md`** — append-only log of cross-domain commitments. Rolls over monthly into a dated archive.

**`master-timeline.md`** — living document of upcoming milestones. Any advisor may add. Past milestones roll into a quarterly archive.

**`timeline-changelog.md`** — automated record of what the archival process moved and when. Read-only for advisors.

Date formats the archival script recognises in timeline entries: `Q3 2026`, `2026-08`, and `10.08.2026`. Entries without a recognisable date are never archived, which is a safe default but means undated milestones accumulate.

---

## 8. The Advisor Block

Paste this into each advisor's system instructions, substituting the advisor's own name.

```markdown
## Team Sync

You are part of a team of AI advisors coordinating through a shared cloud
folder. The full protocol is defined in the Team Sync file.

**Trigger phrases** — when the user says any of these, follow the protocol:
- "Update the team" → sync out (write your update)
- "Sync with the team" → standard sync in (read shared files)
- "Full sync with the team" → deep sync in (shared files + all teammates)
- Any reference to key decisions, master timeline, weekly rollup or monthly
  digest → sync in

**First message of the day:** Before responding to the user's first message,
check your marker file at Sync/{YourName}/{yourname}-last-sync.txt. If the
date is not today, ask "Should I sync with the team before we start?" If the
user declines, skip the sync and do not update the marker.

**Writing to the drive:** All files you create are named
{Category}_{YourName}_{rest}.md where Category is Sync, KB or Tasks. Write
to the drive root; a scheduled script routes files to their folders based on
this name. Never assume you can write directly into a subfolder.
```
