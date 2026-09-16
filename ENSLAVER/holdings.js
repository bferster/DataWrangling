// holdings.js
// ---------------------------------------------------------------------------
// HoldingAligner — line up IPUMS EPS holdings with our own slave-schedule
// holdings, using nothing but enumeration order and the demographic makeup of
// each holding. No names on either side; EPS has none, and the composition is
// a stronger signal than the enslaver's name anyway.
//
// Why this runs before any census matching:
//   Our schedule ingest opens a new holding on every row whose status is
//   "Owner". Where a holding listed an owner AND an employer, that rule splits
//   one holding into two. EPS counted the same manuscript page and kept them
//   together, so a run of our holdings whose sizes sum to one EPS `sizehold`
//   with a matching age/sex vector is a split we introduced — and every
//   wasEnslavedBy assertion in the second fragment points at the wrong person.
//
// The alignment is monotone with gaps on both sides: EPS may hold a holding we
// never transcribed, and we may hold one EPS dropped. A MERGE move consumes one
// EPS holding against two or three consecutive holdings of ours, which is how
// the split shows up as a first-class outcome rather than as two bad matches.
// ---------------------------------------------------------------------------

class HoldingAligner {

	constructor(opts = {}) {
		this.ageTolerance = opts.ageTolerance != null ? opts.ageTolerance : 2;
		this.maxMerge = opts.maxMerge != null ? opts.maxMerge : 3;
		this.gapCost = opts.gapCost != null ? opts.gapCost : 0.55;
		this.mergeCost = opts.mergeCost != null ? opts.mergeCost : 0.12;
		this.band = opts.band != null ? opts.band : 400;
		this.minAccept = opts.minAccept != null ? opts.minAccept : 0.45;
	}

	// Similarity of two rosters in [0,1]. Greedy best-first assignment on
	// (sex, race class, age); small rosters make an optimal assignment
	// unnecessary and greedy is stable enough to compare against a threshold.
	//
	// Singleton holdings are the weak case by construction: a lone 30-year-old
	// woman appears many times in one county, so composition cannot separate
	// them and the order term has to. That is a property of the data, not a bug
	// here, and it is why `order` carries weight below.
	composition(ourPeople, epsPeople) {
		const A = ourPeople.map((p) => ({
			age: HoldingAligner._age(p.age != null ? p.age : p._age),
			sex: HoldingAligner._sex(p.gender),
			race: HoldingAligner._race(p.norm_race || p.race),
		}));
		const B = epsPeople.map((p) => ({
			age: HoldingAligner._age(p.age),
			sex: HoldingAligner._sex(p.sex),
			race: HoldingAligner._race(p.race),
		}));
		if (!A.length && !B.length) return 1;
		if (!A.length || !B.length) return 0;

		const pairs = [];
		for (let i = 0; i < A.length; i++) {
			for (let j = 0; j < B.length; j++) {
				const q = this._pairQuality(A[i], B[j]);
				if (q > 0) pairs.push({ i, j, q });
			}
		}
		pairs.sort((x, y) => y.q - x.q);
		const usedA = new Set(), usedB = new Set();
		let total = 0;
		for (const p of pairs) {
			if (usedA.has(p.i) || usedB.has(p.j)) continue;
			usedA.add(p.i); usedB.add(p.j); total += p.q;
		}
		return total / Math.max(A.length, B.length);
	}

	_pairQuality(a, b) {
		if (a.sex && b.sex && a.sex !== b.sex) return 0;
		if (a.race && b.race && a.race !== b.race) return 0;
		if (a.age == null || b.age == null) return 0.5;
		const d = Math.abs(a.age - b.age);
		if (d > this.ageTolerance) return 0;
		return 1 - (d / (this.ageTolerance + 1)) * 0.5;
	}

	static _age(v) { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; }
	static _sex(v) {
		const s = String(v || '').trim().toUpperCase();
		return (s === 'M' || s === 'MALE' || s === '1') ? 'M' : (s === 'F' || s === 'FEMALE' || s === '2') ? 'F' : '';
	}
	// B and M are one class: reclassification between enumerations is routine and
	// must not stop two rosters from lining up.
	static _race(v) {
		const s = String(v || '').trim().toUpperCase().replace(/[^A-Z]/g, '');
		if (!s) return '';
		if (s === 'W' || s === 'WHITE') return 'W';
		if (s === 'B' || s === 'M' || s === 'BLACK' || s === 'MULATTO' || s === 'NEGRO' || s === 'COLORED') return 'B';
		return s;
	}

	// Score for matching our holdings [i..i+span-1] against EPS holding j.
	_cellScore(ours, eps, i, span, j) {
		const people = [];
		for (let k = 0; k < span; k++) people.push(...ours[i + k].people);
		const comp = this.composition(people, eps[j].people);
		const sizeOurs = people.length;
		const sizeEps = eps[j].size;
		const sizeTerm = (sizeOurs === sizeEps) ? 0.15
			: (Math.abs(sizeOurs - sizeEps) <= 1 ? 0.05 : -0.20);
		// Proportional-position agreement. Weak on its own, decisive for the
		// singleton holdings where composition says nothing.
		const pOurs = ours.length > 1 ? i / (ours.length - 1) : 0;
		const pEps = eps.length > 1 ? j / (eps.length - 1) : 0;
		const orderTerm = 0.25 * (1 - Math.min(1, Math.abs(pOurs - pEps) * 8));
		const merge = span > 1 ? this.mergeCost * (span - 1) : 0;
		return comp + sizeTerm + orderTerm - merge;
	}

	// Monotone alignment with gaps and 1:N merges.
	align(ourHoldings, epsHoldings) {
		const A = ourHoldings, B = epsHoldings;
		const n = A.length, m = B.length;
		if (!n || !m) return { pairs: [], merges: [], unmatchedOurs: A.slice(), unmatchedEps: B.slice(), score: 0 };

		const NEG = -1e9;
		// dp[i][j] = best score having consumed i of ours and j of EPS
		const dp = new Float64Array((n + 1) * (m + 1)).fill(NEG);
		const bk = new Int32Array((n + 1) * (m + 1)).fill(0); // encodes (span<<2)|move
		const at = (i, j) => i * (m + 1) + j;
		dp[at(0, 0)] = 0;

		const inBand = (i, j) => {
			if (this.band <= 0) return true;
			const pi = n > 1 ? i / n : 0, pj = m > 1 ? j / m : 0;
			return Math.abs(pi - pj) * Math.max(n, m) <= this.band;
		};

		for (let i = 0; i <= n; i++) {
			for (let j = 0; j <= m; j++) {
				const cur = dp[at(i, j)];
				if (cur === NEG) continue;
				if (i < n) { // skip one of ours
					const v = cur - this.gapCost;
					if (v > dp[at(i + 1, j)]) { dp[at(i + 1, j)] = v; bk[at(i + 1, j)] = (1 << 2) | 1; }
				}
				if (j < m) { // skip one EPS holding
					const v = cur - this.gapCost;
					if (v > dp[at(i, j + 1)]) { dp[at(i, j + 1)] = v; bk[at(i, j + 1)] = (1 << 2) | 2; }
				}
				if (j < m && inBand(i, j)) {
					const maxSpan = Math.min(this.maxMerge, n - i);
					for (let span = 1; span <= maxSpan; span++) {
						const v = cur + this._cellScore(A, B, i, span, j);
						const t = at(i + span, j + 1);
						if (v > dp[t]) { dp[t] = v; bk[t] = (span << 2) | 3; }
					}
				}
			}
		}

		// Trace back
		const pairs = [];
		let i = n, j = m;
		while (i > 0 || j > 0) {
			const code = bk[at(i, j)];
			const move = code & 3, span = code >> 2;
			if (!move) break;
			if (move === 1) { i -= 1; }
			else if (move === 2) { j -= 1; }
			else {
				const si = i - span, sj = j - 1;
				pairs.push({
					ours: A.slice(si, si + span),
					eps: B[sj],
					span,
					score: this._cellScore(A, B, si, span, sj),
				});
				i = si; j = sj;
			}
		}
		pairs.reverse();

		const matchedOurs = new Set(), matchedEps = new Set();
		const merges = [];
		const accepted = [];
		for (const p of pairs) {
			if (p.score < this.minAccept) continue;
			accepted.push(p);
            for (const o of p.ours) matchedOurs.add(o.household_id);
			matchedEps.add(p.eps.holdnum);
			if (p.span > 1) merges.push(p);
		}

		return {
			pairs: accepted,
			rejected: pairs.filter((p) => p.score < this.minAccept),
			merges,
			unmatchedOurs: A.filter((x) => !matchedOurs.has(x.household_id)),
			unmatchedEps: B.filter((x) => !matchedEps.has(x.holdnum)),
			score: dp[at(n, m)],
		};
	}

	// A compact account of what the alignment says about our holdings.
	// `merges` is the number the project actually needs: each one is a holding
	// our ingest split, and therefore a set of wasEnslavedBy assertions that
	// name the wrong enslaver.
	report(result, ourHoldings, epsHoldings) {
		let sizeAgree = 0, sizeOff1 = 0, sizeWorse = 0, splitPeople = 0;
		for (const p of result.pairs) {
			const ourSize = p.ours.reduce((a, x) => a + x.size, 0);
			const d = Math.abs(ourSize - p.eps.size);
			if (d === 0) sizeAgree++; else if (d === 1) sizeOff1++; else sizeWorse++;
			if (p.span > 1) splitPeople += ourSize;
		}
		return {
			ourHoldings: ourHoldings.length,
			epsHoldings: epsHoldings.length,
			aligned: result.pairs.length,
			suspectedSplits: result.merges.length,
			peopleInSplitHoldings: splitPeople,
			sizeAgree, sizeOff1, sizeWorse,
			unmatchedOurs: result.unmatchedOurs.length,
			unmatchedEps: result.unmatchedEps.length,
		};
	}

	// Anchors for the census pass: our owner mention -> census mention, by way of
	// the EPS holding's HISTID. These are links IPUMS already made; we are only
	// carrying them across the holding correspondence.
	anchors(result, data) {
		const out = [];
		for (const p of result.pairs) {
			const id = p.eps.histid;
			if (!id) continue;
			const census = data.byIpums.get(id);
			if (!census) continue;
			// A merged pair covers several of our owner rows and EPS names only
			// the first holder, so the anchor goes to the first fragment. The
			// remaining fragments are the employer or a second owner and must be
			// resolved by hand, not assumed.
			const owner = p.ours[0].owner;
			if (!owner) continue;
			out.push({
				owner, census, holdnum: p.eps.holdnum,
				span: p.span, compositionScore: p.score,
				extraHolderIds: [p.eps.histid2, p.eps.histid3].filter(Boolean),
				ambiguous: p.span > 1,
			});
		}
		return out;
	}
}

if (typeof window !== 'undefined') window.HoldingAligner = HoldingAligner;
if (typeof module !== 'undefined' && module.exports) module.exports = { HoldingAligner };
