// review.js
// ---------------------------------------------------------------------------
// ReviewStore — every decision, with enough context around it to be re-read
// later by someone who was not there.
//
// Three things are stored that a plain list of accepted matches would throw
// away, and each of them is load-bearing:
//
//   1. Rejections, as isNotSameAs. Without them every re-run re-proposes the
//      same wrong pairs and the reviewer grinds through them again. The schema
//      already has the predicate.
//   2. The full candidate set as it was shown, with scores. That is the only
//      way to tell afterwards whether a correct decision was easy or lucky, and
//      it is 2,000-odd labelled examples for refitting the m/u tables — free if
//      captured at decision time and unreconstructable later.
//   3. Whether the reviewer picked a proposed candidate or went and found
//      someone by hand. The manual-find rate is the recall estimate for the
//      matching, and it is the number that says whether the machine is working
//      or the reviewers are quietly carrying it.
//
// The store never writes a file in place. Decisions accumulate in memory and
// are exported explicitly, so a session is reproducible and an export never
// overwrites the evidence it was derived from.
// ---------------------------------------------------------------------------

class ReviewStore {

	constructor(opts = {}) {
		this.decisions = new Map();     // owner mention_id -> decision
		this.reviewer = opts.reviewer || '';
		this.started = new Date().toISOString();
		this.county = opts.county || '';
	}

	static uuid() {
		if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
		return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
			const r = Math.random() * 16 | 0;
			return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
		});
	}

	// outcome: 'matched' | 'absent' | 'deferred'
	record(owner, chosenCandidate, presented, meta = {}) {
		const shown = (presented || []).map((c, i) => ({
			rank: i + 1,
			mention_id: c.candidate.mention_id,
			name: c.candidate.full_name,
			line: c.candidate._line,
			bits: c.totalBits != null ? c.totalBits : c.bits,
			nameBits: c.nameBits,
			positionBits: c.positionBits,
			via: c.via,
			proposedBy: c.anchored ? 'EPS' : 'FS+',
		}));
		const chosenId = chosenCandidate ? chosenCandidate.mention_id : null;
		const wasProposed = chosenId ? shown.some((s) => s.mention_id === chosenId) : false;

		const d = {
			owner_id: owner.mention_id,
			owner_name: owner.full_name,
			owner_line: owner._line,
			owner_enum: owner._enum,
			year: owner._year,
			county: owner._county,
			outcome: meta.outcome || (chosenId ? 'matched' : 'absent'),
			census_id: chosenId,
			census_name: chosenCandidate ? chosenCandidate.full_name : null,
			census_line: chosenCandidate ? chosenCandidate._line : null,
			foundManually: !!chosenId && !wasProposed,
			confidence: meta.confidence || 'certain',
			note: meta.note || '',
			reviewer: this.reviewer,
			decided: new Date().toISOString(),
			presented: shown,
			method: meta.method || (chosenCandidate && meta.anchored ? 'EPS' : 'FS+'),
			anchored: !!meta.anchored,
			machine: !!meta.machine,
		};
		this.decisions.set(owner.mention_id, d);
		return d;
	}

	get(ownerId) { return this.decisions.get(ownerId) || null; }
	clear(ownerId) { this.decisions.delete(ownerId); }

	// Which census records are already spoken for, and by whom. One census
	// person claimed by two enslavers is surfaced rather than blocked: the newer
	// evidence sometimes proves the older decision wrong, and the reviewer needs
	// to be able to change the earlier one instead of being forced into a choice
	// they believe is incorrect.
	claims() {
		const m = new Map();
		for (const d of this.decisions.values()) {
			if (!d.census_id) continue;
			let a = m.get(d.census_id);
			if (!a) { a = []; m.set(d.census_id, a); }
			a.push(d);
		}
		return m;
	}

	conflicts() {
		const out = [];
		for (const [censusId, ds] of this.claims().entries()) {
			if (ds.length > 1) out.push({ census_id: censusId, decisions: ds });
		}
		return out;
	}

	stats() {
		let matched = 0, absent = 0, deferred = 0, manual = 0, machine = 0, anchored = 0;
		for (const d of this.decisions.values()) {
			if (d.outcome === 'matched') matched++;
			else if (d.outcome === 'absent') absent++;
			else deferred++;
			if (d.foundManually) manual++;
			if (d.machine) machine++;
			if (d.anchored) anchored++;
		}
		const humanMatches = matched - machine;
		return {
			total: this.decisions.size,
			matched, absent, deferred, manual, machine, anchored,
			conflicts: this.conflicts().length,
			// Share of human-confirmed matches the machine did not propose.
			// Treat as a recall estimate for the candidate generator.
			manualFindRate: humanMatches > 0 ? manual / humanMatches : null,
		};
	}

	// ---- exports -----------------------------------------------------------

	// enslavers.csv, in the project's assertion shape. Accepted matches become
	// isSameAs; every candidate the reviewer saw and passed over becomes
	// isNotSameAs, so the next run does not re-propose it.
	//
	// `who` stays a method identifier and carries a version, because the
	// algorithm will change and the rows have to remain distinguishable. Nothing
	// is collapsed into a single reconciled row: agreement between methods is a
	// thing to compute from the rows, and merging them deletes exactly the
	// signal that makes it computable.
	assertionRows(opts = {}) {
		const version = opts.version || 'FS+v1';
		const includeNegatives = opts.includeNegatives !== false;
		const rows = [];
		for (const d of this.decisions.values()) {
			if (d.outcome === 'matched' && d.census_id) {
				rows.push({
					assertion_id: ReviewStore.uuid(),
					subject_id: d.owner_id,
					predicate: 'isSameAs',
					object_id: d.census_id,
					start_year: d.year || '',
					end_year: '',
					who: d.anchored ? 'EPS' : (d.foundManually ? 'human' : version),
					confidence: d.confidence === 'certain' ? 0.95 : 0.75,
					county: d.county || this.county || '',
				});
			}
			if (!includeNegatives) continue;
			for (const s of d.presented || []) {
				if (s.mention_id === d.census_id) continue;
				rows.push({
					assertion_id: ReviewStore.uuid(),
					subject_id: d.owner_id,
					predicate: 'isNotSameAs',
					object_id: s.mention_id,
					start_year: d.year || '',
					end_year: '',
					who: 'human',
					confidence: 0.9,
					county: d.county || this.county || '',
				});
			}
		}
		return rows;
	}

	static ASSERTION_COLUMNS = ['assertion_id', 'subject_id', 'predicate', 'object_id', 'start_year', 'end_year', 'who', 'confidence', 'county'];

	toAssertionCsv(opts) {
		return CSV.stringify(this.assertionRows(opts), ReviewStore.ASSERTION_COLUMNS);
	}

	// The audit record. Everything the reviewer saw, not just what they chose.
	toSessionJson(extra = {}) {
		return JSON.stringify({
			kind: 'verite-schedule2census-session',
			version: 1,
			county: this.county,
			reviewer: this.reviewer,
			started: this.started,
			exported: new Date().toISOString(),
			stats: this.stats(),
			decisions: [...this.decisions.values()],
			...extra,
		}, null, 2);
	}

	loadSessionJson(text) {
		const o = JSON.parse(text);
		if (!o || o.kind !== 'verite-schedule2census-session') throw new Error('Not a schedule2census session file');
		this.county = o.county || this.county;
		this.reviewer = o.reviewer || this.reviewer;
		this.started = o.started || this.started;
		for (const d of o.decisions || []) this.decisions.set(d.owner_id, d);
		return o;
	}

	static download(filename, text, mime = 'text/plain') {
		const blob = new Blob([text], { type: mime + ';charset=utf-8' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url; a.download = filename;
		document.body.appendChild(a); a.click();
		setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
	}
}

if (typeof window !== 'undefined') window.ReviewStore = ReviewStore;
if (typeof module !== 'undefined' && module.exports) module.exports = { ReviewStore };
