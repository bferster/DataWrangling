# schedule2census

Matching the enslavers named on the 1850 and 1860 slave schedules to their
records in the population census. Browser-based, vanilla JS, no build step.

> For a complete, step-by-step guide to using the interface and review workflows, see the **[User Manual](MANUAL.md)**.

## Running it

Put these five files in the folder with `index.html`:

    mentions.csv   eps1850.csv   eps1860.csv   match.js   fellegi.js

(`match.js` and `fellegi.js` are included here, pinned at the time this was
written — replace them with your working versions.)

Then serve the folder and open it:

    python3 -m http.server 8000

All three data files load themselves when the page opens, and the diagnostics
run on their own once the mentions are in. Both EPS years load up front, so
switching year never goes back to the network. The only thing you can open by
hand is an earlier session file.

Opening `index.html` straight off the filesystem will not work — a `file://`
page cannot read its neighbouring files. The setup pane says so rather than
sitting blank. If the EPS files are absent the tool runs without them and says
which are missing.

Tests run under Node:

    node test/smoke.js /path/to/mentions.csv [eps1850.csv] 1850
    node test/boot.js  /path/to/mentions.csv [eps1850.csv] [eps1860.csv]
    node test/ui.js    /path/to/mentions.csv
                                     # boot and ui need: npm install jsdom

`test/ui.js` builds a synthetic EPS file out of your own holdings with a known
number of holdings deliberately merged, and checks the tool finds them. On
Augusta 1850 it currently recovers 331 of 326 planted merges with every holding
size agreeing exactly.

## The shape of the problem

An enslaver row on a slave schedule is a remarkably thin record. The ingest
discards age, race, gender and birth year for owner rows, and the schedule never
had a birthplace, an occupation or a household. So Fellegi-Sunter's birth,
household, birthplace and occupation levers all return MISSING and contribute
exactly zero bits. The comparison is surname plus given name and nothing else.

`capability()` puts a number on that: for this source pair the evidence ceiling
is about 17.5 bits while p ≥ 0.9 needs 18.8. On attributes alone these two
sources cannot be linked with confidence. The diagnostics report this before you
start, because it is the reason the rest of the design looks the way it does.

What is left is position. Both documents record the same walk, and in every
block of this data the enumeration date is monotone in the line number on both
sides — the diagnostics verify it rather than assuming it. That makes the true
assignment an order-preserving partial matching, and treating it as one is what
turns weak name evidence into a decision.

1860 is the hard year. 30% of enslavers and 17% of census candidates carry a
single-letter given name, against about 4% and 0.3% in 1850. Work 1850 first.

## Modules

| file | what it does |
|---|---|
| `js/csv.js` | Delimited parsing. Survives the BOM, the empty header in `mentions.csv`, and quoted fields; chunked so a 170k-row load does not freeze the tab. |
| `js/data.js` | Loads and indexes mentions; groups an EPS file into holdings. Hoists the three signals that are not columns: enumerator block, line order, and enumeration date. |
| `js/holdings.js` | Order-preserving alignment of EPS holdings to ours, on composition alone. Detects holdings our ingest split. |
| `js/candidates.js` | Candidate generation (surname index plus positional window), Fellegi scoring, the position likelihood ratio, and the seeding pass. |
| `js/aligner.js` | The block-level dynamic program, exact per-enslaver margins, and triage. |
| `js/review.js` | Decisions, rejections, conflicts, and export. |
| `js/diagnostics.js` | The numbers that decide how much work is left. |
| `js/ui.js` | The review surface. |
| `js/app.js` | Orchestration and incremental recomputation. |

## Three things that are easy to get wrong

**Enumeration dates are month.day floats.** 7.9 is July 9 and sorts *below* 7.13,
which is July 13. Everything goes through `VeriteData.parseEnumDate` once, at
load. Comparing the raw value anywhere is a bug, and a quiet one — one 1860
block currently reports a minimum of 6.21 and a maximum of 6.4.

**Candidate rank is per block, not per record.** A census mention appears in its
own enumerator block and again in the unblocked pool used by enslavers whose
enumerator is unrecorded. Writing the rank onto the mention lets the second pass
overwrite the first, which silently puts every candidate rank in the wrong
coordinate space. It lives in `block.rankOf`. This failed only in 1860, because
1850 has no unrecorded-enumerator owners.

**Skipping must not release the order constraint.** In the alignment DP, an
enslaver who goes unassigned does not reset where the walk has reached. Getting
this wrong fails quietly: the totals stay plausible while the traceback collapses
to a single assignment. `test/smoke.js` checks the DP total against a brute-force
reference on a slice, which is the test that catches it.

## Seeding, and why the first pass looks bad without it

Interpolation is only as good as the anchors it sits between. With none, the
estimate is block-proportional: 530 enslavers mapped onto 5,500 census records,
routinely dozens of lines out.

So the first pass lays anchors from the cases needing no interpolation — an
exact first+last name with exactly one bearer in the block, filtered by a longest
increasing subsequence so seeds that contradict the rest are dropped. On Augusta
1850 that is 109 seeds, and it moves the position window from ±120 to ±8, and the
confidently-placed count from 164 to 212. In 1860 it moves confident placements
from 7 to 136.

## What the review surface does differently

Ranked candidates are shown **in their place inside the census sequence**, not in
a separate list. Seeing that the top-scoring candidate sits sixty lines out of
position while the second sits neatly between two confirmed anchors is one
glance; reading it off two panels is not.

- Confirmed matches appear as quiet, unselectable anchors, and can be reopened.
- Unranked records inside the bracket stay selectable. That is the manual-find
  channel, and the rate at which reviewers use it is your recall estimate.
- A ranked candidate outside the bracket is pinned at the edge with its distance.
- Nothing is preselected.
- A doubly-claimed census record is flagged on both enslavers rather than blocked.
  Forcing a reviewer into a choice they believe is wrong produces bad data.

Keyboard: `1`–`9` pick, `0` not present, `enter` confirm, `n` next, `/` search.

## Exports

**Assertions** (`enslavers-COUNTY-YEAR-*.csv`) in the shape of
`AssertionsFormat.md`. Accepted matches become `isSameAs`; every candidate the
reviewer saw and passed over becomes `isNotSameAs`, so the next run does not
re-propose it. `who` carries a version (`FS+v1`) because the algorithm will
change and the rows have to stay distinguishable. Nothing is merged into a
single reconciled row: agreement between methods is a thing to compute from the
rows, and merging deletes the signal that makes it computable.

**Session** (`session-*.json`) holds every decision with the full candidate set
as it was shown, the scores, the reviewer and the timestamp. Two reasons: you
cannot otherwise tell whether a correct decision was easy or lucky, and a
reviewer choosing among ranked candidates is producing labelled training data —
free if captured at decision time, unreconstructable later. Feed it to
`Fellegi.fit()` to replace the hand-written m/u priors with measurements.

**Holdings** (`holdings-*.csv`) is the split report. Each flagged row is a
holding where the schedule named an owner and an employer and the ingest opened
two holdings; the `wasEnslavedBy` assertions in the second fragment name the
wrong person.


## Importing EPS files

In the file @eps1850.csv and @eps1860.csv {
    - Remove all rows where county != 400150.0
    - If race == 200.0 or 210.0 set race to "B", else "W"
    - If sex == "2" set sex ="F" else sex="M"
    - Rename sex column to "gender"
    - Rename race column to norm_race
}