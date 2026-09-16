// app.js
// ---------------------------------------------------------------------------
// App — wiring.
//
// Order of operations, and the reason for it:
//
//   1. Load mentions, then the EPS file for the year being worked.
//   2. Align EPS holdings to ours. This runs BEFORE any census matching,
//      because it is what detects holdings our ingest split in two, and the
//      census pass should work against corrected holdings rather than
//      propagate the error.
//   3. Turn the EPS holdings that carry a resolvable HISTID into anchors. These
//      are links IPUMS already made and we are only carrying across.
//   4. Rank candidates per block, seeded with those anchors.
//   5. Align the block as a sequence, and triage.
//   6. Review what is left.
//
// Work 1850 first and carry it into 1860. 1850 has almost no bare initials and
// it has prop_value; 1860 has neither. The anchors and the households that come
// out of a finished 1850 pass are the strongest evidence available for the
// 1860 pass, where the name frequently cannot decide on its own.
// ---------------------------------------------------------------------------

class App {

	constructor() {
		this.data = new VeriteData();
		this.eps = { 1850: null, 1860: null };
		this.match = new Match();
		this.fellegi = new Fellegi({ match: this.match });
		this.engine = null;
		this.aligner = new SequenceAligner();
		this.store = new ReviewStore();
		this.county = null;
		this.year = 1850;
		this.blocks = [];
		this._blockCache = new Map();
		this.holdingAlignment = null;
		this.epsAnchors = new Map();       // owner mention_id -> { census, holdnum, ambiguous }
		this.ui = null;
		this.loaded = { mentions: false, eps1850: false, eps1860: false };
	}

	// ---- loading -----------------------------------------------------------

	async loadMentions(text, onProgress) {
		await this.data.loadMentions(text, onProgress);
		this.loaded.mentions = true;
		const counties = [...this.data.counties].sort();
		this.county = this.county || counties[0] || null;
		return { rows: this.data.mentions.length, counties };
	}

	loadEps(year, text) {
		const e = new EpsSource(year).load(text);
		this.eps[year] = e;
		this.loaded['eps' + year] = true;
		return { holdings: e.holdings.length, rows: e.rows.length, guid: e.idLooksLikeGuid };
	}

	// ---- preparation -------------------------------------------------------

	diagnostics() {
		const d = new Diagnostics(this.data, this.fellegi);
		return d.run(this.county, this.year, this.eps[this.year]);
	}

	// Phase 2 + 3: holdings, then anchors.
	prepare(opts = {}) {
		this._blockCache.clear();
		this.epsAnchors.clear();
		this.holdingAlignment = null;

		const ours = this.data.holdings(this.county, this.year);
		const eps = this.eps[this.year];

		if (eps) {
			const ha = new HoldingAligner(opts.holding || {});
			const result = ha.align(ours, eps.holdings);
			eps.joinReport(this.data);
			this.holdingAlignment = {
				result,
				report: ha.report(result, ours, eps.holdings),
				anchors: ha.anchors(result, this.data),
			};
			for (const a of this.holdingAlignment.anchors) {
				this.epsAnchors.set(a.owner.mention_id, a);
			}
		}

		this.blocks = this.data.blocks(this.county, this.year);
		this.blocks.forEach((b) => { b.year = this.year; });

		// Name frequencies for value-specific u. Taken on the candidate pool for
		// this year, not the whole corpus: agreement on "Bell" is weak evidence
		// in Augusta and the weight should say so with Augusta's counts.
		const pool = this.data.censusPool(this.county, this.year);
		this.fellegi.usePool(pool);

		// A lambda sized for THIS pair of pools. The library default is built for
		// a 20k x 25k census pair; inheriting it here quietly removes about four
		// bits from every score.
		const nOwners = this.data.owners(this.county, this.year).length;
		this.prior = CandidateEngine.suggestPrior(nOwners, pool.length, opts.expectedLinkRate || 0.8);
		this.fellegi.prior = this.prior;

		this.engine = new CandidateEngine(this.fellegi, opts.engine || {});

		// Seed the EPS anchors into the store as machine decisions so they show
		// as anchors immediately and are exported with who = EPS.
		for (const [ownerId, a] of this.epsAnchors.entries()) {
			if (this.store.get(ownerId)) continue;
			if (a.ambiguous) continue;        // merged holding: the second holder is
			                                  // an employer or co-owner, not a safe
			                                  // automatic assignment
			this.store.record(a.owner, a.census, [], {
				outcome: 'matched', anchored: true, machine: true, method: 'EPS',
				note: 'EPS holding ' + a.holdnum,
			});
		}

		return {
			blocks: this.blocks.length,
			owners: nOwners,
			prior: this.prior,
			epsAnchors: this.epsAnchors.size,
			holdings: this.holdingAlignment ? this.holdingAlignment.report : null,
		};
	}

	// ---- per-block computation --------------------------------------------
	// Ranking a 530-enslaver block takes about a second. Re-running it after
	// every decision would put a second between the reviewer and the screen, so
	// only the enslavers whose bracket actually moved are re-ranked. A decision
	// changes the estimate for the enslavers between its two neighbouring
	// anchors and for nobody else.

	blockState(key) {
		const k = String(key);
		let state = this._blockCache.get(k);
		if (state) { this._refresh(state); return state; }

		const block = this.blocks.find((b) => String(b.key) === k);
		if (!block) return null;

		const index = this.engine.buildIndex(block.candidates);
		const seeds = this.engine.seedAnchors(block);
		const seedByOwner = new Map();
		for (const s of seeds) seedByOwner.set(s.owner.mention_id, s);

		const epsByOwner = new Map();
		for (const o of block.owners) {
			const a = this.epsAnchors.get(o.mention_id);
			if (a) epsByOwner.set(o.mention_id, a);
		}

		const holdingByOwner = new Map();
		for (const h of this.data.holdings(this.county, this.year)) {
			if (h.owner) holdingByOwner.set(h.owner.mention_id, h);
		}

		state = {
			key: k, block, index, seeds, seedByOwner, epsByOwner, holdingByOwner,
			rows: new Array(block.owners.length).fill(null),
			rowKey: new Array(block.owners.length).fill(null),
			anchorIndex: [],
		};
		this._blockCache.set(k, state);
		this._refresh(state, true);
		return state;
	}

	// Anchors that steer the estimate. Confirmed decisions first; seeds fill the
	// gaps until they are confirmed or overturned. A confirmed decision always
	// wins over the seed for the same enslaver.
	_anchorIndex(state) {
		const out = new Map();
		for (const s of state.seeds) out.set(s.owner.mention_id, { ownerRank: s.ownerRank, candRank: s.candRank, kind: 'seed' });
		for (const o of state.block.owners) {
			const d = this.store.get(o.mention_id);
			if (!d) continue;
			if (!d.census_id) { out.delete(o.mention_id); continue; }
			const rank = state.block.rankOf.get(d.census_id);
			if (rank != null) {
				out.set(o.mention_id, { ownerRank: o._blockRank, candRank: rank, kind: d.anchored ? 'eps' : 'confirmed' });
			}
		}
		return [...out.values()].sort((a, b) => a.ownerRank - b.ownerRank);
	}

	_refresh(state, force = false) {
		const anchors = this._anchorIndex(state);
		state.anchorIndex = anchors;
		const ranks = anchors.map((a) => a.ownerRank);
		// The cache key for an enslaver is the pair of anchors bracketing it.
		// Same bracket, same estimate, same ranking.
		const bracketKey = (r) => {
			let lo = -1, hi = -1;
			for (const a of anchors) {
				if (a.ownerRank < r) lo = a.ownerRank;
				else if (a.ownerRank > r) { hi = a.ownerRank; break; }
				else { lo = a.ownerRank; hi = a.ownerRank; break; }
			}
			return lo + ':' + hi;
		};
		void ranks;
		let n = 0;
		for (let i = 0; i < state.block.owners.length; i++) {
			const o = state.block.owners[i];
			const key = bracketKey(o._blockRank);
			if (!force && state.rowKey[i] === key && state.rows[i]) continue;
			state.rows[i] = this.engine.rankOwner(o, state.block, state.index, anchors, { prior: this.prior });
			state.rowKey[i] = key;
			n++;
		}
		state.lastRecomputed = n;
		return n;
	}

	// Sequence alignment + triage for one block. Separate from blockState so the
	// reviewer can work without paying for it, and so a run of it is an explicit
	// act with an explicit report.
	alignBlock(key, opts = {}) {
		const s = this.blockState(key);
		if (!s) return null;
		const anchors = new Map();
		for (const o of s.block.owners) {
			const d = this.store.get(o.mention_id);
			if (d && d.census_id && (d.anchored || d.machine)) {
				const c = this.data.byId.get(d.census_id);
				if (c) anchors.set(o.mention_id, c);
			}
		}
		const res = this.aligner.align(s.rows, anchors, s.block);
		res.triage = this.aligner.triage(res.assignments, opts.triage || {});
		s.alignment = res;
		return res;
	}

	// Accept the high-confidence tail of an alignment without review, recorded
	// as machine decisions so the auto-accepted rows can be audited later and
	// sampled for an error rate.
	acceptAuto(key, opts = {}) {
		const res = this.alignBlock(key, opts);
		if (!res) return 0;
		let n = 0;
		for (const a of res.triage.auto) {
			if (this.store.get(a.owner.mention_id)) continue;
			this.store.record(a.owner, a.candidate, a.row.candidates, {
				outcome: 'matched', machine: true, method: 'FS+v1',
				note: `alignment ${a.bits} bits, margin ${a.marginBits}`,
			});
			n++;
		}
		this.onDecision();
		return n;
	}

	onDecision() {
		// Deliberately not a cache clear: _refresh re-ranks only the enslavers
		// whose bracket moved, which is a handful rather than the whole block.
		if (this.ui) { this.ui.renderQueue(); }
		if (typeof document !== 'undefined') {
			document.dispatchEvent(new CustomEvent('verite:decision', { detail: this.store.stats() }));
		}
	}

	// ---- exports -----------------------------------------------------------

	exportAssertions() {
		const name = `enslavers-${this.county}-${this.year}-${App.stamp()}.csv`;
		ReviewStore.download(name, this.store.toAssertionCsv({ version: 'FS+v1' }), 'text/csv');
		return name;
	}

	exportSession() {
		const name = `session-${this.county}-${this.year}-${App.stamp()}.json`;
		ReviewStore.download(name, this.store.toSessionJson({
			prior: this.prior,
			fellegiParams: this.fellegi.exportParams(),
			holdingReport: this.holdingAlignment ? this.holdingAlignment.report : null,
		}), 'application/json');
		return name;
	}

	exportHoldingReport() {
		if (!this.holdingAlignment) return null;
		const rows = [];
		for (const p of this.holdingAlignment.result.pairs) {
			const ourSize = p.ours.reduce((a, x) => a + x.size, 0);
			rows.push({
				eps_holdnum: p.eps.holdnum,
				eps_size: p.eps.size,
				our_holdings: p.ours.map((x) => x.household_id).join(' '),
				our_owner_ids: p.ours.map((x) => x.owner ? x.owner.mention_id : '').join(' '),
				our_owner_names: p.ours.map((x) => x.owner ? x.owner.full_name : '').join(' | '),
				our_size: ourSize,
				span: p.span,
				suspected_split: p.span > 1 ? 'yes' : '',
				size_difference: ourSize - p.eps.size,
				composition_score: p.score.toFixed(3),
				eps_histid: p.eps.histid,
				eps_nholders: p.eps.nholders == null ? '' : p.eps.nholders,
			});
		}
		const name = `holdings-${this.county}-${this.year}-${App.stamp()}.csv`;
		ReviewStore.download(name, CSV.stringify(rows), 'text/csv');
		return name;
	}

	static stamp() {
		const d = new Date();
		const p = (n) => String(n).padStart(2, '0');
		return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
	}
}

if (typeof window !== 'undefined') window.App = App;
if (typeof module !== 'undefined' && module.exports) module.exports = { App };
