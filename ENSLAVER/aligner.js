// aligner.js
// ---------------------------------------------------------------------------
// SequenceAligner — resolve a whole enumerator block at once instead of
// thresholding each enslaver independently.
//
// Both documents record the same walk. The enumerator visited households in
// order and wrote both forms in that order; within every block of this data the
// enumeration date is monotone in the line number on both the schedule and the
// census side. So the true assignment of enslavers to census records is an
// ORDER-PRESERVING partial matching, and treating it as one is what turns weak
// name evidence into a decision.
//
// Gaps are asymmetric and that asymmetry is the point:
//   - Skipping a census record is free. Most households held nobody.
//   - Skipping an enslaver costs `skipBits`. Some enslavers really are absent
//     from the county census — they lived elsewhere, they died, the row is an
//     estate — so this is a real outcome with a price, not an error.
//
// Order is a strong prior, not a law. The schedule was written up in batches
// (one Augusta enumerator recorded 449 owners across 13 days while working the
// census over 42), so the two sequences can slip. Order violations are allowed
// at a penalty rather than forbidden; a hard constraint forces a wrong answer
// wherever the enumerator doubled back.
//
// The DP runs over candidate SHORTLISTS, not the full pool. Scoring every
// enslaver against every census record would be millions of comparisons; the
// shortlists cut it to a few tens of thousands with no loss that the position
// window does not already cover.
// ---------------------------------------------------------------------------

class SequenceAligner {

	constructor(opts = {}) {
		this.skipBits = opts.skipBits != null ? opts.skipBits : -3.0;
		this.inversionBits = opts.inversionBits != null ? opts.inversionBits : -5.0;
		this.inversionScale = opts.inversionScale != null ? opts.inversionScale : 250;
		this.allowInversion = opts.allowInversion !== false;
		this.anchorBits = opts.anchorBits != null ? opts.anchorBits : 40;
	}

	// rows: one CandidateEngine.rankOwner() result per block owner, in owner order
	// (see App.alignBlock) — [{ owner, ownerRank, candidates:[...] }]
	// anchors: Map ownerMentionId -> candidate mention record (forced assignment)
	//
	// Returns { assignments, totalBits, skipped }.
	align(rows, anchors = new Map(), block = null) {
		const n = rows.length;
		if (!n) return { assignments: [], totalBits: 0, skipped: [] };

		// Per-owner option list. An anchored owner has exactly one option.
		const options = rows.map((r) => {
			const forced = anchors.get(r.owner.mention_id);
			if (forced) {
				const found = r.candidates.find((c) => c.candidate.mention_id === forced.mention_id);
				const base = found || {
					owner: r.owner, candidate: forced, via: 'anchor',
					nameBits: 0, positionBits: 0, contextBits: 0, totalBits: 0,
					deltaRank: null, deltaDays: null, fellegi: null, why: null,
				};
				const pos = block ? block.rankOf.get(forced.mention_id) : (found ? found.candRank : null);
				if (pos == null) return r.candidates.map((c) => ({ ...c, anchored: false, bits: c.totalBits, pos: c.candRank }));
				return [{ ...base, anchored: true, bits: this.anchorBits, pos }];
			}
			return r.candidates.map((c) => ({
				...c, anchored: false, bits: c.totalBits, pos: c.candRank,
			}));
		});

		// ---- forward pass ---------------------------------------------------
		// F[i][k] = best total over owners 0..i with owner i assigned to option k,
		// charging skipBits for every owner before i that went unassigned.
		//
		// Skipping must NOT release the order constraint — that was the subtle
		// error worth naming here, because it fails quietly: the totals come out
		// right while the traceback collapses to a single assignment. A skipped
		// owner does not reset where the walk has reached.
		//
		// Charging a variable number of skips inside a prefix-maximum query is
		// handled by storing W = F - skipBits*i on the frontier instead of F.
		// Chaining j -> i then costs skipBits*(i-j-1), which factors out:
		//     F[i][k] = skipBits*(i-1) + max{ W[j][q] : pos_jq < pos_ik } + bits
		// The virtual start state W = skipBits at pos -Infinity gives the base
		// case of "every owner before i skipped".
		const F = [], Fback = [];
		let events = [{ pos: -Infinity, w: this.skipBits, i: -1, k: -1 }];

		const prefixBest = (pos) => {
			let best = -Infinity, bi = -1, bk = -1, inverted = false;
			for (let e = 0; e < events.length; e++) {
				const ev = events[e];
				if (ev.pos < pos) {
					if (ev.w > best) { best = ev.w; bi = ev.i; bk = ev.k; inverted = false; }
				} else if (this.allowInversion) {
					// Going backwards costs more the further back it goes. A flat
					// penalty lets an 18-bit surname match drag an assignment
					// hundreds of lines out of sequence for the price of one bad
					// birth year, which is not what the evidence says.
					const back = ev.pos - pos;
					const v = ev.w + this.inversionBits * (1 + Math.min(3, back / this.inversionScale));
					if (v > best) { best = v; bi = ev.i; bk = ev.k; inverted = true; }
				}
			}
			return { value: best, i: bi, k: bk, inverted };
		};

		for (let i = 0; i < n; i++) {
			const opt = options[i];
			F.push(new Float64Array(opt.length).fill(-Infinity));
			Fback.push(new Array(opt.length).fill(null));
			const carry = this.skipBits * (i - 1);
			for (let k = 0; k < opt.length; k++) {
				const p = prefixBest(opt[k].pos);
				F[i][k] = carry + p.value + opt[k].bits;
				Fback[i][k] = { i: p.i, k: p.k, inverted: p.inverted };
			}
			for (let k = 0; k < opt.length; k++) {
				events.push({ pos: opt[k].pos, w: F[i][k] - this.skipBits * i, i, k });
			}
			// Only the best value at a given position can ever win a prefix-max
			// query, so the frontier can be collapsed without changing any answer.
			if (events.length > 3000) {
				const bestByPos = new Map();
				for (const ev of events) {
					const cur = bestByPos.get(ev.pos);
					if (!cur || ev.w > cur.w) bestByPos.set(ev.pos, ev);
				}
				events = [...bestByPos.values()].sort((a, b) => a.pos - b.pos);
			}
		}

		// ---- best terminal state -------------------------------------------
		// Owners after the last assignment are skipped too, so the comparison is
		// on F[i][k] + skipBits*(n-1-i), not on F alone.
		let bestVal = this.skipBits * n, bestI = -1, bestK = -1;
		for (let i = 0; i < n; i++) {
			const tail = this.skipBits * (n - 1 - i);
			for (let k = 0; k < F[i].length; k++) {
				const v = F[i][k] + tail;
				if (v > bestVal) { bestVal = v; bestI = i; bestK = k; }
			}
		}

		// ---- traceback ------------------------------------------------------
		const chosen = new Array(n).fill(null);
		let ci = bestI, ck = bestK, guard = 0;
		while (ci >= 0 && guard++ <= n) {
			chosen[ci] = ck;
			const back = Fback[ci][ck];
			if (!back || back.i < 0) break;
			ci = back.i; ck = back.k;
		}

		// ---- exact per-owner margins ---------------------------------------
		// The margin that matters is not "best score minus runner-up score for
		// this owner in isolation" — it is how much total path score is lost by
		// forcing this owner somewhere else. Cheap version: rescore the chosen
		// path with owner i moved to each alternative that keeps order, and take
		// the best. Exact for a single substitution, which is the question a
		// reviewer is actually asking.
		const assignments = [];
		const skipped = [];
		for (let i = 0; i < n; i++) {
			const k = chosen[i];
			const opts = options[i];
			if (k == null) {
				skipped.push({ owner: rows[i].owner, row: rows[i], reason: 'no-assignment' });
				assignments.push({
					owner: rows[i].owner, row: rows[i], candidate: null,
					bits: null, marginBits: null, anchored: false, outcome: 'unassigned',
				});
				continue;
			}
			const pick = opts[k];
			const lo = this._prevPos(chosen, options, i);
			const hi = this._nextPos(chosen, options, i);
			let second = -Infinity;
			for (let j = 0; j < opts.length; j++) {
				if (j === k) continue;
				const p = opts[j].pos;
				const ok = (lo == null || p > lo) && (hi == null || p < hi);
				const v = opts[j].bits + (ok ? 0 : this.inversionBits);
				if (v > second) second = v;
			}
			const skipAlt = this.skipBits;
			const bestAlt = Math.max(second, skipAlt);
			assignments.push({
				owner: rows[i].owner,
				row: rows[i],
				candidate: pick.candidate,
				pick,
				bits: +pick.bits.toFixed(3),
				marginBits: +(pick.bits - bestAlt).toFixed(3),
				anchored: !!pick.anchored,
				bracket: { lowPos: lo, highPos: hi },
				outcome: pick.anchored ? 'anchored' : 'proposed',
			});
		}

		// Count where the assignment ran against the order prior. A high rate is
		// not necessarily wrong — the schedules were written up in batches and
		// the two sequences do slip — but it is the number that says how much
		// the position term should be trusted in this block.
		let inversions = 0, lastPos = -1, placed = 0;
		for (const a of assignments) {
			if (!a.candidate || a.pick == null || a.pick.pos == null) continue;
			placed++;
			if (a.pick.pos <= lastPos) inversions++;
			lastPos = Math.max(lastPos, a.pick.pos);
		}

		return { assignments, totalBits: bestVal, skipped, options, inversions, placed };
	}

	_prevPos(chosen, options, i) {
		for (let j = i - 1; j >= 0; j--) if (chosen[j] != null) return options[j][chosen[j]].pos;
		return null;
	}
	_nextPos(chosen, options, i) {
		for (let j = i + 1; j < chosen.length; j++) if (chosen[j] != null) return options[j][chosen[j]].pos;
		return null;
	}

	// Route assignments into work queues. The point of the tiering is that a
	// genealogist's time should go to the ambiguous cases, not to 2,000 rows
	// most of which are not in doubt — and that the ones routed away from the
	// queue are recorded as machine decisions so they can be audited later.
	// absentNameBits is the interesting threshold and it is deliberately about
	// the NAME, not the total. Position evidence attaches to whoever happens to
	// stand at the right point in the sequence, so a total score can look
	// healthy for a candidate whose name bears no resemblance at all. An
	// enslaver who is genuinely not in this census will still have somebody
	// sitting where he should have been. Only the name can say he is not there.
	triage(assignments, opts = {}) {
		const acceptBits = opts.acceptBits != null ? opts.acceptBits : 16;
		const acceptMargin = opts.acceptMargin != null ? opts.acceptMargin : 8;
		const absentBits = opts.absentBits != null ? opts.absentBits : 0;
		const absentNameBits = opts.absentNameBits != null ? opts.absentNameBits : -2;
		const out = { auto: [], review: [], likelyAbsent: [], anchored: [] };
		for (const a of assignments) {
			if (a.anchored) { out.anchored.push(a); continue; }

			// If owner is an estate/deceased with no agent, flag as likely absent
			if (a.owner && a.owner._isEstate && !a.owner._agentName) {
				a.absentHint = true;
				a.estateAbsent = true;
				out.likelyAbsent.push(a);
				continue;
			}

			// No assignment is NOT the same claim as "not in the census". The
			// alignment may simply have had nowhere to put this enslaver without
			// breaking order. That belongs in front of a reviewer with its
			// shortlist, not filed as an absence.
			if (!a.candidate) {
				if (a.row && a.row.candidates && a.row.candidates.length) out.review.push(a);
				else out.likelyAbsent.push(a);
				continue;
			}
			if (a.bits < absentBits) { out.likelyAbsent.push(a); continue; }
			const nameBits = a.pick && a.pick.nameBits != null ? a.pick.nameBits : 0;
			if (nameBits < absentNameBits) { a.absentHint = true; out.likelyAbsent.push(a); continue; }
			if (a.bits >= acceptBits && a.marginBits >= acceptMargin) out.auto.push(a);
			else out.review.push(a);
		}
		return out;
	}
}

if (typeof window !== 'undefined') window.SequenceAligner = SequenceAligner;
if (typeof module !== 'undefined' && module.exports) module.exports = { SequenceAligner };
