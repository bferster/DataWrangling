# EnslaverReview (schedule2census) — User Manual

## Table of Contents
1. [Overview & Core Concepts](#1-overview--core-concepts)
2. [Getting Started & Setup](#2-getting-started--setup)
3. [Interface Tour](#3-interface-tour)
   - [Header Bar & Navigation](#header-bar--navigation)
   - [Left Rail: Enslaver Queue](#left-rail-enslaver-queue)
   - [Center Panel: Subject Information](#center-panel-subject-information)
   - [Center Panel: Match Candidates (Top Pane)](#center-panel-match-candidates-top-pane)
   - [Draggable Split Resizer](#draggable-split-resizer)
   - [Center Panel: Full Census Browser (Bottom Pane)](#center-panel-full-census-browser-bottom-pane)
   - [Right Rail: Evidence Inspector](#right-rail-evidence-inspector)
   - [Bottom Toolbar: Decisions](#bottom-toolbar-decisions)
4. [Step-by-Step Review Workflows](#4-step-by-step-review-workflows)
   - [Workflow A: Confirming a Candidate](#workflow-a-confirming-a-candidate)
   - [Workflow B: Verifying & Auditing EPS Anchors](#workflow-b-verifying--auditing-eps-anchors)
   - [Workflow C: Manual Search & Arbitrary Record Linkage](#workflow-c-manual-search--arbitrary-record-linkage)
   - [Workflow D: Handling Clashes & Conflicting Claims](#workflow-d-handling-clashes--conflicting-claims)
   - [Workflow E: Marking as Absent](#workflow-e-marking-as-absent)
5. [Search Navigation Reference](#5-search-navigation-reference)
6. [Exports & Session Management](#6-exports--session-management)
7. [Troubleshooting & Best Practices](#7-troubleshooting--best-practices)

---

## 1. Overview & Core Concepts

**EnslaverReview** (`schedule2census`) links enslavers recorded on the **1850 and 1860 US Federal Slave Schedules** to their corresponding person records in the **US Federal Population Census**.

### The Challenge of Linking Slave Schedules
An enslaver mention on a slave schedule is an extremely sparse record:
- It typically contains **only a surname and a given name** (or initials).
- Age, race, birthplace, occupation, and household relationships were not collected for enslavers on the slave schedule — the ingest discards them for owner rows.
- In traditional Fellegi-Sunter probabilistic record linkage, missing fields contribute zero evidence bits. For a typical county the attribute evidence ceiling is around **17.5 bits**, while confident linkage ($p \ge 0.9$) needs about **18.8 bits**. The Set up tab's diagnostics report computes the real numbers for whatever county and year you loaded.

### The Hybrid Solution
EnslaverReview bridges this evidence gap through three complementary mechanisms:
1. **Positional Alignment (Walk Order)**: Both the slave schedule and the population census were recorded sequentially by enumerators walking door-to-door. Enumeration dates correlate monotonically with line numbers on both sides. The app treats matching as an order-preserving partial sequence alignment (`SequenceAligner`) rather than scoring each enslaver in isolation.
2. **IPUMS EPS Holding Anchors**: Enslaved Population Schedule (EPS) holding compositions (counts, ages, and genders of enslaved individuals) are aligned to local holdings on composition alone — no names, since EPS has none (`HoldingAligner`). This also catches holdings the local ingest split in two. Holdings that resolve to a census person via IPUMS's own HISTID become fixed **anchors** that narrow the positional uncertainty window ($\sigma$) for neighboring enslavers.
3. **Human Review**: Machine-generated candidates are shown ranked and in their place in the census sequence — not in a separate list — so a reviewer can see at a glance whether the top-scoring name sits far out of position while a weaker one sits neatly between two confirmed anchors. Confirmations become anchors themselves, shrinking the window for everyone still undecided.

> [!TIP]
> **Recommended Workflow Strategy**: Always work **1850 before 1860**.
> The 1850 census has recorded real estate property values and far fewer bare initials than 1860. Confirmed 1850 matches are cross-checked automatically against 1860 candidates ("Confirmed in 1850" in the Evidence Inspector), which is often the deciding evidence when 1860 names alone cannot settle it.

---

## 2. Getting Started & Setup

### Requirements
The application runs as a lightweight, browser-based vanilla JavaScript application with no build step. It loads its data over HTTP, from two locations relative to `index.html`:

- `../COMMON/mentions.csv` — ingested mention records for both slave schedules and population census, across all counties.
- `../COMMON/match.js` and `../COMMON/fellegi.js` — the shared name-matching and Fellegi-Sunter scoring library.
- `./eps1850.csv` and `./eps1860.csv` — IPUMS Enslaved Population Schedule files for this project, one per year. These are optional: the tool still runs without them, using only name and position evidence, and the Set up screen reports which ones are missing.

### Launching the Application
Due to browser security constraints on local `file://` access, the app must be served over HTTP:

```bash
python3 -m http.server 8000
```
Then navigate to `http://localhost:8000/ENSLAVER/`. Opening `index.html` directly from the filesystem will not work — the setup pane explains why instead of sitting blank.

### What Happens on Load
The app does **not** wait for you to click anything. As soon as the page opens it:
1. Downloads and parses `mentions.csv`, then both EPS files (showing row/holding counts or "not in this folder" for each).
2. Picks the first county found in `mentions.csv` and year **1850**.
3. Runs diagnostics automatically and shows the report in the Set up pane.
4. Runs **Prepare** automatically — aligning EPS holdings, seeding anchors, and building the review blocks — and switches straight to the **Review** tab.

You only need the Set up tab afterward to change something:
- **County / Year**: Pick a different county or year from the dropdowns. Doing so refreshes the diagnostics report and re-enables **Run diagnostics** and **Prepare**; click **Prepare** to actually rebuild the review blocks for the new selection and jump back to Review. Your existing decisions are kept — the review store is never cleared by Prepare.
- **Reviewer**: Type your name or initials here, then click **Prepare** so it is recorded on every decision going forward. The very first automatic pass runs before you have had a chance to type anything, so if you plan to review, set your name and re-run Prepare before recording matches.
- **Run diagnostics**: Recomputes and reprints the report (evidence ceiling, monotonicity checks, name uniqueness, EPS join health) for the current county/year without rebuilding the review blocks.
- **Reload files**: Re-downloads `mentions.csv` and both EPS files and re-prepares — useful after editing the source CSVs. Decisions already recorded are preserved.
- **Earlier session**: Loads a previously exported `session-*.json` to merge its decisions in (see [Resuming Work](#resuming-work)).

---

## 3. Interface Tour

```
+----------------------------------------------------------------------------------------------------+
|  EnslaverReview   [Set up] [Review]  |  342 matched (58 via EPS) · 530 decided · 9% manual find  ⓘ  |
+-----------------------+------------------------------------------------------+---------------------+
| Enslavers (979) [All▾]| William Wise                                         | Why this candidate  |
|-----------------------| ENS-AUG-1850-412 · line 412 · Jul 9 · gender: M      | Surname ▓▓▓▓  +4.2  |
| 410 John Smith    EPS | enslaver 88 of 979                                   | Given   ▓▓▓░  +3.1  |
| 412 William Wise      | held 5 people: 32m 28f 12m 8f 2m                     | position▓▓░░  +2.4  |
| 415 Mary Jones   auto | EPS holding 77 → William H. Wise                     | total: 19.8 bits    |
| 418 David Bell   none |-------------------------------------------------------|----------------------|
| 422 Thos. Brown  clash| MATCH CANDIDATES     Double-click to match  [search] | Position             |
|                       | ( ) 410 John Smith        anchor · matched to ...    | expected rank: 413   |
|                       | (•) 414 William H. Wise   1 · 19.8 bits              | sigma: ±8            |
|                       | ( ) 418 William Wise      2 · 16.2 bits  outside     | this candidate: 414  |
|                       | ( ) Not in this census                               | anchors used: 2      |
|                       |============== [ Draggable Resizer ] ==================|----------------------|
|                       | RAW CENSUS (10,277)  [ ] Heads only [ ] Men only [search]| Margin over next  |
|                       | 413 Martha Wise   · birth: 1822 · F · W · head: no    | runner-up: 16.2      |
|                       | 414 William H. Wise · birth: 1818 · M · W · head: yes | gap: 3.6              |
+-----------------------+------------------------------------------------------+---------------------+
|                       | Clear this decision        Click to inspect · Double-click to match          |
+-----------------------+----------------------------------------------------------------------------+
```

---

### Header Bar & Navigation
- **Progress Track**: A thin green bar at the very top that fills as `matched/total decisions` climbs; it fades out at 100%.
- **Tab Switcher**: Toggle between **Set up** and **Review**.
- **Counter**: `N matched (M via EPS) · N decided · P% manual find`. Hover it for a tooltip explaining "manual find rate" — the share of human-confirmed matches the machine did not itself propose, a rough recall estimate for the candidate generator.
- **Accept clear matches**: Runs the sequence aligner across every block and auto-records its high-confidence, high-margin tail as machine decisions (flagged `auto` so they can be audited later). Enabled once Prepare has run.
- **Load session**: Opens a file picker for a `session-*.json` export; its decisions are merged into the current session.
- **Export assertions** / **Export session**: See [Exports & Session Management](#6-exports--session-management). Both stay disabled until Prepare has run.
- **Help icon (ⓘ)**: Opens the full documentation (this manual, hosted on Google Docs) in a new tab.

---

### Left Rail: Enslaver Queue
- **Title & count**: `Enslavers (979)`, or `(12 of 979)` when a filter is narrowing the list.
- **Status filter dropdown**, with a live count on each option:
  - **All** — everyone.
  - **Blank** — no decision recorded yet.
  - **EPS pending** — an EPS/HISTID linkage proposed a candidate but a human has not confirmed it.
  - **Auto** — accepted by **Accept clear matches** without individual review.
  - **Set** — confirmed by hand.
  - **Clash** — claimed by more than one enslaver (see [Workflow D](#workflow-d-handling-clashes--conflicting-claims)).
- **Enslaver rows**, in slave-schedule line order, each showing the line number, the name, and a status badge:
  - `EPS` (green) — confirmed via an IPUMS EPS/HISTID anchor.
  - `EPS?` (grey) — an unambiguous EPS proposal, not yet confirmed by a reviewer.
  - `EPS±` (amber) — an EPS proposal from a holding that was *merged* from more than one of ours; EPS names only the first holder, so this is deliberately not pre-selected and needs a manual look.
  - `set` — confirmed by a human reviewer.
  - `auto` — accepted via **Accept clear matches**.
  - `none` — marked "Not in this census".
  - `clash` (red) — this enslaver's match is claimed by another enslaver too.
- Clicking a row selects that enslaver and loads their candidates, holding, and evidence in the center and right panels.

---

### Center Panel: Subject Information
The strip above the candidate list shows the enslaver currently being reviewed:
- **Name**, with an **Estate / Deceased — Likely absent** badge when the schedule row looks like an estate, heirs, or administrator entry rather than a living person.
- **Agent**, when the schedule recorded a separate agent/administrator name for the holding.
- **Mention ID · line number · enumeration date · gender** (or *inferred gender* when the schedule didn't record one but the name implies it), and "enslaver *N* of *M*" for the current county/year.
- **Holding**: how many people were held, followed by their ages and genders (e.g. `32m 28f 12m 8f 2m`).
- **EPS status line**, one of:
  - *Matched via EPS* — to the confirmed census person, with the line number.
  - *EPS holding #N* → *proposed person* — not yet confirmed, or flagged with a "merged from N holdings" note if ambiguous.
  - *Suspect EPS Anchor* (amber) — IPUMS's own census join disagrees with the enslaver's surname; this anchor does **not** pin the sequence alignment until a human confirms it.

---

### Center Panel: Match Candidates (Top Pane)
Census individuals are shown **in their place inside the census sequence**, not as a detached top-N list, so an out-of-position top score and an in-position runner-up are visible at a glance.

- **Toolbar**: "MATCH CANDIDATES", the reminder *Double-click to match enslaver to census listing*, and a search box (see [Search Navigation Reference](#5-search-navigation-reference)) that searches this block's candidates first and falls back to the full census by name if nothing in the block matches.
- **Rows**, ordered: the current match (if any) first, then the machine-ranked candidates, then any other census records that fall inside the positional bracket, with the EPS proposal (if any) pinned near the top:
  - **Rank & score badge**: e.g. `1 · 21.4 bits`.
  - **Method badges**: `position only`, `name only`, `manual pick`, `census head`, `EPS`/`EPS proposal`, `Confirmed in 1850`, `gender clash`, `Suspect EPS Anchor`.
  - **Claimed by …** (red) if another enslaver already holds this same census person.
  - Candidates whose rank falls outside the current positional bracket are visually dimmed (`outside`); if the record isn't in this enumerator block at all, its block name is shown instead of a rank.
  - **Confirmed anchors** — other enslavers' already-matched census people that sit inside this window — render as quiet, unselectable rows tagged `anchor`. Clicking one jumps you straight to *that* enslaver's record (handy for auditing or fixing an earlier decision) rather than reassigning the current one.
- **"Not in this census"** is always the last row, for enslavers who were non-residents, deceased, an estate holding, or simply missed by the enumerator.
- **Click** a row to inspect it — it updates the Evidence Inspector and the highlight in the bottom census browser, but records nothing yet.
- **Double-click** a row (or "Not in this census") to commit the decision immediately, with a soft confirmation chime.

---

### Draggable Split Resizer
The horizontal bar between the candidate pane and the full census browser can be dragged up or down to change how much space each gets. It highlights blue while dragging.

---

### Center Panel: Full Census Browser (Bottom Pane)
The complete census population for the active county and year, for finding anyone the machine didn't rank.

- **Title**: `RAW CENSUS (10,277)`, or `(240 of 10,277)` while a filter or search narrows it.
- **Filter checkboxes**: `Heads only` (household heads) and `Men only`.
- **Search box**: matches full name, line number, race, or gender; press **Enter** to jump to the next match or **Shift+Enter** for the previous one, with wraparound and a "match *N* of *M*" status.
- **Infinite scroll** loads records in chunks of 80 as you scroll, with explicit "▲ Load earlier records" / "▼ Load more records" links at each edge as a manual alternative.
- **Rows** show line number, full name, `birth:`, `gender:`, `race:`, `head: yes/no`, birthplace, recorded property value, and enumeration date. A row is tagged `in bracket` when it falls inside the current enslaver's positional window, `claimed by …` (red) if another enslaver already has it, and `current match` / `closest match` / `selected` depending on why it's highlighted.
- **Two-way sync**: selecting a candidate in the top pane highlights and scrolls to the matching row here, and vice versa.
- **Double-click** any row to commit it as the match for the current enslaver, immediately, with the confirmation chime. This is the manual-find channel — matches made this way are flagged `foundManually: true` in the exported session, which is how the model's real recall is measured.

---

### Right Rail: Evidence Inspector
Explains why the currently inspected candidate is ranked the way it is:
1. **EPS match card** (when relevant) — the linked IPUMS holding number, whether it was merged from several of ours, and a *Suspect EPS Anchor* warning if IPUMS's own census join disagrees with the surname.
2. **Confirmed in 1850 card** (1860 only) — when this same person was already matched in the 1850 pass, cross-census agreement is shown as extra corroborating evidence.
3. **Why this candidate** — a bit-by-bit breakdown with proportional bars: Fellegi-Sunter surname/given-name/nickname/phonetic agreement, the positional log-likelihood term, head-of-household/property context bits, the 1850 cross-census bonus, a gender-clash penalty when the inferred enslaver gender conflicts with the census record, and the **total**.
4. **Position** — expected rank, sigma ($\sigma$, the positional margin of error — it shrinks as more anchors around this enslaver are confirmed), this candidate's actual rank, and how many anchors bound the estimate.
5. **Margin over the next** — the runner-up's score, the gap between #1 and #2 in bits (a gap over ~3 bits is a strong separation), and how many candidates were considered in total.

---

### Bottom Toolbar: Decisions
- **Clear this decision**: appears only once the current enslaver has a recorded decision; removes it and returns them to undecided.
- **Matched via EPS** badge: shown when the current decision came from an EPS/HISTID anchor.
- A constant reminder: *Click to inspect · Double-click to match*. There is no separate "confirm" step — double-clicking a candidate row or census row *is* the confirmation.

---

## 4. Step-by-Step Review Workflows

### Workflow A: Confirming a Candidate
1. Click an enslaver in the left rail.
2. Single-click the top-ranked candidate to inspect it.
3. Check the **Evidence Inspector**: is the total score comfortably high, is the positional difference small relative to $\sigma$, and is the gap to the runner-up wide?
4. **Double-click** the same row to commit it. The chime confirms the save, and you stay on the current enslaver — click another row in the left rail when you're ready to move on.

---

### Workflow B: Verifying & Auditing EPS Anchors
1. Enslavers linked via IPUMS EPS/HISTID are pre-seeded as anchors and badged `EPS` (confirmed) or `EPS?` / `EPS±` (proposed, not yet confirmed) in the queue. A surname mismatch against IPUMS's own census join instead shows a `Suspect EPS Anchor` warning and is not used to pin the alignment.
2. Click the row to see the linked holding number, composition-match quality, and proposed census person.
3. If it's correct and only proposed (not yet confirmed), double-click it to confirm.
4. If it's wrong: click **Clear this decision**, then pick the true candidate or **Not in this census** and double-click to confirm.
5. To audit an anchor from a *different* enslaver's screen: any confirmed match that lands inside your current window shows up as a quiet `anchor` row. Clicking it jumps you to that enslaver so you can inspect or correct it directly.

---

### Workflow C: Manual Search & Arbitrary Record Linkage
When the ranked candidates don't include the right person (heavy transcription error, or the enumerators' walks drifted far apart):
1. Use the search box in the bottom **Raw census** pane — type a name or line number and press **Enter** (or **Shift+Enter** to go backward).
2. Optionally check **Heads only** or **Men only** to narrow the list. Records inside the estimated walk bracket are marked `in bracket`.
3. Single-click the record to preview it in the Evidence Inspector.
4. **Double-click** it to confirm the match immediately.
   - The session file records this as `foundManually: true`, which is what lets you measure the matcher's real recall over time.

---

### Workflow D: Handling Clashes & Conflicting Claims
If two different enslavers end up matched to the same census person:
1. Both rows in the left rail get a red `clash` badge.
2. Wherever that census person appears — in the candidate list or the raw census browser — it's flagged `claimed by [other enslaver's name]`.
3. Double-clicking a claimed record to assign it anyway opens a confirmation:
   > *"[Person] is already matched to [Other Enslaver]. Record this match anyway? Both will be flagged so you can settle it, and the earlier decision stays until you change it."*
4. Open the other enslaver (click the flagged name, or find them in the queue), compare holding sizes and line numbers, and use **Clear this decision** on whichever one is wrong.

---

### Workflow E: Marking as Absent
- If an enslaver died, lived outside the county, is an estate/heirs entry, or simply wasn't enumerated in the population census, double-click **Not in this census** at the bottom of the candidate list. Rows that already look like an estate or deceased owner are pre-flagged with an **Estate / Deceased — Likely absent** badge as a hint, not an automatic decision.

---

## 5. Search Navigation Reference

Review decisions are made with clicks (single to inspect, double to commit). The two search boxes — candidate search and raw-census search — share the same keys:

| Key | Action | Description |
|---|---|---|
| `Enter` | Search forward | Jump to the next match |
| `Shift` + `Enter` | Search backward | Jump to the previous match |
| `Escape` | Unfocus | Clears focus from the search box |

---

## 6. Exports & Session Management

### Exporting Assertions (`enslavers-COUNTY-YEAR-*.csv`)
Click **Export assertions** in the header bar. The CSV conforms to the project's entity assertion schema and contains only positive links:
- **`isSameAs`** rows for every matched enslaver, with `who` set to `EPS` (confirmed anchor), `human` (found by manual search), or `FS+v1` (accepted from the ranked machine candidates), and `confidence` of `0.95` (certain) or `0.75` (probable).
- Rejected candidates (`isNotSameAs`) are **not** included in this export — they are preserved instead inside the session file described below.

### Exporting Sessions (`session-COUNTY-YEAR-*.json`)
Click **Export session** in the header bar. This is the full, reproducible audit trail:
- Reviewer name, start timestamp, and export timestamp.
- Aggregate stats: total decisions, matches, absences, conflicts, and the manual-find rate.
- Every decision, with the top candidates as they were actually shown (name, line, score breakdown) and which one — if any — was chosen. This is what lets you tell later whether a decision was easy or lucky, and it doubles as labelled training data for refitting the Fellegi-Sunter weights.
- The current Fellegi-Sunter parameters and the EPS/holding-alignment report, so the run is fully reproducible.

### Resuming Work
1. Open the app — it loads and prepares automatically.
2. Click **Load session** in the header bar (or use the **Earlier session** file field on the Set up tab).
3. Pick your saved `session-*.json`. Its decisions are merged into the current session by enslaver ID (a decision in the file overwrites one for the same enslaver already in memory; everything else is left alone), and its county, reviewer, and year are applied if present.

---

## 7. Troubleshooting & Best Practices

| Issue | Cause | Solution |
|---|---|---|
| **Setup pane says "needs http.server" / stays on Set up** | Opened via `file://` protocol | Serve the folder (`python3 -m http.server 8000`) and open `http://localhost:8000/ENSLAVER/` instead. |
| **eps1850.csv / eps1860.csv status says "not in this folder"** | The EPS file isn't present next to `index.html` | Non-fatal — the tool runs on name and position evidence alone. Add the file and click **Reload files** to pick it up. |
| **Prepare button is disabled** | Nothing has changed since the last successful Prepare | Change the county or year (or click **Run diagnostics**) to re-enable it, then click **Prepare** again. |
| **Search in a pane doesn't filter as you type** | The query hasn't been submitted yet | Press **Enter** to run the search; the search icon does the same thing. |
| **Candidate is dimmed / marked "outside"** | Name matches, but its rank falls outside the current positional bracket | Check whether another candidate with the same name sits closer to the expected line. If not, weigh the name evidence against the positional distance before confirming. |
| **Double-clicking doesn't seem to do anything** | The click landed outside a row, or on an anchor row (which navigates instead of committing) | Double-click the highlighted name/line text itself; anchor rows (soft green, "anchor" badge) belong to another enslaver and only jump you to their record. |
| **Accidentally confirmed the wrong candidate** | Misclick | Select the enslaver, click **Clear this decision**, then double-click the correct record. |
| **Red "clash" badge in the queue** | Two enslavers matched to the same census person | Open both, compare holding sizes and line order, and clear the incorrect one. |
