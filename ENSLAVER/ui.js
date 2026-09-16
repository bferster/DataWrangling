// ui.js
// ---------------------------------------------------------------------------
// ReviewUI — the review surface.
//
// The one idea the layout is built around: the ranked candidates are shown in
// their place inside the census sequence, not in a separate list. A detached
// "top three" box throws away the positional evidence, which in 1860 is the
// evidence that decides. Seeing that the top-scoring candidate sits sixty lines
// out of position while the second sits neatly between two confirmed anchors is
// one glance; reading it off two separate panels is not.
//
// Consequences that follow from that and are implemented here:
//   - Confirmed anchors appear in the window as quiet, unselectable context.
//     They can be reopened, because new evidence about this enslaver is
//     sometimes evidence that an earlier decision was wrong.
//   - Unranked records inside the bracket are still shown and still selectable.
//     That is the manual-find channel, and the rate at which reviewers use it
//     is the recall estimate for the matcher.
//   - A ranked candidate that falls outside the bracket is pinned at the edge
//     with its distance, rather than silently dropped.
//   - Nothing is preselected. A preselected top candidate produces agreement
//     with the machine and no way to know it happened.
// ---------------------------------------------------------------------------

class ReviewUI {

	constructor(app, root) {
		this.app = app;
		this.root = root;
		this.blockKey = null;
		this.ownerIndex = 0;
		this.selection = undefined;      // mention_id | null (absent) | undefined
		this.search = '';
		this.windowPad = 22;
		this.maxWindow = 70;
		this._bound = false;
	}

	get state() { return this.app.blockState(this.blockKey); }
	get owners() { const s = this.state; return s ? s.block.owners : []; }
	get owner() { return this.owners[this.ownerIndex] || null; }
	get row() { const s = this.state; return s ? s.rows[this.ownerIndex] : null; }

	mount() {
		this.root.innerHTML = `
			<div class="rail">
				<div class="railhead">
					<select id="blockPick" aria-label="Enumerator block"></select>
					<button id="jumpNext" title="Next undecided (n)">Next</button>
				</div>
				<div class="queue" id="queue" role="listbox" aria-label="Enslavers"></div>
			</div>
			<div class="center">
				<div class="subject" id="subject"></div>
				<div class="windowbar" id="windowbar"></div>
				<div class="rows" id="rows" role="radiogroup" aria-label="Census candidates"></div>
				<div class="decide" id="decide"></div>
			</div>
			<aside class="evidence" id="evidence"></aside>`;
		this.$ = (id) => this.root.querySelector('#' + id);
		this.$('blockPick').addEventListener('change', (e) => this.setBlock(e.target.value));
		this.$('jumpNext').addEventListener('click', () => this.nextUndecided());
		if (!this._bound) {
			document.addEventListener('keydown', (e) => this.onKey(e));
			this._bound = true;
		}
	}

	setBlocks(blocks) {
		const sel = this.$('blockPick');
		sel.innerHTML = blocks.map((b) => {
			const k = b.key === null ? '(unknown)' : b.key;
			return `<option value="${ReviewUI.esc(String(b.key))}">${ReviewUI.esc(k)} — ${b.nOwners} enslavers</option>`;
		}).join('');
		if (blocks.length) this.setBlock(String(blocks[0].key));
	}

	setBlock(key) {
		this.blockKey = key;
		this.ownerIndex = 0;
		this.selection = undefined;
		this.search = '';
		const s = this.state;
		if (s) {
			const first = s.block.owners.findIndex((o) => !this.app.store.get(o.mention_id));
			this.ownerIndex = first >= 0 ? first : 0;
		}
		this.renderAll();
	}

	select(index) {
		if (index < 0 || index >= this.owners.length) return;
		this.ownerIndex = index;
		this.selection = undefined;
		this.search = '';
		this.renderAll();
	}

	nextUndecided() {
		const n = this.owners.length;
		for (let i = 1; i <= n; i++) {
			const j = (this.ownerIndex + i) % n;
			if (!this.app.store.get(this.owners[j].mention_id)) { this.select(j); return; }
		}
		this.select(Math.min(this.ownerIndex + 1, n - 1));
	}

	// ---- anchors and the bracket ------------------------------------------
	// An anchor is any owner in this block already matched to a census record.
	// EPS-derived assignments are anchors from the moment the block is built;
	// human confirmations join them as the reviewer works, which is what makes
	// the window narrow as the pass goes on.
	anchorList() {
		const s = this.state;
		if (!s) return [];
		const out = [];
		for (const o of s.block.owners) {
			const d = this.app.store.get(o.mention_id);
			if (!d || !d.census_id) continue;
			const c = this.app.data.byId.get(d.census_id);
			if (!c) continue;
			const rank = s.block.rankOf.get(d.census_id);
			if (rank == null) continue;
			out.push({ ownerRank: o._blockRank, candRank: rank, owner: o, census: c, decision: d });
		}
		return out.sort((a, b) => a.ownerRank - b.ownerRank);
	}

	bracket() {
		const s = this.state, o = this.owner;
		if (!s || !o) return { lo: 0, hi: 0, prev: null, next: null };
		const anchors = this.anchorList();
		const r = o._blockRank;
		let prev = null, next = null;
		for (const a of anchors) {
			if (a.ownerRank < r && (!prev || a.ownerRank > prev.ownerRank)) prev = a;
			if (a.ownerRank > r && (!next || a.ownerRank < next.ownerRank)) next = a;
		}
		const n = s.block.nCandidates;
		const est = this.row ? this.row.estimate.expected : (r / Math.max(1, s.block.nOwners - 1)) * (n - 1);
		let lo = prev ? prev.candRank : Math.round(est) - this.windowPad;
		let hi = next ? next.candRank : Math.round(est) + this.windowPad;
		lo = Math.max(0, lo); hi = Math.min(n - 1, hi);
		if (hi - lo > this.maxWindow) {
			const c = Math.round(est);
			lo = Math.max(lo, c - Math.floor(this.maxWindow / 2));
			hi = Math.min(hi, lo + this.maxWindow);
		}
		if (hi < lo) hi = lo;
		return { lo, hi, prev, next, est };
	}

	// ---- rendering ---------------------------------------------------------
	renderAll() { this.renderQueue(); this.renderSubject(); this.renderWindow(); this.renderDecide(); this.renderEvidence(); }

	renderQueue() {
		const s = this.state, q = this.$('queue');
		if (!s) { q.innerHTML = ''; return; }
		const conflicts = new Set();
		for (const c of this.app.store.conflicts()) for (const d of c.decisions) conflicts.add(d.owner_id);
		const html = s.block.owners.map((o, i) => {
			const d = this.app.store.get(o.mention_id);
			let cls = 'qrow', st = '';
			if (d && d.outcome === 'matched') { cls += ' done'; st = d.anchored ? 'EPS' : (d.machine ? 'auto' : 'set'); }
			else if (d && d.outcome === 'absent') { cls += ' absent'; st = 'none'; }
			else if (d) { cls += ' absent'; st = 'later'; }
			if (conflicts.has(o.mention_id)) { cls += ' conflict'; st = 'clash'; }
			return `<div class="${cls}" role="option" data-i="${i}" aria-current="${i === this.ownerIndex}" aria-selected="${i === this.ownerIndex}">
				<span class="ln">${o._line == null ? '' : o._line}</span>
				<span class="nm">${ReviewUI.esc(o.full_name || '(no name)')}</span>
				<span class="st">${st}</span></div>`;
		}).join('');
		q.innerHTML = html;
		q.querySelectorAll('.qrow').forEach((el) => {
			el.addEventListener('click', () => this.select(parseInt(el.dataset.i, 10)));
		});
		const cur = q.querySelector('[aria-current="true"]');
		if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest' });
	}

	renderSubject() {
		const o = this.owner, el = this.$('subject');
		if (!o) { el.innerHTML = ''; return; }
		const s = this.state;
		const holding = s.holdingByOwner.get(o.mention_id);
		const ages = holding && holding.people.length
			? holding.people.map((p) => `${p.age || '?'}${(p.gender || '?').toLowerCase()}`).join(' ')
			: '';
		const epsNote = s.epsByOwner && s.epsByOwner.get(o.mention_id);
		el.innerHTML = `
			<div>
				<div class="name">${ReviewUI.esc(o.full_name || '(no name)')}</div>
				<div class="meta">${ReviewUI.esc(o.mention_id)} · block ${ReviewUI.esc(o._enum || 'unknown')} · line ${o._line == null ? '?' : o._line} · ${VeriteData.dateLabel(o._date) || 'no date'}</div>
				<div class="meta faint">enslaver ${this.ownerIndex + 1} of ${this.owners.length} in this block</div>
			</div>
			<div class="holding">
				${holding ? `held ${holding.people.length} ${holding.people.length === 1 ? 'person' : 'people'}` : 'holding not found'}
				${ages ? `<div class="ages small faint">${ReviewUI.esc(ages)}</div>` : ''}
				${epsNote ? `<div class="small" style="margin-top:4px"><span class="badge agree">EPS holding ${epsNote.holdnum}${epsNote.ambiguous ? ' · merged' : ''}</span></div>` : ''}
			</div>`;
	}

	renderWindow() {
		const s = this.state, o = this.owner, host = this.$('rows'), bar = this.$('windowbar');
		if (!s || !o) { host.innerHTML = '<div class="empty">No enslaver selected.</div>'; bar.innerHTML = ''; return; }

		const b = this.bracket();
		const ranked = new Map();
		(this.row ? this.row.candidates : []).forEach((c, i) => ranked.set(c.candidate.mention_id, { ...c, rank: i + 1 }));
		const claims = this.app.store.claims();
		const anchors = new Map();
		for (const a of this.anchorList()) anchors.set(a.census.mention_id, a);

		bar.innerHTML = `
			<span>Census records ${b.lo}–${b.hi} of ${s.block.nCandidates}</span>
			<span class="faint">${b.prev ? 'bracketed by confirmed anchors' : 'no anchor above — estimate only'}</span>
			<input type="search" id="findbox" placeholder="Find anyone in this block" value="${ReviewUI.esc(this.search)}" />`;
		const fb = this.$('findbox');
		fb.addEventListener('input', (e) => { this.search = e.target.value; this.renderWindow(); });

		let list;
		if (this.search.trim()) {
			const q = this.search.trim().toUpperCase();
			list = s.block.candidates.filter((c) => String(c.full_name || '').toUpperCase().includes(q)).slice(0, 60);
		} else {
			// Order candidate options in order of probability of being a match
			const rankedList = (this.row ? this.row.candidates : []).map((c) => c.candidate);
			const rankedIds = new Set(rankedList.map((c) => c.mention_id));
			const bracketFiller = s.block.candidates.slice(b.lo, b.hi + 1).filter((c) => !rankedIds.has(c.mention_id));
			list = [...rankedList, ...bracketFiller];
		}

		const rowsHtml = list.map((c) => this.candidateRow(c, ranked, anchors, claims, b, s.block)).join('');
		const absentChecked = this.selection === null;
		host.innerHTML = rowsHtml + `
			<div class="crow" role="radio" data-absent="1" aria-checked="${absentChecked}">
				<span class="dot"></span><span class="ln"></span>
				<span><span class="who"><span class="n">Not in this census</span></span>
				<div class="sub faint">non-resident, died, estate, or simply not enumerated here</div></span>
				<span></span>
			</div>`;

		host.querySelectorAll('.crow').forEach((el) => {
			if (el.classList.contains('anchor')) {
				const btn = el.querySelector('.reopen');
				if (btn) btn.addEventListener('click', (ev) => { ev.stopPropagation(); this.reopen(el.dataset.id); });
				return;
			}
			el.addEventListener('click', () => {
				this.selection = el.dataset.absent ? null : el.dataset.id;
				this.renderWindow(); this.renderDecide(); this.renderEvidence();
			});
		});
	}

	candidateRow(c, ranked, anchors, claims, b, block) {
		const id = c.mention_id;
		const cRank = block.rankOf.get(id);
		const r = ranked.get(id);
		const anchor = anchors.get(id);
		const claim = claims.get(id);
		const outside = cRank == null || cRank < b.lo || cRank > b.hi;

		if (anchor && anchor.owner.mention_id !== this.owner.mention_id) {
			return `<div class="crow anchor" data-id="${ReviewUI.esc(id)}">
				<span class="dot"></span>
				<span class="ln">${c._line == null ? '' : c._line}</span>
				<span><span class="who"><span class="n">${ReviewUI.esc(c.full_name || '')}</span>
					<span class="badge agree">anchor</span></span>
					<div class="sub">matched to ${ReviewUI.esc(anchor.owner.full_name || anchor.owner.mention_id)}${anchor.decision.anchored ? ' · EPS' : ''}</div></span>
				<button class="reopen" type="button">Reopen</button></div>`;
		}

		const classes = ['crow'];
		if (outside) classes.push('outside');
		if (claim && claim.some((d) => d.owner_id !== this.owner.mention_id)) classes.push('claimed');
		if (!r) classes.push('filler');
		const checked = this.selection === id;

		const badges = [];
		if (r) {
			badges.push(`<span class="badge">${r.rank} · ${r.totalBits.toFixed(1)} bits</span>`);
			if (r.via === 'position') badges.push('<span class="badge quiet">position only</span>');
			if (r.via === 'name') badges.push('<span class="badge quiet">name only</span>');
			if (r.anchored) badges.push('<span class="badge agree">EPS</span>');
		}
		if (claim && claim.some((d) => d.owner_id !== this.owner.mention_id)) {
			const other = claim.find((d) => d.owner_id !== this.owner.mention_id);
			badges.push(`<span class="badge bad">claimed by ${ReviewUI.esc(other.owner_name || other.owner_id)}</span>`);
		}
		if (outside) {
			const d = cRank == null ? 0 : (cRank < b.lo ? (b.lo - cRank) : (cRank - b.hi));
			badges.push(`<span class="badge warn">${d} outside the bracket</span>`);
		}

		const bits = [];
		if (c.birth_year) bits.push('b. ' + c.birth_year);
		if (c.birth_place) bits.push(c.birth_place);
		if (c._head) bits.push('head');
		if (c._prop != null && c._prop > 0) bits.push('$' + c._prop);
		if (c._date != null) bits.push(VeriteData.dateLabel(c._date));
		if (r && r.deltaRank != null) bits.push((r.deltaRank >= 0 ? '+' : '') + r.deltaRank + ' pos');
		if (r && r.deltaDays != null) bits.push((r.deltaDays >= 0 ? '+' : '') + r.deltaDays + 'd');

		return `<div class="${classes.join(' ')}" role="radio" data-id="${ReviewUI.esc(id)}" aria-checked="${checked}">
			<span class="dot"></span>
			<span class="ln">${c._line == null ? '' : c._line}</span>
			<span><span class="who"><span class="n">${ReviewUI.esc(c.full_name || '(no name)')}</span>${badges.join(' ')}</span>
			<div class="sub">${ReviewUI.esc(bits.join(' · '))}</div></span>
			<span></span></div>`;
	}

	renderDecide() {
		const el = this.$('decide'), o = this.owner;
		if (!o) { el.innerHTML = ''; return; }
		const existing = this.app.store.get(o.mention_id);
		const canConfirm = this.selection !== undefined;
		el.innerHTML = `
			<button id="confirm" class="primary" ${canConfirm ? '' : 'disabled'}>Confirm</button>
			<label class="small dim"><input type="checkbox" id="unsure" /> mark as probable</label>
			<button id="defer">Decide later</button>
			${existing ? '<button id="undo">Clear this decision</button>' : ''}
			<span class="hint">1–9 pick · 0 not present · enter confirm · n next</span>`;
		this.$('confirm').addEventListener('click', () => this.commit());
		this.$('defer').addEventListener('click', () => this.defer());
		const undo = this.root.querySelector('#undo');
		if (undo) undo.addEventListener('click', () => { this.app.store.clear(o.mention_id); this.selection = undefined; this.renderAll(); });
	}

	renderEvidence() {
		const el = this.$('evidence');
		const r = this.row;
		if (!r) { el.innerHTML = ''; return; }
		const sel = this.selection;
		const pick = (r.candidates || []).find((c) => c.candidate.mention_id === sel) || r.candidates[0];
		if (!pick) { el.innerHTML = '<div class="empty small">No candidate scored for this enslaver. Use the search box.</div>'; return; }

		const f = pick.fellegi;
		const fields = f && f.fields ? f.fields.filter((x) => Math.abs(x.bits) > 0.01) : [];
		const maxAbs = Math.max(1, ...fields.map((x) => Math.abs(x.bits)), Math.abs(pick.positionBits));
		const barFor = (bits) => {
			const w = Math.min(100, Math.abs(bits) / maxAbs * 100);
			return `<div class="bar"><i class="${bits < 0 ? 'neg' : ''}" style="width:${w.toFixed(0)}%"></i></div>`;
		};
		const est = r.estimate;
		el.innerHTML = `
			<div class="group">
				<h3>Why this candidate</h3>
				<table>
					${fields.map((x) => `<tr><td class="k">${ReviewUI.esc(x.field)} <span class="faint">${ReviewUI.esc(x.level)}</span>${barFor(x.bits)}</td><td class="v">${x.bits > 0 ? '+' : ''}${x.bits.toFixed(2)}</td></tr>`).join('')}
					<tr><td class="k">position${barFor(pick.positionBits)}</td><td class="v">${pick.positionBits > 0 ? '+' : ''}${pick.positionBits.toFixed(2)}</td></tr>
					${pick.contextBits ? `<tr><td class="k">head / property</td><td class="v">+${pick.contextBits.toFixed(2)}</td></tr>` : ''}
					<tr><td class="k"><strong>total</strong></td><td class="v"><strong>${pick.totalBits.toFixed(2)} bits</strong></td></tr>
				</table>
			</div>
			<div class="group">
				<h3>Position</h3>
				<table>
					<tr><td class="k">expected rank</td><td class="v">${Math.round(est.expected)}</td></tr>
					<tr><td class="k">sigma</td><td class="v">±${Math.round(est.sigma)}</td></tr>
					<tr><td class="k">this candidate</td><td class="v">${pick.candRank}</td></tr>
					<tr><td class="k">anchors used</td><td class="v">${(est.bracket || []).filter(Boolean).length}</td></tr>
				</table>
			</div>
			<div class="group">
				<h3>Margin over the next</h3>
				<table>
					<tr><td class="k">runner-up</td><td class="v">${r.candidates[1] ? r.candidates[1].totalBits.toFixed(2) : '—'}</td></tr>
					<tr><td class="k">gap</td><td class="v">${r.candidates[1] ? (r.candidates[0].totalBits - r.candidates[1].totalBits).toFixed(2) : '—'}</td></tr>
					<tr><td class="k">considered</td><td class="v">${r.consideredCount}</td></tr>
				</table>
			</div>`;
	}

	// ---- actions -----------------------------------------------------------
	commit() {
		const o = this.owner;
		if (!o || this.selection === undefined) return;
		const r = this.row;
		const presented = r ? r.candidates : [];
		const unsure = this.root.querySelector('#unsure');
		const cand = this.selection === null ? null : this.app.data.byId.get(this.selection);

		if (cand) {
			const claims = this.app.store.claims().get(cand.mention_id);
			const other = claims && claims.find((d) => d.owner_id !== o.mention_id);
			if (other) {
				const ok = confirm(
					`${cand.full_name} is already matched to ${other.owner_name}.\n\n` +
					'Record this match anyway? Both will be flagged so you can settle it, ' +
					'and the earlier decision stays until you change it.');
				if (!ok) return;
			}
		}

		this.app.store.record(o, cand, presented, {
			outcome: cand ? 'matched' : 'absent',
			confidence: unsure && unsure.checked ? 'probable' : 'certain',
			anchored: !!(this.state.epsByOwner && this.state.epsByOwner.get(o.mention_id)
				&& cand && this.state.epsByOwner.get(o.mention_id).census.mention_id === cand.mention_id),
		});
		this.app.onDecision();
		this.nextUndecided();
	}

	defer() {
		const o = this.owner;
		if (!o) return;
		const r = this.row;
		this.app.store.record(o, null, r ? r.candidates : [], { outcome: 'deferred' });
		this.app.onDecision();
		this.nextUndecided();
	}

	reopen(censusId) {
		const a = this.anchorList().find((x) => x.census.mention_id === censusId);
		if (!a) return;
		const i = this.owners.indexOf(a.owner);
		if (i >= 0) this.select(i);
	}

	onKey(e) {
		if (!this.root.classList.contains('active')) return;
		const tag = (e.target && e.target.tagName) || '';
		if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
			if (e.key === 'Escape') { e.target.blur(); }
			return;
		}
		const r = this.row;
		if (e.key >= '1' && e.key <= '9') {
			const i = parseInt(e.key, 10) - 1;
			if (r && r.candidates[i]) {
				this.selection = r.candidates[i].candidate.mention_id;
				this.renderWindow(); this.renderDecide(); this.renderEvidence();
			}
			e.preventDefault(); return;
		}
		if (e.key === '0') { this.selection = null; this.renderWindow(); this.renderDecide(); e.preventDefault(); return; }
		if (e.key === 'Enter') { this.commit(); e.preventDefault(); return; }
		if (e.key === 'n') { this.nextUndecided(); e.preventDefault(); return; }
		if (e.key === 'ArrowDown' || e.key === 'j') { this.select(this.ownerIndex + 1); e.preventDefault(); return; }
		if (e.key === 'ArrowUp' || e.key === 'k') { this.select(this.ownerIndex - 1); e.preventDefault(); return; }
		if (e.key === '/') { const f = this.root.querySelector('#findbox'); if (f) { f.focus(); e.preventDefault(); } }
	}

	static esc(s) {
		return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
			{ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
	}
}

if (typeof window !== 'undefined') window.ReviewUI = ReviewUI;
if (typeof module !== 'undefined' && module.exports) module.exports = { ReviewUI };
