# EnslaverReview (schedule2census) — User Manual

## Table of Contents
1. [Overview & Core Concepts](#1-overview--core-concepts)
2. [Getting Started & Setup](#2-getting-started--setup)
3. [Interface Tour](#3-interface-tour)
   - [Header Bar & Navigation](#header-bar--navigation)
   - [Left Rail: Enumerator Blocks & Enslaver Queue](#left-rail-enumerator-blocks--enslaver-queue)
   - [Center Panel: Subject Information](#center-panel-subject-information)
   - [Center Panel: Top Census Pane (Ranked Candidates & Bracket)](#center-panel-top-census-pane-ranked-candidates--bracket)
   - [Draggable Split Resizer](#draggable-split-resizer)
   - [Center Panel: Bottom Census Pane (Full Census Browser)](#center-panel-bottom-census-pane-full-census-browser)
   - [Right Rail: Evidence Inspector](#right-rail-evidence-inspector)
   - [Bottom Toolbar: Decisions](#bottom-toolbar-decisions)
4. [Step-by-Step Review Workflows](#4-step-by-step-review-workflows)
   - [Workflow A: Confirming a High-Ranked Machine Candidate](#workflow-a-confirming-a-high-ranked-machine-candidate)
   - [Workflow B: Verifying & Auditing EPS Anchors](#workflow-b-verifying--auditing-eps-anchors)
   - [Workflow C: Manual Search & Arbitrary Record Linkage](#workflow-c-manual-search--arbitrary-record-linkage)
   - [Workflow D: Handling Clashes & Conflicting Claims](#workflow-d-handling-clashes--conflicting-claims)
   - [Workflow E: Marking as Absent or Deferring](#workflow-e-marking-as-absent-or-deferring)
5. [Keyboard Shortcuts Reference](#5-keyboard-shortcuts-reference)
6. [Exports & Session Management](#6-exports--session-management)
7. [Troubleshooting & Best Practices](#7-troubleshooting--best-practices)

---

## 1. Overview & Core Concepts

**EnslaverReview** (`schedule2census`) links enslavers recorded on the **1850 and 1860 US Federal Slave Schedules** to their corresponding person records in the **US Federal Population Census**.

### The Challenge of Linking Slave Schedules
An enslaver mention on a slave schedule is an extremely sparse record:
- It typically contains **only a surname and a given name** (or initials).
- Age, race, birthplace, occupation, and household relationships were not collected for enslavers on the slave schedule.
- In traditional Fellegi-Sunter probabilistic record linkage, missing fields contribute zero evidence bits. The attribute evidence ceiling is approximately **17.5 bits**, while confident linkage ($p \ge 0.9$) requires **18.8 bits**.

### The Hybrid Solution
EnslaverReview bridges this evidence gap through three complementary mechanisms:
1. **Positional Alignment (Walk Order)**: Both the slave schedule and the population census were recorded sequentially by enumerators walking door-to-door. Enumeration dates correlate monotonically with line numbers. The app treats matching as an order-preserving partial sequence alignment.
2. **IPUMS EPS Holding Anchors**: Enslaved Population Schedule (EPS) holding compositions (counts, ages, and genders of enslaved individuals) are aligned with local holdings. Confirmed matches serve as fixed **anchors**, narrowing the positional uncertainty window ($\sigma$) for neighboring enslavers.
3. **Human Review & Active Learning**: Machine-generated candidate brackets guide the reviewer, but reviewers can audit anchors, manually locate unranked census records, and mark confidence levels. Every choice captures the full candidate pool and negative rejections for downstream model training.

> [!TIP]
> **Recommended Workflow Strategy**: Always work **1850 before 1860**. 
> The 1850 census has recorded real estate property values and fewer bare initials (only ~4% vs. ~30% in 1860). Completed 1850 linkages establish confirmed household anchors that dramatically improve 1860 accuracy.

---

## 2. Getting Started & Setup

### Requirements
The application runs as a lightweight, browser-based vanilla JavaScript application without any build steps or external dependencies.

Required data files located in the project directory:
- `mentions.csv` — Ingested mention records for both slave schedules and population census.
- `eps1850.csv` — IPUMS Enslaved Population Schedule data for 1850.
- `eps1860.csv` — IPUMS Enslaved Population Schedule data for 1860.
- `match.js` & `fellegi.js` — Core linkage and probabilistic scoring engines.

### Launching the Application
Due to browser security constraints on local `file://` access, the app must be served over HTTP:

```bash
# In the project directory:
python -m http.server 8000
```
Then navigate to: `http://localhost:8000/ENSLAVER/`

### The Setup Screen
When you open the application, you begin on the **Set up** tab:

1. **File Status Indicators**: Shows whether `mentions.csv`, `eps1850.csv`, and `eps1860.csv` loaded successfully.
2. **Select County & Year**:
   - **County**: Defaults to the first county detected in `mentions.csv` (e.g., `AUG` for Augusta County).
   - **Year**: Select `1850` or `1860`.
3. **Reviewer Name**: Enter your name or initials. This identifier is saved in the session audit trail and assertion outputs.
4. **Run Diagnostics**: Click to compute source capability, attribute evidence ceilings, monotone sequence checks, and seed counts.
5. **Click "Prepare"**:
   - Aligns EPS holdings to local holdings.
   - Extracts and pre-seeds high-confidence anchors.
   - Builds surname and sequence indexes.
   - Transitions directly to the **Review** screen.

---

## 3. Interface Tour

The review interface is divided into functional zones designed for efficient triage and inspection:

```
+----------------------------------------------------------------------------------------------------+
|  EnslaverReview   [Set up] [Review]  |  Decisions: 342/530  |  [Accept clear] [Export Assertions] |
+-----------------------+------------------------------------------------------+---------------------+
| ENUMERATOR BLOCK      | SUBJECT ENSLAVER                                     | EVIDENCE INSPECTOR  |
| Enslavers (979)       | William Wise — Line 412, July 9, 1850                 | Why this candidate: |
|                       | Held 5 people: 32m 28f 12m 8f 2m                     | - Surname (exact)   |
|-----------------------+------------------------------------------------------| - Given name        |
| ENSLAVER QUEUE        | TOP PANE: CANDIDATE BRACKET                          | - Position (+2.4b)  |
| 410 John Smith   EPS  | [Census records 390–435 of 10,277]  [Find candidates] | Total: 19.8 bits    |
| 412 William Wise      | ( ) Ln 410 John Smith [anchor · EPS] [Reopen]        |---------------------|
| 415 Mary Jones   auto | (*) Ln 414 William H. Wise [1 · 19.8 bits]           | Position:           |
| 418 David Bell   none | ( ) Ln 418 William Wise [2 · 16.2 bits · +6 pos]     | Expected rank: 413  |
| 422 Thos. Brown       | ( ) Not in this census                               | Sigma: ±8           |
|                       |=================[ Draggable Resizer ]================| Runner-up gap: 3.6b |
|                       | BOTTOM PANE: FULL CENSUS BROWSER                     |                     |
|                       | Census (10,277) [Search... (Enter)] [x] Heads only   |                     |
|                       | ( ) 413 Martha Wise  · birth: 1822 · F · W · head: no|                     |
|                       | (*) 414 William H. Wise · birth: 1818 · M · W · head |                     |
|                       | [Add as match: William H. Wise]                      |                     |
+-----------------------+------------------------------------------------------+---------------------+
|                       | DECIDE: [Clear this decision]   Click candidate or 1–9 to match · n next   |
+-----------------------+----------------------------------------------------------------------------+
```

---

### Header Bar & Navigation
- **Progress Track**: A subtle green progress bar at the very top indicates your review completion percentage across the county.
- **Tab Switcher**: Toggle between **Set up** (configuration, diagnostics, loading files) and **Review**.
- **Counter**: Displays `matched / total decisions (conflicts)` in real time.
- **Accept Clear Matches**: Automatically accepts unambiguous, high-margin machine proposals across the dataset without manual clicking.
- **Load Session**: Upload a previously exported `session-*.json` file to resume where you left off.
- **Export Assertions**: Generates a standardized `enslavers-COUNTY-YEAR-*.csv` assertion file.
- **Export Session**: Generates a full `session-COUNTY-YEAR-*.json` audit file containing candidate pools and scores.
- **Help Icon (`#helpTop`)**: Prominently located on the top line of the page. Clicking it opens the full Google Docs user documentation in read-only preview mode in a new browser tab.

---

### Left Rail: Enslaver Queue
- **Queue Title & Filter Pulldown**:
  - Displays visible vs total count (e.g. `Enslavers (979)` or `Enslavers (12 of 979)`).
  - **Status Filter Pulldown**: Filter the list instantly by decision status:
    - **All**: Show all enslavers across the county.
    - **Blank**: Show only undecided enslavers without any recorded match or absence.
    - **Auto**: Show only matches accepted via automated triage (`auto`).
    - **Set**: Show only matches confirmed manually by a human reviewer (`set`).
    - **Clash**: Show only records with conflicting/duplicate claims (`clash`).
- **Enslaver List**: Lists all enslavers matching the active filter in schedule line order.
  - **Line Number**: Slave schedule line.
  - **Name**: Enslaver full name.
  - **Status Badges**:
    - `EPS`: Confirmed anchor imported from IPUMS EPS linkage.
    - `set`: Confirmed by a human reviewer.
    - `auto`: Accepted via automated high-confidence triage.
    - `none`: Marked as "Not in this census".
    - `clash`: Conflicted; this census individual has been claimed by multiple enslavers.

---

### Center Panel: Subject Information
The header of the center workspace displays:
- **Enslaver Name & Mention ID**: Primary identifier.
- **Schedule Metadata**: Enumerator block, line number, and enumeration date (formatted as Month Day, e.g., "Jul 9").
- **Holding Information**: Number of enslaved persons held, followed by their individual demographic profiles (e.g., `45m 32f 12m 4f` representing age and gender).
- **EPS Holding Badge**: Indicates if IPUMS identified this holding and whether it involved merged holdings.

---

### Center Panel: Top Census Pane (Ranked Candidates & Bracket)
Displays census individuals located within the estimated positional bracket around the subject enslaver:
- **Bracket Window**: Header displays the census line range (e.g., `Records 380–425 of 5,500`) and whether the bracket is constrained by confirmed anchors.
- **Find in Block**: Instant filter to search for any individual within the current block's candidate window.
- **Candidate Rows**:
  - **Selection Dot**: Radio button showing the selected candidate.
  - **Rank & Score Badge**: Displays candidate rank and total evidence bits (e.g., `1 · 21.4 bits`).
  - **Method Badges**: `EPS`, `manual pick`, `census head`, `position only`, `name only`.
  - **Out-of-Bracket Warnings**: Displays distance (e.g., `14 outside the bracket`) if a high name match is far from expected walk order.
  - **Confirmed Anchors**: Rendered in soft green. Anchors cannot be accidentally selected, but include a **Reopen** button if you need to revise an earlier decision.
- **"Not in this census" Option (`0`)**: Located at the bottom of the list for enslavers who were non-residents, deceased, estate holdings, or omitted.

---

### Draggable Split Resizer
Between the top candidate pane and bottom census pane is a horizontal divider (`.split-resizer`):
- Click and drag up or down to adjust pane heights to your preference.
- Hovering or dragging highlights the divider in accent blue.

---

### Center Panel: Bottom Census Pane (Full Census Browser)
A comprehensive viewer of the entire census population for the county and year:
- **Title & Counter**: Shows total records loaded (e.g., `Census (19,551)`).
- **Search Box & Search Icon (`#censusSearch`, `#censusSearchBtn`)**:
  - Search by full name, line number, enumeration block, race, or gender.
  - **Search from this point on**: Clicking the magnifying glass search icon (or pressing **Enter**) searches forward from the currently selected person or scroll position downward through the census sequence.
  - Clicking search again (or pressing Enter again) continues stepping forward to subsequent matches.
  - Wraps around to the top if the end of the census is reached, updating status with line number and match count.
- **Filter Checkboxes**:
  - `Heads only`: Restricts the list to heads of household.
  - `This block only`: Restricts the list to the active enumerator block.
- **Add as Match Button**: Prominently displays the name of any highlighted census person (e.g., `Add as match: William H. Wise`). Clicking it assigns the match and commits immediately.
- **Person Rows**:
  - Displays: `Line Number`, `Full Name`, `birth: YYYY`, `gender: M/F`, `race: W/B/Mu`, `head: yes/no`, property value, block, and enumeration date.
  - **Two-Way Highlight Sync**: When you click or select a candidate in the top pane, the bottom pane automatically highlights the person's name in bold yellow (`#ffe58f` in light mode / gold in dark mode) and smoothly scrolls the record into view.
  - **Infinite Scroll**: Dynamically loads rows in 80-item increments for fluid 60fps scrolling.

---

### Right Rail: Evidence Inspector
Provides complete transparency into why a candidate was ranked:
1. **EPS Match Card** (if applicable):
   - IPUMS EPS holding number and composition match score.
   - Merged holding counts and IPUMS `HISTID`.
2. **Why This Candidate (Evidence Breakdown)**:
   - Fellegi-Sunter attribute weights: Surname, given name, nicknames, soundex, and phonetic agreement/disagreement with visual bar indicators.
   - Positional log-likelihood bits based on distance from expected walk order.
   - Contextual bits (household head status, recorded real estate property).
   - **Total Bits**: Overall log-likelihood ratio.
3. **Position Diagnostics**:
   - **Expected Rank**: Predicted census line position along the enumerator's walk.
   - **Sigma ($\sigma$)**: Positional standard deviation / margin of error. As you confirm anchors, $\sigma$ shrinks.
   - **Candidate Rank**: Actual position of the candidate.
   - **Anchors Used**: Count of bounding anchors constraining this prediction.
4. **Margin Over the Next**:
### Bottom Toolbar: Decisions
- **Clear This Decision Button**: When an enslaver has already been matched or marked absent, this button removes the decision, restoring the enslaver to undecided.
- **Matched via EPS Badge**: Indicates an automated or confirmed link originating from the IPUMS EPS schedule join.
- **Keyboard & Click Hints**: Quick reminder of the primary shortcut keys (`1–9` to match, `0` not present, `n` next).

---

## 4. Step-by-Step Review Workflows

### Workflow A: Confirming a Candidate
1. Press `n` or click an undecided enslaver in the queue.
2. Review the top-ranked candidate in the top pane.
3. Check the **Evidence Inspector** on the right:
   - Is the total score $\ge 18$ bits?
   - Is the positional difference small (within $\pm \sigma$)?
4. **Click the candidate row** (or press `1`–`9` on the keyboard).
5. The match is saved instantly, and you remain on the current enslaver. When you are ready, press `n` or use the arrow keys to advance to another enslaver.

---

### Workflow B: Verifying & Auditing EPS Anchors
1. Enslavers with verified IPUMS EPS links are automatically badged with green `EPS` tags and pre-seeded as anchors.
2. Click any `EPS` row in the queue.
3. The subject header and evidence card will display the linked IPUMS holding number, holding size agreement, and census person.
4. If the link is correct, no action is required.
5. If the link is incorrect:
   - Click **Clear this decision** in the bottom toolbar.
   - Select the true candidate from the candidate list or bottom census browser, or select **Not in this census**.
   - Click **Confirm**.

---

### Workflow C: Manual Search & Arbitrary Record Linkage
When the machine's top candidates do not match (e.g., due to severe transcription errors or wide sequence displacement):
1. Navigate to the **bottom Census pane**.
2. Type the person's name or census line number into the search box and press **Enter**.
3. (Optional) Check or uncheck **Heads only** or **This block only** depending on your search scope.
4. Click on the intended census record in the list.
   - The row turns active blue with a green "selected" badge.
   - The top pane automatically mirrors this selection as a `manual pick`.
   - The Evidence Inspector updates to calculate Fellegi-Sunter name bits and positional distance for this person.
   - The toolbar button displays `Add as match: [Person Name]`.
5. Click **Add as match** or press **Enter** to confirm.
   - *Note*: The system flags this match as `foundManually: true` in the session file to help measure model recall.

---

### Workflow D: Handling Clashes & Conflicting Claims
If two different enslavers are matched to the same census individual:
1. The queue marks both enslavers with a red `clash` badge.
2. The candidate rows and census rows display a red warning: `claimed by [Other Enslaver Name]`.
3. Selecting a claimed candidate prompts a confirmation modal:
   > *"[Person] is already matched to [Other Enslaver]. Record this match anyway? Both will be flagged so you can settle it."*
4. Inspect both enslavers' holding dates and line numbers. Reopen or clear the incorrect enslaver's match to resolve the conflict.

---

### Workflow E: Marking as Absent or Deferring
- **Enslaver not in census**:
  - If an enslaver died, was an out-of-county owner, an estate holding, or missed by the census enumerator, select **Not in this census** (or press `0`) and press `Enter`.
- **Uncertain / Need to return later**:
  - Click **Decide later**. The queue will badge the row as `later`, allowing you to continue reviewing without blocking sequence alignment.

---

## 5. Keyboard Shortcuts Reference

The review interface is fully operational via keyboard shortcuts for rapid review:

| Key | Action | Description |
|---|---|---|
| `1` – `9` | Select Candidate | Selects candidate #1 through #9 from the top candidate pane |
| `0` | Not in Census | Selects "Not in this census" |
| `Enter` | Confirm Decision | Commits the current selection and advances to next undecided |
| `n` | Next Undecided | Jumps to the next undecided enslaver in the active block |
| `ArrowDown` / `j` | Next Enslaver | Moves down to the adjacent enslaver in the queue |
| `ArrowUp` / `k` | Previous Enslaver | Moves up to the adjacent enslaver in the queue |
| `/` | Focus Block Search | Jumps cursor into the "Find anyone in this block" search field |
| `Escape` | Unfocus Input | Blurs search boxes so single-key shortcuts resume functioning |

---

## 6. Exports & Session Management

### Exporting Assertions (`enslavers-COUNTY-YEAR-*.csv`)
Click **Export assertions** in the header bar. 

The exported CSV conforms to the project's entity assertion schema:
- **`isSameAs`**: Positive links confirmed by the reviewer.
  - `who`: Identified as `EPS` (IPUMS anchor), `human` (manual find), or `FS+v1` (probabilistic alignment model).
  - `confidence`: `0.95` (certain) or `0.75` (marked as probable).
  - Negative (`isNotSameAs`) assertions are excluded from the export.

### Exporting Sessions (`session-COUNTY-YEAR-*.json`)
Click **Export session** in the header bar.

Generates a complete, reproducible JSON audit trail:
- Reviewer username, start timestamp, and export timestamp.
- Full statistics: total decisions, matches, absences, manual-find rate, conflict counts.
- **Candidate snapshots**: Captures the exact top candidates presented to the reviewer, their calculated bits, and the chosen candidate.
- Enables refitting of Fellegi-Sunter $m/u$ frequency parameters without losing historic context.

### Resuming Work
To restore a previous session:
1. Open the app and prepare your county/year.
2. Click **Load session** in the header bar (or use the session file picker on the Set up screen).
3. Select your saved `session-*.json` file. All confirmed decisions, absences, and notes will be restored immediately.

---

## 7. Troubleshooting & Best Practices

| Issue | Cause | Solution |
|---|---|---|
| **Cannot load files / Page stays blank** | Opened via `file://` protocol | Run a local web server (e.g. `python -m http.server 8000`) and access over `http://localhost:8000`. |
| **Search in bottom pane doesn't filter** | Query typed without pressing Enter | Press the **Enter** key to execute the census search query. Click the `✕` button to reset. |
| **Candidate outside bracket warning** | Name matches, but walk order is distant | Check if there is another person with the same name closer in line order. If not, inspect property and age before confirming. |
| **Census match button is disabled** | No person selected in bottom pane | Click a person row in the bottom census pane to select them first; the button will activate with their name. |
| **Accidentally confirmed wrong candidate** | Misclick or typo | Select the enslaver in the queue, click **Clear this decision**, select the correct person, and confirm. |
| **Red "clash" badge in queue** | Multiple enslavers matched to same census person | Click the clashing records, review their holding sizes and neighbors, and reassign the incorrect match. |
