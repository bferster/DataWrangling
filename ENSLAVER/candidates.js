// candidates.js
// ---------------------------------------------------------------------------
// CandidateEngine — for one enumerator block, produce a short ranked candidate
// list per enslaver.
//
// Two recall channels, deliberately kept separate:
//
//   1. Name.     A surname index over NYSIIS, double-metaphone primary, the raw
//                surname, and its first four letters. Cheap, and it finds the
//                match whenever the name survived transcription.
//   2. Position. Every candidate within a window of the interpolated expected
//                position. This is the channel that matters in 1860, where 30%
//                of schedule owners and 21% of census heads carry a single
//                initial for a given name and the name channel simply cannot
//                decide. Without it, those owners are unreachable.
//
// Scoring is Fellegi bits plus a position term. The position term is written as
// a real likelihood ratio — log2(m/u) where u is the chance a random candidate
// in the block lands this close — so it composes with the Fellegi bits instead
// of being a tuning knob bolted onto a probability.
//
// What the enslaver record does NOT have is worth stating, because it explains
// why so much weight ends up on position: the schedule ingest discards age,
// race, gender and birth year for owner rows. There is no birth year, no
// birthplace, no occupation, and no household on the schedule side. Fellegi's
// birth, household, birthplace and occupation levers all return MISSING and
// contribute exactly zero bits. The comparison is surname plus given name, and
// nothing else.
// ---------------------------------------------------------------------------

class CandidateEngine {

	constructor(fellegi, opts = {}) {
		this.f = fellegi;
		this.match = fellegi.match;
		this.topK = opts.topK != null ? opts.topK : 20;
		this.positionWindow = opts.positionWindow != null ? opts.positionWindow : 60;
		this.maxPositionBits = opts.maxPositionBits != null ? opts.maxPositionBits : 9;
		this.minPositionBits = opts.minPositionBits != null ? opts.minPositionBits : -10;
		this.sigmaFloor = opts.sigmaFloor != null ? opts.sigmaFloor : 8;
		this.sigmaCeil = opts.sigmaCeil != null ? opts.sigmaCeil : 120;
		this.sigmaFraction = opts.sigmaFraction != null ? opts.sigmaFraction : 0.15;
		this.usePosition = opts.usePosition !== false;
		this.headBonusBits = opts.headBonusBits != null ? opts.headBonusBits : 1.5;
		this.propBonusBits = opts.propBonusBits != null ? opts.propBonusBits : 0.6;
	}

	// ---- surname index over one candidate pool ----------------------------
	buildIndex(pool) {
		const idx = new Map();
		const add = (k, rec) => {
			if (!k) return;
			let a = idx.get(k);
			if (!a) { a = []; idx.set(k, a); }
			a.push(rec);
		};
		for (const c of pool) {
			const last = Match.normUpper(c.last_name);
			add('L:' + last, c);
			if (last.length >= 4) add('P:' + last.slice(0, 4), c);
			const ny = Match.normUpper(c.nysiis_last_name);
			add('N:' + ny, c);
			const mp = String(c.metaphone_last_name || '').split(':')[0].replace(/[^A-Za-z]/g, '').toUpperCase();
			add('M:' + mp, c);
		}
		return idx;
	}

	_nameCandidates(owner, index) {
		const seen = new Set(), out = [];
		const push = (arr) => {
			if (!arr) return;
			for (const c of arr) { if (!seen.has(c.mention_id)) { seen.add(c.mention_id); out.push(c); } }
		};
		const last = Match.normUpper(owner.last_name);
		push(index.get('L:' + last));
		if (last.length >= 4) push(index.get('P:' + last.slice(0, 4)));
		push(index.get('N:' + Match.normUpper(owner.nysiis_last_name)));
		const mp = String(owner.metaphone_last_name || '').split(':')[0].replace(/[^A-Za-z]/g, '').toUpperCase();
		push(index.get('M:' + mp));
		return out;
	}

	// ---- expected position -------------------------------------------------
	// Interpolate the owner's expected candidate rank from the nearest anchors
	// on either side. With no anchors the estimate is the block-proportional
	// one, which is weak: 744 owners against 2,716 candidates means a
	// proportional guess is routinely dozens of lines out. Between two confirmed
	// anchors it is tight. Sigma scales with the anchor gap so the term is
	// honest about which situation it is in.
	expectedPosition(ownerRank, block, anchorIndex) {
		const nO = Math.max(1, block.nOwners - 1);
		const nC = Math.max(1, block.nCandidates - 1);
		let lo = null, hi = null;
		for (const a of anchorIndex) {
			if (a.ownerRank < ownerRank && (!lo || a.ownerRank > lo.ownerRank)) lo = a;
			if (a.ownerRank > ownerRank && (!hi || a.ownerRank < hi.ownerRank)) hi = a;
			if (a.ownerRank === ownerRank) return { expected: a.candRank, sigma: this.sigmaFloor, bracket: [a, a], anchored: true };
		}
		let expected, gap;
		if (lo && hi) {
			const t = (ownerRank - lo.ownerRank) / (hi.ownerRank - lo.ownerRank);
			expected = lo.candRank + t * (hi.candRank - lo.candRank);
			gap = Math.abs(hi.candRank - lo.candRank);
		} else if (lo) {
			const scale = nC / nO;
			expected = lo.candRank + (ownerRank - lo.ownerRank) * scale;
			// Extrapolating beyond the last anchor: at minimum, one full block step
			// of uncertainty (scale = nC/nO). Without this floor, blocks with many
			// owners per census candidate keep sigma pinned at sigmaFloor.
			const rawGap = Math.abs(ownerRank - lo.ownerRank) * scale * 4;
			gap = Math.max(rawGap, scale / this.sigmaFraction);
		} else if (hi) {
			const scale = nC / nO;
			expected = hi.candRank - (hi.ownerRank - ownerRank) * scale;
			// Same minimum-one-step guarantee as the lo-only case above.
			const rawGap = Math.abs(hi.ownerRank - ownerRank) * scale * 4;
			gap = Math.max(rawGap, scale / this.sigmaFraction);
		} else {
			expected = (ownerRank / nO) * nC;
			gap = nC;
		}
		const sigma = Math.min(this.sigmaCeil, Math.max(this.sigmaFloor, this.sigmaFraction * gap));
		return { expected, sigma, bracket: [lo, hi], anchored: false };
	}

	// log2(m/u) for the position feature.
	//   m ~ the chance a TRUE match falls delta ranks from the estimate, modelled
	//       as a Gaussian with the sigma above.
	//   u = the chance a candidate drawn at random from the block falls within
	//       the same one-rank slice, i.e. 1/nCandidates.
	// Clamped, because a Gaussian tail will otherwise hand out forty bits of
	// negative evidence on a single mis-estimated anchor.
	//
	// The floor is scaled by sigma so that tight brackets (small sigma, reliable
	// estimate) can apply the full penalty, while wide/uncertain estimates
	// (large sigma, no nearby anchors) cannot bury a strong name match.
	// Example: sigma=8 (exact anchor) → floor=-10; sigma=120 (no anchors) → floor=-0.67.
	positionBits(candRank, est, nCandidates) {
		if (!this.usePosition || !nCandidates) return 0;
		const d = candRank - est.expected;
		const s = est.sigma;
		const m = Math.exp(-(d * d) / (2 * s * s)) / (s * Math.sqrt(2 * Math.PI));
		const u = 1 / nCandidates;
		const bits = Math.log2(Math.max(1e-12, m) / u);
		// Scale floor: full penalty at sigmaFloor, approaches 0 as sigma grows.
		const floor = Math.max(this.minPositionBits, this.minPositionBits * (this.sigmaFloor / s));
		return Math.max(floor, Math.min(this.maxPositionBits, bits));
	}

	// ---- context bits the Fellegi tables do not cover ----------------------
	// Head of household and recorded property are both weak positive evidence
	// that a white adult held people in 1850. They are kept OUT of the Fellegi
	// bits because they have no m/u behind them; they are reported separately so
	// a reviewer can see them, and folded into the ranking with small weights.
	contextBits(cand) {
		let b = 0;
		if (cand._head) b += this.headBonusBits;
		if (cand._prop != null && cand._prop >= 100) b += this.propBonusBits;
		return b;
	}

	// ---- main entry --------------------------------------------------------
	// Returns, for one owner, a ranked array of candidate records.
	rankOwner(owner, block, index, anchorIndex, opts = {}) {
		const ownerRank = owner._blockRank != null ? owner._blockRank : 0;
		const est = this.expectedPosition(ownerRank, block, anchorIndex);

		const byId = new Map();
		for (const c of this._nameCandidates(owner, index)) byId.set(c.mention_id, { rec: c, via: 'name' });

		if (this.usePosition && block.nCandidates) {
			const w = opts.positionWindow != null ? opts.positionWindow : this.positionWindow;
			const lo = Math.max(0, Math.floor(est.expected - w));
			const hi = Math.min(block.nCandidates - 1, Math.ceil(est.expected + w));
			for (let r = lo; r <= hi; r++) {
				const c = block.candidates[r];
				if (!c) continue;
				const prev = byId.get(c.mention_id);
				if (prev) prev.via = 'name+position';
				else byId.set(c.mention_id, { rec: c, via: 'position' });
			}
		}

		const out = [];
		for (const { rec, via } of byId.values()) {
			const res = this.f.MatchPerson(owner, rec, {
				censusYear: block.year || rec._year,
				prior: opts.prior,
			});
			if (res.tier === 'KNOCKOUT') continue;
			const candRank = block.rankOf.get(rec.mention_id);
			const pBits = this.positionBits(candRank, est, block.nCandidates);
			const cBits = this.contextBits(rec);
			out.push({
				owner,
				candidate: rec,
				candRank,
				via,
				nameBits: res.bits,
				positionBits: +pBits.toFixed(3),
				contextBits: +cBits.toFixed(3),
				totalBits: +(res.bits + pBits + cBits).toFixed(3),
				deltaRank: candRank - Math.round(est.expected),
				deltaDays: (owner._date != null && rec._date != null) ? (rec._date - owner._date) : null,
				fellegi: res,
				why: res.why,
				anchored: !!(est.anchored && candRank === est.expected),
			});
		}

		out.sort((a, b) => b.totalBits - a.totalBits);
		const kept = out.slice(0, opts.topK != null ? opts.topK : this.topK);
		if (kept.length) {
			kept[0].marginBits = +(kept[0].totalBits - (kept[1] ? kept[1].totalBits : kept[0].totalBits - 99)).toFixed(3);
		}
		return { owner, ownerRank, estimate: est, candidates: kept, consideredCount: byId.size };
	}

	// Rank every owner in a block. `anchorIndex` is an array of
	// { ownerRank, candRank } fixed points, from EPS or from confirmed reviews.
	rankBlock(block, anchorIndex = [], opts = {}) {
		const index = opts.index || this.buildIndex(block.candidates);
		const rows = [];
		for (const owner of block.owners) {
			rows.push(this.rankOwner(owner, block, index, anchorIndex, opts));
		}
		return rows;
	}

	// ---- seeding -----------------------------------------------------------
	// Interpolation is only as good as the anchors it sits between, and with no
	// anchors at all the estimate is the block-proportional one: 530 enslavers
	// mapped onto 6,118 census records, routinely dozens of lines out. So the
	// first pass lays anchors from the cases that need no interpolation — an
	// exact first+last name with exactly one bearer in the block.
	//
	// Two guards, because a seed that is wrong poisons every estimate near it:
	//   - the name must be unique among the ENSLAVERS too, or two men called
	//     John Smith both claim the same record;
	//   - the seeds must be mutually consistent in order. A longest increasing
	//     subsequence over candidate rank drops the ones that contradict the
	//     rest, which is exactly the signature of a wrong seed.
	seedAnchors(block) {
		// Normalize first_name to its first token only.
		// The schedule often stores the middle initial in first_name ("Simpson F")
		// while the census stores it in middle_name ("Simpson"). Using the full
		// first_name as the key would match a wrong census record whose first_name
		// also includes the initial, anchoring position to the wrong person.
		const firstToken = (s) => Match.normUpper(s).split(/\s+/)[0];

		const candByName = new Map();
		for (const c of block.candidates) {
			const k = firstToken(c.first_name) + '|' + Match.normUpper(c.last_name);
			if (!k || k === '|') continue;
			let a = candByName.get(k);
			if (!a) { a = []; candByName.set(k, a); }
			a.push(c);
		}
		const ownerCount = new Map();
		for (const o of block.owners) {
			const k = firstToken(o.first_name) + '|' + Match.normUpper(o.last_name);
			ownerCount.set(k, (ownerCount.get(k) || 0) + 1);
		}

		const raw = [];
		for (const o of block.owners) {
			const fn = firstToken(o.first_name), ln = Match.normUpper(o.last_name);
			if (fn.length < 2 || !ln) continue;                 // a bare initial is not a seed
			const k = fn + '|' + ln;
			if (ownerCount.get(k) !== 1) continue;
			const hits = candByName.get(k);
			if (!hits || hits.length !== 1) continue;
			raw.push({ ownerRank: o._blockRank, candRank: block.rankOf.get(hits[0].mention_id), owner: o, census: hits[0] });
		}
		raw.sort((a, b) => a.ownerRank - b.ownerRank);
		return CandidateEngine.longestIncreasing(raw, (x) => x.candRank);
	}

	// O(n log n) longest strictly-increasing subsequence, by key.
	static longestIncreasing(items, keyOf) {
		if (!items.length) return [];
		const tailsIdx = [], prev = new Array(items.length).fill(-1);
		const tailVal = [];
		for (let i = 0; i < items.length; i++) {
			const v = keyOf(items[i]);
			let lo = 0, hi = tailVal.length;
			while (lo < hi) { const mid = (lo + hi) >> 1; if (tailVal[mid] < v) lo = mid + 1; else hi = mid; }
			tailVal[lo] = v; tailsIdx[lo] = i;
			prev[i] = lo > 0 ? tailsIdx[lo - 1] : -1;
		}
		const out = [];
		let k = tailsIdx[tailsIdx.length - 1];
		while (k >= 0) { out.push(items[k]); k = prev[k]; }
		return out.reverse();
	}

	// Sensible lambda for this pair of pools. The Fellegi default is sized for a
	// 20k x 25k census pair; an enslaver pass is two orders of magnitude smaller
	// and inheriting the default silently subtracts about four bits from every
	// score.
	static suggestPrior(nOwners, nCandidates, expectedLinkRate = 0.8) {
		if (!nOwners || !nCandidates) return 2e-5;
		return Math.min(0.5, Math.max(1e-9, (nOwners * expectedLinkRate) / (nOwners * nCandidates)));
	}
}

if (typeof window !== 'undefined') window.CandidateEngine = CandidateEngine;
if (typeof module !== 'undefined' && module.exports) module.exports = { CandidateEngine };
