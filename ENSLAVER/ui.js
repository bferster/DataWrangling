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

	// Play a gentle, warm, soft chime when a match is confirmed.
	// Uses the Web Audio API with a shared AudioContext.
	static playMatchSound() {
		try {
			const AudioCtx = window.AudioContext || window.webkitAudioContext;
			if (!AudioCtx) return;
			if (!ReviewUI._audioCtx || ReviewUI._audioCtx.state === 'closed') {
				ReviewUI._audioCtx = new AudioCtx();
			}
			const ctx = ReviewUI._audioCtx;

			const play = () => {
				const now = ctx.currentTime;

				// Master lowpass filter to remove any harsh treble edge
				const filter = ctx.createBiquadFilter();
				filter.type = 'lowpass';
				filter.frequency.setValueAtTime(1400, now);
				filter.connect(ctx.destination);

				// Tone 1: Gentle warm root (D5 - 587.3 Hz)
				const osc1 = ctx.createOscillator();
				const gain1 = ctx.createGain();
				osc1.type = 'sine';
				osc1.frequency.setValueAtTime(587.33, now);
				gain1.gain.setValueAtTime(0.0001, now);
				gain1.gain.linearRampToValueAtTime(0.08, now + 0.02);
				gain1.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
				osc1.connect(gain1);
				gain1.connect(filter);
				osc1.start(now);
				osc1.stop(now + 0.38);

				// Tone 2: Soft harmonic fifth (A5 - 880 Hz), slightly delayed for an elegant subtle chime
				const osc2 = ctx.createOscillator();
				const gain2 = ctx.createGain();
				osc2.type = 'sine';
				osc2.frequency.setValueAtTime(880.0, now + 0.04);
				gain2.gain.setValueAtTime(0.0001, now);
				gain2.gain.setValueAtTime(0.0001, now + 0.04);
				gain2.gain.linearRampToValueAtTime(0.06, now + 0.06);
				gain2.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);
				osc2.connect(gain2);
				gain2.connect(filter);
				osc2.start(now + 0.04);
				osc2.stop(now + 0.48);
			};

			if (ctx.state === 'suspended') {
				ctx.resume().then(play).catch(play);
			} else {
				play();
			}
		} catch (_) { /* audio not available — silent fail */ }
	}

	// Highlight agreeing vs conflicting name tokens between subject and candidate
	static highlightNameDiff(subjectName, candName) {
		if (!candName) return '(no name)';
		if (!subjectName) return ReviewUI.esc(candName);

		const subjTokens = String(subjectName).toUpperCase().split(/[^A-Za-z0-9]+/).filter(Boolean);
		if (!subjTokens.length) return ReviewUI.esc(candName);

		const sFirst = subjTokens[0];
		const sLast = subjTokens[subjTokens.length - 1];

		// Split candName while preserving whitespace and punctuation
		const parts = String(candName).split(/(\s+|[.,;:\/]+)/);

		// Identify non-empty clean tokens and their indices
		const words = [];
		for (let i = 0; i < parts.length; i++) {
			const clean = parts[i].toUpperCase().replace(/[^A-Z0-9]/g, '');
			if (clean) words.push({ partIdx: i, clean });
		}
		if (!words.length) return ReviewUI.esc(candName);

		const statusByPartIdx = new Map();

		for (let w = 0; w < words.length; w++) {
			const { partIdx, clean } = words[w];
			let status = 'conflict';

			if (['JR', 'SR', 'II', 'III', 'IV'].includes(clean)) {
				status = 'neutral';
			} else if (words.length > 1 && w === words.length - 1) {
				// Surname comparison: compare against sLast
				if (clean === sLast || (typeof Match !== 'undefined' && Match.jaro && Match.jaro(clean, sLast) >= 0.85)) {
					status = 'agree';
				} else {
					status = 'conflict';
				}
			} else if (w === 0) {
				// Given name comparison: compare against sFirst
				if (clean === sFirst) {
					status = 'agree';
				} else if (typeof Match !== 'undefined' && Match.DEFAULT_NICKNAMES && (Match.DEFAULT_NICKNAMES[clean] === sFirst || Match.DEFAULT_NICKNAMES[sFirst] === clean)) {
					status = 'agree';
				} else if ((clean.length === 1 && sFirst.startsWith(clean)) || (sFirst.length === 1 && clean.startsWith(sFirst))) {
					status = 'agree';
				} else if (typeof Match !== 'undefined' && Match.jaro && Match.jaro(clean, sFirst) >= 0.85) {
					status = 'agree';
				} else {
					status = 'conflict';
				}
			} else {
				// Middle tokens: check against any intermediate subject tokens
				const middleSubj = subjTokens.slice(1, subjTokens.length - 1);
				if (middleSubj.some((st) => st === clean || (clean.length === 1 && st.startsWith(clean)))) {
					status = 'agree';
				} else {
					status = 'neutral';
				}
			}
			statusByPartIdx.set(partIdx, status);
		}

		const out = [];
		for (let i = 0; i < parts.length; i++) {
			const st = statusByPartIdx.get(i);
			if (st === 'agree') {
				out.push(`<mark class="token-agree">${ReviewUI.esc(parts[i])}</mark>`);
			} else if (st === 'conflict') {
				out.push(`<mark class="token-conflict">${ReviewUI.esc(parts[i])}</mark>`);
			} else if (st === 'neutral') {
				out.push(`<span class="token-neutral">${ReviewUI.esc(parts[i])}</span>`);
			} else {
				out.push(ReviewUI.esc(parts[i]));
			}
		}
		return out.join('');
	}

	constructor(app, root) {
		this.app = app;
		this.root = root;
		this.ownerIndex = 0;
		this.selection = undefined;      // mention_id | null (absent) | undefined
		this.search = '';
		this._candidateSearchDraft = '';
		this._candidateSearchStatus = '';
		this.windowPad = 22;
		this.maxWindow = 70;
		this._bound = false;
		this.censusSearch = '';
		this._censusSearchDraft = '';
		this.selectedCensusId = null;
		this.headsOnly = false;
		this.menOnly = false;
		this.queueFilter = 'all';
		this._censusStart = 0;
		this._censusEnd = 80;
		this._cachedCensus = null;
		this._cachedCensusKey = null;
		this._currentFilteredCensusCount = 0;
		this._searchStatus = '';
	}

	get owners() {
		const key = `${this.app.county}-${this.app.year}`;
		if (this._cachedOwnersKey !== key || !this._cachedOwners) {
			this._cachedOwnersKey = key;
			this._cachedOwners = this.app.data.owners(this.app.county, this.app.year);
		}
		return this._cachedOwners || [];
	}
	get owner() { return this.owners[this.ownerIndex] || null; }
	get state() { return this.app.blockState(); }
	get row() { return this.owner ? this.app.rowFor(this.owner) : null; }

	mount() {
		this.root.innerHTML = `
			<div class="rail">
				<div class="railhead" style="display:flex;align-items:center;gap:8px;padding:6px 10px;border-bottom:1px solid var(--rule);background:var(--surface);">
					<span class="rail-title" id="railTitle" style="font-weight:600;font-size:13px;color:var(--ink);white-space:nowrap;flex-shrink:0;">Enslavers <span class="faint" id="queueCount"></span></span>
					<select id="queueFilter" aria-label="Filter enslavers by status" title="Filter enslavers by status" style="flex:0 1 auto;min-width:90px;font-size:11px;font-weight:500;padding:2px 8px;border-radius:9999px;border:1px solid var(--rule-strong);background:var(--surface);color:var(--ink);cursor:pointer;">
						<option value="all">All</option>
						<option value="blank">Blank</option>
						<option value="pending">EPS pending</option>
						<option value="auto">Auto</option>
						<option value="set">Set</option>
						<option value="clash">Clash</option>
					</select>
				</div>
				<div class="queue" id="queue" role="listbox" aria-label="Enslavers"></div>
			</div>
			<div class="center">
				<div class="subject" id="subject"></div>
				<div class="census-split">
					<div class="split-top" id="splitTop">
						<div class="windowbar" id="windowbar"></div>
						<div class="rows" id="rows" role="radiogroup" aria-label="Census candidates"></div>
					</div>
					<div class="split-resizer" id="splitResizer" title="Drag to resize"></div>
					<div class="split-bottom" id="splitBottom">
						<div class="headsbar" id="headsbar"></div>
						<div class="heads-rows" id="headsRows" role="radiogroup" aria-label="Census records"></div>
					</div>
				</div>
				<div class="decide" id="decide"></div>
			</div>
			<aside class="evidence" id="evidence"></aside>`;
		this.$ = (id) => this.root.querySelector('#' + id);

		const queueEl = this.$('queue');
		if (queueEl) {
			queueEl.addEventListener('click', (e) => {
				const row = e.target.closest('.qrow');
				if (row && row.dataset.i != null) {
					this.select(parseInt(row.dataset.i, 10));
				}
			});
		}

		const filterEl = this.$('queueFilter');
		if (filterEl) {
			filterEl.addEventListener('change', (e) => {
				this.queueFilter = e.target.value;
				this.renderQueue();
				const q = this.$('queue');
				const firstRow = q ? q.querySelector('.qrow') : null;
				if (firstRow && firstRow.dataset.i != null) {
					const curVisible = q.querySelector(`[data-i="${this.ownerIndex}"]`);
					if (!curVisible) {
						this.select(parseInt(firstRow.dataset.i, 10));
					}
				}
			});
		}

		this._initResizer();

		const headsRows = this.$('headsRows');
		if (headsRows) {
			headsRows.addEventListener('click', (e) => {
				const row = e.target.closest('.hrow');
				if (!row || !row.dataset.id) return;
				this.selectCensusPerson(row.dataset.id);
			});

			headsRows.addEventListener('dblclick', (e) => {
				const row = e.target.closest('.hrow');
				if (row && row.dataset.id) {
					this.matchPerson(row.dataset.id);
				}
			});
			headsRows.addEventListener('scroll', () => {
				if (headsRows.scrollTop + headsRows.clientHeight >= headsRows.scrollHeight - 160) {
					this.loadMoreCensus();
				} else if (headsRows.scrollTop <= 60 && this._censusStart > 0) {
					this.loadEarlierCensus();
				}
			});
		}

		if (!this._bound) {
			document.addEventListener('keydown', (e) => this.onKey(e));
			this._bound = true;
		}
	}

	_initResizer() {
		const resizer = this.$('splitResizer');
		const topPane = this.$('splitTop');
		const bottomPane = this.$('splitBottom');
		const container = this.root.querySelector('.census-split');
		if (!resizer || !topPane || !bottomPane || !container) return;
		let isDragging = false;
		resizer.addEventListener('mousedown', (e) => {
			isDragging = true;
			resizer.classList.add('dragging');
			document.body.style.cursor = 'row-resize';
			document.body.style.userSelect = 'none';
			e.preventDefault();
		});
		document.addEventListener('mousemove', (e) => {
			if (!isDragging) return;
			const rect = container.getBoundingClientRect();
			const offset = e.clientY - rect.top;
			const total = rect.height;
			if (offset > 80 && offset < total - 80) {
				const pct = (offset / total) * 100;
				topPane.style.flex = `0 0 ${pct}%`;
				bottomPane.style.flex = `0 0 ${100 - pct}%`;
			}
		});
		document.addEventListener('mouseup', () => {
			if (isDragging) {
				isDragging = false;
				resizer.classList.remove('dragging');
				document.body.style.cursor = '';
				document.body.style.userSelect = '';
			}
		});
	}

	setBlocks() {
		this._cachedOwners = null;
		this._cachedOwnersKey = null;
		this.ownerIndex = 0;
		this.search = '';
		this._candidateSearchDraft = '';
		this._candidateSearchStatus = '';
		this._censusStart = 0;
		this._censusEnd = 80;
		this._searchStatus = '';
		const first = this.owners.findIndex((o) => !this.app.store.get(o.mention_id));
		this.ownerIndex = first >= 0 ? first : 0;
		this._initSelection();
		this.renderAll();
	}

	setBlock() {
		this.setBlocks();
	}

	select(index) {
		if (index < 0 || index >= this.owners.length) return;
		const prevIndex = this.ownerIndex;
		this.ownerIndex = index;
		this.search = '';
		this._candidateSearchDraft = '';
		this._candidateSearchStatus = '';
		this.censusSearch = '';
		this._censusSearchDraft = '';
		this._searchStatus = '';
		this._initSelection();

		const q = this.$('queue');
		const curRow = q ? q.querySelector(`[data-i="${index}"]`) : null;
		if (curRow) {
			const prevRow = q.querySelector(`[data-i="${prevIndex}"]`);
			if (prevRow) {
				prevRow.setAttribute('aria-current', 'false');
				prevRow.setAttribute('aria-selected', 'false');
			}
			curRow.setAttribute('aria-current', 'true');
			curRow.setAttribute('aria-selected', 'true');
			if (curRow.scrollIntoView) curRow.scrollIntoView({ block: 'nearest' });
			this.renderSubject();
			this.renderWindow();
			this.renderCensus(false, true);
			this.renderDecide();
			this.renderEvidence();
		} else {
			this.renderAll();
		}
	}

	_initSelection() {
		const o = this.owners[this.ownerIndex];
		if (!o) { this.selection = undefined; this.selectedCensusId = null; return; }
		const d = this.app.store.get(o.mention_id);
		const r = this.row;
		const topCand = r && r.candidates && r.candidates[0] ? r.candidates[0].candidate : null;
		const eps = this.state && this.state.epsByOwner && this.state.epsByOwner.get(o.mention_id);
		const closest = topCand || (eps && eps.census ? eps.census : null);
		const closestId = closest ? closest.mention_id : null;

		if (d && d.outcome === 'matched') {
			this.selection = d.census_id;
			this.selectedCensusId = d.census_id;
		} else if (d && d.outcome === 'absent') {
			this.selection = null;
			this.selectedCensusId = closestId;
		} else {
			this.selection = closestId || undefined;
			this.selectedCensusId = closestId;
		}
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
	renderAll() {
		this.renderQueue();
		this.renderSubject();
		this.renderWindow();
		this.renderCensus();
		this.renderDecide();
		this.renderEvidence();
	}

	setSelection(id) {
		this.selection = id;
		this.selectedCensusId = (id && id !== null) ? id : null;
		this.renderWindow();
		this.renderCensus(false, true);
		this.renderDecide();
		this.renderEvidence();
	}

	getCensusPeople() {
		const key = `${this.app.county}-${this.app.year}`;
		if (this._cachedCensusKey === key && this._cachedCensus) {
			return this._cachedCensus;
		}
		this._cachedCensusKey = key;
		this._cachedCensus = this.app.data.census(this.app.county, this.app.year);
		return this._cachedCensus;
	}

	renderCensus(resetScroll = false, recenter = true) {
		const bar = this.$('headsbar');
		const host = this.$('headsRows');
		if (!bar || !host) return;

		const allPeople = this.getCensusPeople();

		let filtered = allPeople;
		if (this.headsOnly) {
			filtered = filtered.filter((h) => h._head);
		}
		if (this.menOnly) {
			filtered = filtered.filter((h) => String(h.gender || '').toUpperCase() === 'M');
		}

		if (this.censusSearch.trim()) {
			const q = this.censusSearch.trim().toUpperCase();
			const isNum = /^\d+$/.test(q);
			filtered = filtered.filter((h) => {
				if (isNum && String(h._line) === q) return true;
				return String(h.full_name || '').toUpperCase().includes(q) ||
					String(h._line || '').includes(q) ||
					String(h.race || '').toUpperCase() === q ||
					String(h.gender || '').toUpperCase() === q;
			});
		}

		this._currentFilteredCensusCount = filtered.length;

		const o = this.owner;
		const existingDecision = this.app.store.get(o ? o.mention_id : '');
		const matchedId = (existingDecision && existingDecision.outcome === 'matched') ? existingDecision.census_id : null;

		const activeId = matchedId || this.selectedCensusId || (this.selection && this.selection !== null ? this.selection : null);
		if (activeId) {
			let idx = filtered.findIndex((h) => h.mention_id === activeId);
			if (idx === -1 && (this.headsOnly || this.menOnly)) {
				this.headsOnly = false;
				this.menOnly = false;
				filtered = allPeople;
				if (this.censusSearch.trim()) {
					const q = this.censusSearch.trim().toUpperCase();
					const isNum = /^\d+$/.test(q);
					filtered = filtered.filter((h) => {
						if (isNum && String(h._line) === q) return true;
						return String(h.full_name || '').toUpperCase().includes(q) ||
							String(h._line || '').includes(q) ||
							String(h.race || '').toUpperCase() === q ||
							String(h.gender || '').toUpperCase() === q;
					});
				}
				this._currentFilteredCensusCount = filtered.length;
				idx = filtered.findIndex((h) => h.mention_id === activeId);
			}
			if (recenter) {
				if (idx >= 0) {
					// Position selected row at top: window starts at or 1 row before idx
					this._censusStart = Math.max(0, idx - 1);
					this._censusEnd = Math.min(filtered.length, this._censusStart + 100);
				} else {
					this._censusStart = 0;
					this._censusEnd = Math.min(filtered.length, 80);
				}
			}
		} else if (recenter) {
			this._censusStart = 0;
			this._censusEnd = Math.min(filtered.length, 80);
		}

		// Ensure valid bounds
		if (this._censusStart < 0) this._censusStart = 0;
		if (this._censusEnd <= this._censusStart) this._censusEnd = Math.min(filtered.length, this._censusStart + 80);

		const b = this.bracket();
		const s = this.state;
		let loLine = null, hiLine = null;
		if (s && s.block && s.block.candidates) {
			const cLo = s.block.candidates[b.lo];
			const cHi = s.block.candidates[b.hi];
			if (cLo && cLo._line != null) loLine = cLo._line;
			if (cHi && cHi._line != null) hiLine = cHi._line;
		}

		bar.innerHTML = `
			<span class="heads-title">RAW CENSUS <span class="faint" style="font-weight:normal">(${filtered.length.toLocaleString()}${filtered.length !== allPeople.length ? ' of ' + allPeople.length.toLocaleString() : ''})</span></span>
			<label class="small faint" style="display:flex;align-items:center;gap:4px;cursor:pointer;">
				<input type="checkbox" id="headsOnlyCheck" ${this.headsOnly ? 'checked' : ''} /> Heads only
			</label>
			<label class="small faint" style="display:flex;align-items:center;gap:4px;cursor:pointer;">
				<input type="checkbox" id="menOnlyCheck" ${this.menOnly ? 'checked' : ''} /> Men only
			</label>
			${this._searchStatus ? `<span class="search-status small ${this._searchStatus.startsWith('No match') ? 'alarm' : 'faint'}" style="margin-left:auto;">${ReviewUI.esc(this._searchStatus)}</span>` : ''}
			<div class="census-search-wrap" ${this._searchStatus ? '' : 'style="margin-left:auto;"'}>
				<input type="search" id="censusSearch" placeholder="Search… (Enter / Shift+Enter for prev)" title="Search census (Enter for next, Shift+Enter for prev)" value="${ReviewUI.esc(this._censusSearchDraft != null ? this._censusSearchDraft : this.censusSearch)}" />
				<button type="button" id="censusSearchBtn" class="census-search-btn" title="Search forward (Enter) / Search backward (Shift+Enter)">
					<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
						<circle cx="11" cy="11" r="8"></circle>
						<line x1="21" y1="21" x2="16.65" y2="16.65"></line>
					</svg>
				</button>
			</div>`;

		const searchInput = bar.querySelector('#censusSearch');
		const searchBtn = bar.querySelector('#censusSearchBtn');
		if (searchInput) {
			searchInput.addEventListener('input', (e) => {
				this._censusSearchDraft = e.target.value;
				if (!e.target.value) {
					this.censusSearch = '';
					this._searchStatus = '';
				}
			});
			searchInput.addEventListener('keydown', (e) => {
				if (e.key === 'Enter') {
					e.preventDefault();
					this.searchCensusNext(searchInput.value, e.shiftKey);
				}
			});
			searchInput.addEventListener('search', () => {
				if (!searchInput.value) {
					this.censusSearch = '';
					this._censusSearchDraft = '';
					this._searchStatus = '';
					this._censusStart = 0;
					this._censusEnd = 80;
					this.renderCensus(true, true);
				}
			});
		}
		if (searchBtn) {
			searchBtn.addEventListener('click', (e) => {
				e.preventDefault();
				this.searchCensusNext(null, e.shiftKey);
			});
		}
		const headsOnlyCheck = bar.querySelector('#headsOnlyCheck');
		if (headsOnlyCheck) {
			headsOnlyCheck.addEventListener('change', (e) => {
				this.headsOnly = e.target.checked;
				this._censusStart = 0;
				this._censusEnd = 80;
				this.renderCensus(true, true);
			});
		}
		const menOnlyCheck = bar.querySelector('#menOnlyCheck');
		if (menOnlyCheck) {
			menOnlyCheck.addEventListener('change', (e) => {
				this.menOnly = e.target.checked;
				this._censusStart = 0;
				this._censusEnd = 80;
				this.renderCensus(true, true);
			});
		}

		const claims = this.app.store.claims();
		const visible = filtered.slice(this._censusStart, this._censusEnd);

		if (!visible.length) {
			host.innerHTML = `<div class="empty small">${this.censusSearch.trim() ? 'No census records match "' + ReviewUI.esc(this.censusSearch) + '".' : 'No census records found.'}</div>`;
			return;
		}

		let html = '';
		if (this._censusStart > 0) {
			const prevLine = filtered[this._censusStart - 1] && filtered[this._censusStart - 1]._line != null
				? ` (prior to line ${filtered[this._censusStart - 1]._line})`
				: '';
			html += `<div class="census-window-more" id="loadEarlierCensus" role="button" tabindex="0" title="Click or scroll up to load earlier records">▲ Load earlier records${prevLine}</div>`;
		}
		html += visible.map((c) => this.personRow(c, activeId, claims, loLine, hiLine)).join('');
		if (this._censusEnd < filtered.length) {
			const nextLine = filtered[this._censusEnd] && filtered[this._censusEnd]._line != null
				? ` (from line ${filtered[this._censusEnd]._line})`
				: '';
			html += `<div class="census-window-more" id="loadLaterCensus" role="button" tabindex="0" title="Click or scroll down to load more records">▼ Load more records${nextLine}</div>`;
		}
		host.innerHTML = html;

		const loadEarlierEl = host.querySelector('#loadEarlierCensus');
		if (loadEarlierEl) loadEarlierEl.addEventListener('click', () => this.loadEarlierCensus());
		const loadLaterEl = host.querySelector('#loadLaterCensus');
		if (loadLaterEl) loadLaterEl.addEventListener('click', () => this.loadMoreCensus());

		const scrollTargetId = matchedId || activeId;
		if (scrollTargetId && recenter) {
			const scrollTarget = () => {
				const selEl = host.querySelector(`[data-id="${ReviewUI.esc(scrollTargetId)}"]`);
				if (selEl) {
					selEl.scrollIntoView({ block: 'start' });
					const hostRect = host.getBoundingClientRect();
					const elRect = selEl.getBoundingClientRect();
					host.scrollTop += (elRect.top - hostRect.top);
				}
			};
			scrollTarget();
			if (typeof requestAnimationFrame !== 'undefined') {
				requestAnimationFrame(scrollTarget);
			}
		} else if (resetScroll) {
			host.scrollTop = 0;
		}
	}

	personRow(c, activeId, claims, loLine, hiLine) {
		const id = c.mention_id;
		const isChecked = activeId === id;
		const claim = claims.get(id);
		const o = this.owner;
		const existingDecision = this.app.store.get(o ? o.mention_id : '');
		const isMatchedToCurrent = !!(existingDecision && existingDecision.outcome === 'matched' && existingDecision.census_id === id);
		const otherClaim = claim && claim.find((d) => !o || d.owner_id !== o.mention_id);

		// Check if record falls inside the estimated walk bracket
		const inZone = loLine != null && hiLine != null && c._line != null &&
			c._line >= Math.min(loLine, hiLine) && c._line <= Math.max(loLine, hiLine);

		const classes = ['hrow'];
		if (isChecked) classes.push('checked');
		if (isMatchedToCurrent) classes.push('is-matched');
		if (inZone) classes.push('in-zone');

		const badges = [];
		if (isMatchedToCurrent) {
			badges.push('<span class="badge agree">current match</span>');
		} else if (isChecked) {
			const r = this.row;
			const isTop = r && r.candidates && r.candidates[0] && r.candidates[0].candidate.mention_id === id;
			badges.push(`<span class="badge ${isTop ? 'agree' : 'quiet'}">${isTop ? 'closest match' : 'selected'}</span>`);
		}
		if (otherClaim) {
			badges.push(`<span class="badge bad">claimed by ${ReviewUI.esc(otherClaim.owner_name || otherClaim.owner_id)}</span>`);
		}
		if (inZone) {
			badges.push(`<span class="badge in-zone-pill" title="Within walk bracket (lines ${Math.min(loLine, hiLine)}–${Math.max(loLine, hiLine)})">in bracket</span>`);
		}
		if (c._head) {
			badges.push('<span class="badge quiet">head</span>');
		}

		const birthVal = c.birth_date || c.birth_year || null;
		const bits = [
			birthVal ? 'birth: ' + birthVal : 'birth: —',
			'gender: ' + (c.gender || '—'),
			'race: ' + (c.race || '—'),
			'head: ' + (c._head ? 'yes' : 'no')
		];
		if (c.birth_place) bits.push(c.birth_place);
		if (c._prop != null && c._prop > 0) bits.push('$' + c._prop.toLocaleString());
		if (c._date != null) bits.push(VeriteData.dateLabel(c._date));

		return `
			<div class="${classes.join(' ')}" role="radio" data-id="${ReviewUI.esc(id)}" aria-checked="${isChecked}" title="Click to inspect · Double-click to match">
				<span class="ln">${c._line == null ? '' : c._line}</span>
				<span>
					<span class="who">
						<span class="n">${ReviewUI.esc(c.full_name || '')}</span>
						${badges.join(' ')}
					</span>
					<div class="sub">${ReviewUI.esc(bits.join(' · '))}</div>
				</span>
				<span></span>
			</div>`;
	}

	selectPerson(personId) {
		this.selectedCensusId = personId;
		this.setSelection(personId);
	}

	selectCensusPerson(personId) {
		if (!personId) return;
		this.selectedCensusId = personId;

		// Update checked highlight on existing DOM rows directly without rebuilding DOM
		const host = this.$('headsRows');
		if (host) {
			host.querySelectorAll('.hrow.checked').forEach((el) => {
				el.classList.remove('checked');
				el.setAttribute('aria-checked', 'false');
			});
			const sel = host.querySelector(`[data-id="${ReviewUI.esc(personId)}"]`);
			if (sel) {
				sel.classList.add('checked');
				sel.setAttribute('aria-checked', 'true');
			}
		}


		// Update evidence inspector for this census person
		this.renderEvidence();
	}

	matchPerson(personId) {
		if (personId === undefined) return;
		this.selectedCensusId = (personId !== null) ? personId : null;
		this.selection = personId;
		ReviewUI.playMatchSound();
		this.commit();
	}

	loadMoreCensus() {
		if (this._censusEnd >= this._currentFilteredCensusCount) return;
		this._censusEnd = Math.min(this._currentFilteredCensusCount, this._censusEnd + 80);
		this.renderCensus(false, false);
	}

	loadEarlierCensus() {
		if (this._censusStart <= 0) return;
		const host = this.$('headsRows');
		const oldHeight = host ? host.scrollHeight : 0;
		const oldScroll = host ? host.scrollTop : 0;
		this._censusStart = Math.max(0, this._censusStart - 80);
		this.renderCensus(false, false);
		if (host && oldHeight) {
			host.scrollTop = oldScroll + (host.scrollHeight - oldHeight);
		}
	}

	searchCensusNext(query, backward = false) {
		const bar = this.$('headsbar');
		const inputEl = bar ? bar.querySelector('#censusSearch') : null;
		const rawVal = query != null ? query : (inputEl ? inputEl.value : this._censusSearchDraft);
		const q = String(rawVal != null ? rawVal : this.censusSearch).trim();

		if (!q) {
			this.censusSearch = '';
			this._censusSearchDraft = '';
			this._searchStatus = '';
			this.renderCensus(false);
			return;
		}

		this.censusSearch = q;
		this._censusSearchDraft = q;

		const allPeople = this.getCensusPeople();

		let list = allPeople;
		if (this.headsOnly) {
			list = list.filter((h) => h._head);
		}
		if (this.menOnly) {
			list = list.filter((h) => String(h.gender || '').toUpperCase() === 'M');
		}

		if (!list.length) {
			this._searchStatus = 'No records in list';
			this.renderCensus(false);
			return;
		}

		const activeId = this.selectedCensusId || (this.selection && this.selection !== null ? this.selection : null);
		let startIdx = -1;
		if (activeId) {
			startIdx = list.findIndex((h) => h.mention_id === activeId);
		}
		if (startIdx === -1 && this.owner && this.owner._line != null) {
			startIdx = list.findIndex((h) => h._line != null && h._line >= this.owner._line);
		}

		const qUpper = q.toUpperCase();
		const isNum = /^\d+$/.test(q);

		const matches = (h) => {
			if (isNum && String(h._line) === q) return true;
			return String(h.full_name || '').toUpperCase().includes(qUpper) ||
				String(h._line || '').includes(q) ||
				String(h._enum || '').toUpperCase() === qUpper ||
				String(h.race || '').toUpperCase() === qUpper ||
				String(h.gender || '').toUpperCase() === qUpper;
		};

		let foundIdx = -1;
		let wrapped = false;

		if (backward) {
			// Search backwards from startIdx - 1 down to 0
			for (let i = startIdx - 1; i >= 0; i--) {
				if (matches(list[i])) {
					foundIdx = i;
					break;
				}
			}
			// Wrap around to end
			if (foundIdx === -1 && startIdx >= 0) {
				for (let i = list.length - 1; i >= startIdx; i--) {
					if (matches(list[i])) {
						foundIdx = i;
						wrapped = true;
						break;
					}
				}
			}
		} else {
			// Search forward from startIdx + 1
			for (let i = startIdx + 1; i < list.length; i++) {
				if (matches(list[i])) {
					foundIdx = i;
					break;
				}
			}
			// Wrap around to top
			if (foundIdx === -1 && startIdx >= 0) {
				for (let i = 0; i <= startIdx && i < list.length; i++) {
					if (matches(list[i])) {
						foundIdx = i;
						wrapped = true;
						break;
					}
				}
			}
		}

		if (foundIdx !== -1) {
			const person = list[foundIdx];

			let totalMatches = 0;
			let matchNum = 0;
			for (let i = 0; i < list.length; i++) {
				if (matches(list[i])) {
					totalMatches++;
					if (i <= foundIdx) matchNum++;
				}
			}

			this._censusStart = Math.max(0, foundIdx - 1);
			this._censusEnd = Math.min(list.length, this._censusStart + 100);

			this._searchStatus = wrapped
				? `(wrapped) line ${person._line || '?'}`
				: `match ${matchNum} of ${totalMatches} (line ${person._line || '?'})${backward ? ' [prev]' : ''}`;

			this.selectPerson(person.mention_id);

			const host = this.$('headsRows');
			if (host) {
				const targetEl = host.querySelector(`[data-id="${ReviewUI.esc(person.mention_id)}"]`);
				if (targetEl) {
					targetEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
				}
			}
		} else {
			this._searchStatus = `No match for "${q}"`;
			this.renderCensus(false);
		}
	}

	searchCandidatesNext(query, backward = false) {
		const s = this.state, o = this.owner;
		if (!s || !o) return;
		const bar = this.$('windowbar');
		const inputEl = bar ? bar.querySelector('#findbox') : null;
		const rawVal = query != null ? query : (inputEl ? inputEl.value : this._candidateSearchDraft);
		const q = String(rawVal != null ? rawVal : this.search).trim();

		if (!q) {
			this.search = '';
			this._candidateSearchDraft = '';
			this._candidateSearchStatus = '';
			this.renderWindow();
			return;
		}

		this.search = q;
		this._candidateSearchDraft = q;

		const qUpper = q.toUpperCase();
		const isNum = /^\d+$/.test(q);
		const blockCand = (s.block && s.block.candidates) ? s.block.candidates : [];

		const matches = (c) => {
			if (isNum && String(c._line) === q) return true;
			return String(c.full_name || '').toUpperCase().includes(qUpper) ||
				String(c._line || '').includes(q) ||
				String(c._enum || '').toUpperCase() === qUpper;
		};

		let matching = blockCand.filter(matches);
		if (!matching.length && !isNum) {
			const allPeople = this.getCensusPeople();
			matching = allPeople.filter((c) => String(c.full_name || '').toUpperCase().includes(qUpper));
		}

		if (!matching.length) {
			this._candidateSearchStatus = `No match for "${q}"`;
			this.renderWindow();
			return;
		}

		const activeId = this.selection;
		let startIdx = -1;
		if (activeId) {
			startIdx = matching.findIndex((c) => c.mention_id === activeId);
		}

		let foundIdx = -1;
		let wrapped = false;

		if (backward) {
			if (startIdx > 0) {
				foundIdx = startIdx - 1;
			} else if (startIdx === 0) {
				foundIdx = matching.length - 1;
				wrapped = true;
			} else {
				foundIdx = matching.length - 1;
			}
		} else {
			if (startIdx >= 0 && startIdx < matching.length - 1) {
				foundIdx = startIdx + 1;
			} else if (startIdx === matching.length - 1) {
				foundIdx = 0;
				wrapped = true;
			} else {
				foundIdx = 0;
			}
		}

		const person = matching[foundIdx];
		const totalMatches = matching.length;
		const matchNum = foundIdx + 1;

		this._candidateSearchStatus = wrapped
			? `(wrapped) line ${person._line || '?'}`
			: `match ${matchNum} of ${totalMatches} (line ${person._line || '?'})${backward ? ' [prev]' : ''}`;

		this.selection = person.mention_id;
		this.selectedCensusId = person.mention_id;
		this.renderWindow();
		this.renderCensus();
		this.renderDecide();
		this.renderEvidence();

		const host = this.$('rows');
		if (host) {
			const targetEl = host.querySelector(`[data-id="${ReviewUI.esc(person.mention_id)}"]`);
			if (targetEl) {
				targetEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
			}
		}

		const fbAfter = this.$('findbox');
		if (fbAfter) {
			fbAfter.focus();
			fbAfter.setSelectionRange(fbAfter.value.length, fbAfter.value.length);
		}
	}

	renderQueue() {
		const q = this.$('queue');
		const owners = this.owners;
		if (!q) return;
		if (!owners.length) { q.innerHTML = ''; return; }

		const s = this.state;
		const conflicts = new Set();
		for (const c of this.app.store.conflicts()) for (const d of c.decisions) conflicts.add(d.owner_id);

		let nBlank = 0, nAuto = 0, nSet = 0, nClash = 0, nPending = 0;
		const items = owners.map((o, i) => {
			const d = this.app.store.get(o.mention_id);
			let cls = 'qrow', st = '';
			const isEps = d && d.outcome === 'matched' && (d.anchored || d.method === 'EPS');
			if (isEps) { cls += ' done eps'; st = 'EPS'; }
			else if (d && d.outcome === 'matched') { cls += ' done'; st = d.machine ? 'auto' : 'set'; }
			else if (d && d.outcome === 'absent') { cls += ' absent'; st = 'none'; }
			else if (d) { cls += ' absent'; st = 'later'; }
			// Not yet decided, but EPS/HISTID linkage already proposed a candidate —
			// worth telling apart from a row with no lead at all. An unambiguous
			// proposal is pre-selected (see _initSelection) and is usually a
			// one-keystroke confirm; an ambiguous one (a merged holding, where EPS
			// names only the first of several holders) is deliberately NOT
			// pre-selected, so it still needs the same manual look a blank row does.
			const epsProposal = s && s.epsByOwner && s.epsByOwner.get(o.mention_id);
			if (!st && epsProposal) {
				cls += ' pending' + (epsProposal.ambiguous ? ' ambiguous' : '');
				st = 'pending';
			}
			if (conflicts.has(o.mention_id)) { cls += ' conflict'; st = 'clash'; }

			if (!st) nBlank++;
			if (st === 'auto') nAuto++;
			if (st === 'set') nSet++;
			if (st === 'clash') nClash++;
			if (st === 'pending') nPending++;

			return { o, i, cls, st };
		});

		const filterEl = this.$('queueFilter');
		if (filterEl) {
			const optAll = filterEl.querySelector('option[value="all"]');
			const optBlank = filterEl.querySelector('option[value="blank"]');
			const optPending = filterEl.querySelector('option[value="pending"]');
			const optAuto = filterEl.querySelector('option[value="auto"]');
			const optSet = filterEl.querySelector('option[value="set"]');
			const optClash = filterEl.querySelector('option[value="clash"]');
			if (optAll) optAll.textContent = `All (${owners.length})`;
			if (optBlank) optBlank.textContent = `Blank (${nBlank})`;
			if (optPending) optPending.textContent = `EPS pending (${nPending})`;
			if (optAuto) optAuto.textContent = `Auto (${nAuto})`;
			if (optSet) optSet.textContent = `Set (${nSet})`;
			if (optClash) optClash.textContent = `Clash (${nClash})`;
			filterEl.value = this.queueFilter || 'all';
		}

		let filteredItems = items;
		if (this.queueFilter === 'blank') {
			filteredItems = items.filter((it) => !it.st || it.i === this.ownerIndex);
		} else if (this.queueFilter === 'pending') {
			filteredItems = items.filter((it) => it.st === 'pending' || it.i === this.ownerIndex);
		} else if (this.queueFilter === 'auto') {
			filteredItems = items.filter((it) => it.st === 'auto' || it.i === this.ownerIndex);
		} else if (this.queueFilter === 'set') {
			filteredItems = items.filter((it) => it.st === 'set' || it.i === this.ownerIndex);
		} else if (this.queueFilter === 'clash') {
			filteredItems = items.filter((it) => it.st === 'clash' || it.i === this.ownerIndex);
		}

		const countEl = this.$('queueCount');
		if (countEl) {
			countEl.textContent = `(${filteredItems.length.toLocaleString()}${filteredItems.length !== owners.length ? ' of ' + owners.length.toLocaleString() : ''})`;
		}

		if (!filteredItems.length) {
			q.innerHTML = `<div class="empty small" style="padding:16px 12px;color:var(--ink-3);">No enslavers with status "${ReviewUI.esc(this.queueFilter)}".</div>`;
			return;
		}

		const html = filteredItems.map((it) => {
			const o = it.o, i = it.i, cls = it.cls, st = it.st;
			let stHtml;
			if (st === 'EPS') stHtml = '<span class="badge agree">EPS</span>';
			else if (st === 'pending' && cls.includes('ambiguous')) {
				stHtml = '<span class="badge warn" title="EPS holding was merged from more than one of ours — linkage names only the first holder, not pre-selected. Verify by hand.">EPS±</span>';
			} else if (st === 'pending') {
				stHtml = '<span class="badge quiet" title="EPS/HISTID linkage proposed a candidate — not yet confirmed">EPS?</span>';
			} else stHtml = ReviewUI.esc(st);
			return `<div class="${cls}" role="option" data-i="${i}" aria-current="${i === this.ownerIndex}" aria-selected="${i === this.ownerIndex}">
				<span class="ln">${o._line == null ? '' : o._line}</span>
				<span class="nm">${ReviewUI.esc(o.full_name || '(no name)')}</span>
				<span class="st">${stHtml}</span></div>`;
		}).join('');
		q.innerHTML = html;
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
		const d = this.app.store.get(o.mention_id);
		const isEpsMatched = d && d.outcome === 'matched' && (d.anchored || d.method === 'EPS');

		let epsHtml = '';
		if (isEpsMatched) {
			const censusName = d.census_name || (epsNote && epsNote.census && epsNote.census.full_name) || d.census_id;
			epsHtml = `<div class="small" style="margin-top:4px"><span class="badge agree">Matched via EPS</span> to <span class="n" style="font-weight:600">${ReviewUI.esc(censusName)}</span>${d.census_line != null ? ` (line ${d.census_line})` : ''}</div>`;
		} else if (epsNote && epsNote.census) {
			if (epsNote.suspect) {
				epsHtml = `<div class="small" style="margin-top:4px"><span class="badge warn">Suspect EPS Anchor (${ReviewUI.esc(epsNote.suspectReason || 'Surname mismatch')})</span> → ${ReviewUI.esc(epsNote.census.full_name || epsNote.census.mention_id)}</div>`;
			} else {
				const badgeCls = epsNote.ambiguous ? 'warn' : 'agree';
				const note = epsNote.ambiguous
					? ` merged from ${epsNote.span} — names only the first holder, not pre-selected`
					: '';
				epsHtml = `<div class="small" style="margin-top:4px"><span class="badge ${badgeCls}">EPS holding ${epsNote.holdnum}${note}</span> → ${ReviewUI.esc(epsNote.census.full_name || epsNote.census.mention_id)}</div>`;
			}
		} else if (epsNote) {
			const badgeCls = epsNote.ambiguous ? 'warn' : 'agree';
			const note = epsNote.ambiguous ? ` merged from ${epsNote.span}` : '';
			epsHtml = `<div class="small" style="margin-top:4px"><span class="badge ${badgeCls}">EPS holding ${epsNote.holdnum}${note}</span></div>`;
		}

		const estateBadge = o._isEstate ? ' <span class="badge warn" title="Estate or deceased owner">Estate / Deceased — Likely absent</span>' : '';
		const agentHtml = o._agentName ? `<div class="small faint" style="margin-top:2px">Agent: <strong>${ReviewUI.esc(o._agentName)}</strong></div>` : '';
		const genderMeta = (o._inferredGender && !o.gender) ? ` · inferred gender: ${o._inferredGender}` : (o.gender ? ` · gender: ${o.gender}` : '');

		el.innerHTML = `
			<div>
				<div class="name">${ReviewUI.esc(o.full_name || '(no name)')}${estateBadge}</div>
				${agentHtml}
				<div class="meta">${ReviewUI.esc(o.mention_id)} · line ${o._line == null ? '?' : o._line} · ${VeriteData.dateLabel(o._date) || 'no date'}${genderMeta}</div>
				<div class="meta faint">enslaver ${this.ownerIndex + 1} of ${this.owners.length}</div>
			</div>
			<div class="holding">
				${holding ? `held ${holding.people.length} ${holding.people.length === 1 ? 'person' : 'people'}` : 'holding not found'}
				${ages ? `<div class="ages small faint">${ReviewUI.esc(ages)}</div>` : ''}
				${epsHtml}
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
			<span class="candidates-title">MATCH CANDIDATES</span>
			 &nbsp; Double-click to match enslaver to census listing
			${this._candidateSearchStatus ? `<span class="search-status small ${this._candidateSearchStatus.startsWith('No match') ? 'alarm' : 'faint'}" style="margin-left:auto;">${ReviewUI.esc(this._candidateSearchStatus)}</span>` : ''}
			<div class="census-search-wrap" ${this._candidateSearchStatus ? '' : 'style="margin-left:auto;"'}>
				<input type="search" id="findbox" placeholder="Search… (Enter / Shift+Enter for prev)" title="Search candidates (Enter for next, Shift+Enter for prev)" value="${ReviewUI.esc(this._candidateSearchDraft != null ? this._candidateSearchDraft : this.search)}" />
				<button type="button" id="candidateSearchBtn" class="census-search-btn" title="Search forward (Enter) / Search backward (Shift+Enter)">
					<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
						<circle cx="11" cy="11" r="8"></circle>
						<line x1="21" y1="21" x2="16.65" y2="16.65"></line>
					</svg>
				</button>
			</div>`;
		const fb = bar.querySelector('#findbox');
		const fbBtn = bar.querySelector('#candidateSearchBtn');
		if (fb) {
			fb.addEventListener('input', (e) => {
				this._candidateSearchDraft = e.target.value;
				if (!e.target.value) {
					this.search = '';
					this._candidateSearchStatus = '';
					this.renderWindow();
				}
			});
			fb.addEventListener('keydown', (e) => {
				if (e.key === 'Enter') {
					e.preventDefault();
					this.searchCandidatesNext(fb.value, e.shiftKey);
				}
			});
			fb.addEventListener('search', () => {
				if (!fb.value) {
					this.search = '';
					this._candidateSearchDraft = '';
					this._candidateSearchStatus = '';
					this.renderWindow();
				}
			});
		}
		if (fbBtn) {
			fbBtn.addEventListener('click', (e) => {
				e.preventDefault();
				this.searchCandidatesNext(null, e.shiftKey);
			});
		}

		let list;
		if (this.search.trim()) {
			const q = this.search.trim().toUpperCase();
			const isNum = /^\d+$/.test(q);
			const blockCand = (s.block && s.block.candidates) ? s.block.candidates : [];
			let matches = blockCand.filter((c) => {
				if (isNum && String(c._line) === q) return true;
				return String(c.full_name || '').toUpperCase().includes(q) ||
					String(c._line || '').includes(q) ||
					String(c._enum || '').toUpperCase() === q;
			});
			if (!matches.length && !isNum) {
				const allPeople = this.getCensusPeople();
				matches = allPeople.filter((c) => String(c.full_name || '').toUpperCase().includes(q));
			}
			list = matches.slice(0, 80);
		} else {
			// Order candidate options in order of probability of being a match
			const rankedList = (this.row ? this.row.candidates : []).map((c) => c.candidate);
			const rankedIds = new Set(rankedList.map((c) => c.mention_id));
			const bracketFiller = s.block.candidates.slice(b.lo, b.hi + 1).filter((c) => !rankedIds.has(c.mention_id));
			list = [...rankedList, ...bracketFiller];

			const epsAnchor = s.epsByOwner && s.epsByOwner.get(o.mention_id);
			if (epsAnchor && epsAnchor.census && !list.some((c) => c.mention_id === epsAnchor.census.mention_id)) {
				list.unshift(epsAnchor.census);
			}
			const existing = this.app.store.get(o.mention_id);
			if (existing && existing.census_id) {
				const existingRec = this.app.data.byId.get(existing.census_id);
				if (existingRec && !list.some((c) => c.mention_id === existingRec.mention_id)) {
					list.unshift(existingRec);
				}
			}
		}

		// If this enslaver has been matched to a census person, put them on the very first line
		const existing = this.app.store.get(o.mention_id);
		const matchedId = (existing && existing.outcome === 'matched') ? existing.census_id : null;
		if (matchedId) {
			const matchedRec = this.app.data.byId.get(matchedId);
			if (matchedRec) {
				list = [matchedRec, ...list.filter((c) => c.mention_id !== matchedId)];
			}
		}

		const rowsHtml = list.map((c) => this.candidateRow(c, ranked, anchors, claims, b, s.block)).join('');
		const absentChecked = this.selection === null;
		const emptyMsg = (!list.length && this.search.trim())
			? `<div class="empty small">No candidates match "${ReviewUI.esc(this.search)}".</div>`
			: '';
		host.innerHTML = emptyMsg + rowsHtml + `
			<div class="crow" role="radio" data-absent="1" aria-checked="${absentChecked}" title="Click to inspect · Double-click to mark absent">
				<span class="ln"></span>
				<span><span class="who"><span class="n">Not in this census</span></span>
				<div class="sub faint">non-resident, died, estate, or simply not enumerated here</div></span>
				<span></span>
			</div>`;

		if (matchedId) {
			host.scrollTop = 0;
		}

		host.querySelectorAll('.crow').forEach((el) => {
			if (el.classList.contains('anchor')) {
				el.addEventListener('click', () => {
					this.reopen(el.dataset.id);
				});
				return;
			}
			el.addEventListener('mouseenter', () => {
				const id = el.dataset.absent ? null : el.dataset.id;
				if (id && this.selection !== id) {
					this.selection = id;
					this.renderEvidence();
				}
			});
			el.addEventListener('click', () => {
				const id = el.dataset.absent ? null : el.dataset.id;
				this.setSelection(id);
			});
			el.addEventListener('dblclick', () => {
				const id = el.dataset.absent ? null : el.dataset.id;
				this.matchPerson(id);
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
				<span class="ln">${c._line == null ? '' : c._line}</span>
				<span><span class="who"><span class="n">${ReviewUI.esc(c.full_name || '')}</span>
					<span class="badge agree">anchor</span></span>
					<div class="sub">matched to ${ReviewUI.esc(anchor.owner.full_name || anchor.owner.mention_id)}${anchor.decision.anchored ? ' · EPS' : ''}</div></span>
				<span></span></div>`;
		}

		const epsAnchor = this.state.epsByOwner && this.state.epsByOwner.get(this.owner.mention_id);
		const isEpsMatch = !!(epsAnchor && epsAnchor.census && epsAnchor.census.mention_id === id);
		const existingDecision = this.app.store.get(this.owner.mention_id);
		const isCurrentMatch = !!(existingDecision && existingDecision.outcome === 'matched' && existingDecision.census_id === id);
		const isCurrentMatchedEps = isCurrentMatch && (existingDecision.anchored || existingDecision.method === 'EPS');

		const classes = ['crow'];
		if (outside) classes.push('outside');
		if (claim && claim.some((d) => d.owner_id !== this.owner.mention_id)) classes.push('claimed');
		if (!r) classes.push('filler');
		if (isCurrentMatch) classes.push('is-matched');
		if (isCurrentMatchedEps || isEpsMatch) classes.push('eps-match');
		const checked = this.selection === id;

		const badges = [];
		if (isCurrentMatch) {
			badges.push(isCurrentMatchedEps
				? '<span class="badge agree">Matched via EPS</span>'
				: '<span class="badge agree">Matched</span>');
		}
		if (r) {
			badges.push(`<span class="badge">${r.rank} · ${r.totalBits.toFixed(1)} bits</span>`);
			if (r.via === 'position') badges.push('<span class="badge quiet">position only</span>');
			if (r.via === 'name') badges.push('<span class="badge quiet">name only</span>');
		} else if (checked && !isCurrentMatch) {
			badges.push('<span class="badge agree">manual pick</span>');
		} else if (c._head) {
			badges.push('<span class="badge quiet">census head</span>');
		}
		if (!isCurrentMatch) {
			if (isEpsMatch) {
				badges.push('<span class="badge agree">EPS proposal</span>');
			} else if (r && r.anchored) {
				badges.push('<span class="badge agree">EPS</span>');
			}
		}
		if (claim && claim.some((d) => d.owner_id !== this.owner.mention_id)) {
			const other = claim.find((d) => d.owner_id !== this.owner.mention_id);
			badges.push(`<span class="badge bad">claimed by ${ReviewUI.esc(other.owner_name || other.owner_id)}</span>`);
		}
		if (outside) {
			if (cRank == null) {
				badges.push(`<span class="badge warn">block ${ReviewUI.esc(c._enum || 'other')}</span>`);
			}
		}
		if (r && r.confirmed1850) {
			badges.push(`<span class="badge agree" title="${ReviewUI.esc(r.confirmed1850.note)}">Confirmed in 1850</span>`);
		}
		if (r && r.genderClash) {
			badges.push('<span class="badge bad" title="Inferred enslaver gender conflicts with census record">gender clash</span>');
		}
		if ((isEpsMatch && epsAnchor && epsAnchor.suspect) || (anchor && anchor.suspect)) {
			badges.push(`<span class="badge warn" title="${ReviewUI.esc((epsAnchor && epsAnchor.suspectReason) || (anchor && anchor.suspectReason) || 'Surname mismatch')}">Suspect EPS Anchor</span>`);
		}

		const bits = [];
		if (c.birth_year) bits.push('b. ' + c.birth_year);
		if (c.birth_place) bits.push(c.birth_place);
		if (c._head) bits.push('head');
		if (c._prop != null && c._prop > 0) bits.push('$' + c._prop);
		if (c._date != null) bits.push(VeriteData.dateLabel(c._date));
		if (r && r.deltaDays != null) bits.push((r.deltaDays >= 0 ? '+' : '') + r.deltaDays + 'd');

		return `<div class="${classes.join(' ')}" role="radio" data-id="${ReviewUI.esc(id)}" aria-checked="${checked}" title="Click to inspect · Double-click to match">
			<span class="ln">${c._line == null ? '' : c._line}</span>
			<span><span class="who"><span class="n">${ReviewUI.esc(c.full_name || '')}</span>${badges.join(' ')}</span>
			<div class="sub">${ReviewUI.esc(bits.join(' · '))}</div></span>
			<span></span></div>`;
	}

	renderDecide() {
		const el = this.$('decide'), o = this.owner;
		if (!o) { el.innerHTML = ''; return; }
		const existing = this.app.store.get(o.mention_id);
		const isEps = existing && existing.outcome === 'matched' && (existing.anchored || existing.method === 'EPS');
		el.innerHTML = `
			${existing ? '<button id="undo">Clear this decision</button>' : ''}
			${isEps ? '<span class="badge agree" style="padding:4px 8px;font-weight:600">Matched via EPS</span>' : ''}
			<span class="hint">Click to inspect · Double-click to match</span>`;
		const undo = this.root.querySelector('#undo');
		if (undo) undo.addEventListener('click', () => { this.app.store.clear(o.mention_id); this.setSelection(undefined); this.renderQueue(); });
	}

	renderEvidence() {
		const el = this.$('evidence');
		const r = this.row;
		if (!r) { el.innerHTML = ''; return; }
		const sel = this.selectedCensusId || this.selection;
		let pick = (r.candidates || []).find((c) => c.candidate.mention_id === sel);
		if (!pick && sel) {
			const candRec = this.app.data.byId.get(sel);
			if (candRec) {
				const candRank = this.state.block.rankOf.get(sel);
				const f = this.app.engine ? this.app.engine.f.MatchPerson(this.owner, candRec, { censusYear: this.state.block.year || candRec._year }) : null;
				pick = {
					candidate: candRec,
					candRank,
					positionBits: 0,
					totalBits: f ? f.bits : 0,
					fellegi: f
				};
			}
		}
		if (!pick) pick = r.candidates[0];
		if (!pick) { el.innerHTML = '<div class="empty small">No candidate scored for this enslaver. Use the search box.</div>'; return; }

		const epsAnchor = this.state.epsByOwner && this.state.epsByOwner.get(this.owner.mention_id);
		const isEpsCand = !!(epsAnchor && epsAnchor.census && epsAnchor.census.mention_id === pick.candidate.mention_id);
		const existingDecision = this.app.store.get(this.owner.mention_id);
		const isCurrentMatchedEps = !!(existingDecision && existingDecision.outcome === 'matched' && existingDecision.census_id === pick.candidate.mention_id && (existingDecision.anchored || existingDecision.method === 'EPS'));

		let epsCard = '';
		if (isCurrentMatchedEps || isEpsCand) {
			const ambiguous = !!(epsAnchor && epsAnchor.ambiguous);
			const suspect = !!(epsAnchor && epsAnchor.suspect);
			const bg = suspect ? 'var(--stray-bg)' : (ambiguous ? 'var(--stray-bg)' : 'var(--fixed-bg)');
			const fg = suspect ? 'var(--stray)' : (ambiguous ? 'var(--stray)' : 'var(--fixed)');
			epsCard = `
				<div class="group" style="background: ${bg}; border: 1px solid var(--rule); border-radius: 4px; padding: 10px 12px; margin-bottom: 12px;">
					<div style="font-weight: 600; color: ${fg}; font-size: 13px; display: flex; align-items: center; gap: 6px;">
						<span class="badge ${suspect ? 'warn' : (ambiguous ? 'warn' : 'agree')}">${suspect ? 'Suspect EPS' : (ambiguous ? 'EPS Match ±' : 'EPS Match')}</span>
						${suspect ? 'Suspect Anchor (Unpinned)' : (isCurrentMatchedEps ? 'Confirmed via EPS' : 'Proposed by EPS')}
					</div>
					<div class="small" style="margin-top: 6px; color: var(--ink-2); line-height: 1.4;">
						${suspect ? `<strong style="color:var(--stray);">${ReviewUI.esc(epsAnchor.suspectReason || 'Surname mismatch')}</strong>. This anchor does NOT forcibly pin sequence alignment.<br>` : ''}
						${epsAnchor ? `Linked to IPUMS EPS holding <strong>#${epsAnchor.holdnum}</strong>${epsAnchor.span > 1 ? ` (${epsAnchor.span} merged holdings)` : ''}.` : 'Matched via EPS linkage.'}
						${ambiguous ? '<br><span class="faint">This holding was merged from several of ours; EPS names only the first holder. Verify this is the right person before confirming.</span>' : ''}
						${epsAnchor && epsAnchor.compositionScore != null ? `<br><span class="faint">Composition score: ${epsAnchor.compositionScore.toFixed(2)}</span>` : ''}
						${epsAnchor && epsAnchor.census && epsAnchor.census._ipums ? `<br><span class="faint">HISTID: ${ReviewUI.esc(epsAnchor.census._ipums)}</span>` : ''}
					</div>
				</div>`;
		}

		let cross1850Card = '';
		if (pick.confirmed1850) {
			cross1850Card = `
				<div class="group" style="background: var(--fixed-bg); border: 1px solid var(--rule); border-radius: 4px; padding: 10px 12px; margin-bottom: 12px;">
					<div style="font-weight: 600; color: var(--fixed); font-size: 13px; display: flex; align-items: center; gap: 6px;">
						<span class="badge agree">Confirmed in 1850</span>
					</div>
					<div class="small" style="margin-top: 6px; color: var(--ink-2); line-height: 1.4;">
						${ReviewUI.esc(pick.confirmed1850.note)}
					</div>
				</div>`;
		}

		const f = pick.fellegi;
		const fields = f && f.fields ? f.fields.filter((x) => Math.abs(x.bits) > 0.01) : [];
		const maxAbs = Math.max(1, ...fields.map((x) => Math.abs(x.bits)), Math.abs(pick.positionBits || 0));
		const barFor = (bits) => {
			const w = Math.min(100, Math.abs(bits) / maxAbs * 100);
			return `<div class="bar"><i class="${bits < 0 ? 'neg' : ''}" style="width:${w.toFixed(0)}%"></i></div>`;
		};
		const est = r.estimate;
		el.innerHTML = `
			${epsCard}
			${cross1850Card}
			<div class="group">
				<h3>Why this candidate</h3>
				<table>
					${fields.map((x) => `<tr><td class="k">${ReviewUI.esc(x.field)} <span class="faint">${ReviewUI.esc(x.level)}</span>${barFor(x.bits)}</td><td class="v">${x.bits > 0 ? '+' : ''}${x.bits.toFixed(2)}</td></tr>`).join('')}
					<tr><td class="k">position${barFor(pick.positionBits || 0)}</td><td class="v">${(pick.positionBits || 0) > 0 ? '+' : ''}${(pick.positionBits || 0).toFixed(2)}</td></tr>
					${pick.contextBits ? `<tr><td class="k">head / property</td><td class="v">+${pick.contextBits.toFixed(2)}</td></tr>` : ''}
					${pick.crossCensusBits ? `<tr><td class="k">1850 match${barFor(pick.crossCensusBits)}</td><td class="v">+${pick.crossCensusBits.toFixed(2)}</td></tr>` : ''}
					${pick.genderBits ? `<tr><td class="k">gender clash${barFor(pick.genderBits)}</td><td class="v">${pick.genderBits.toFixed(2)}</td></tr>` : ''}
					<tr><td class="k"><strong>total</strong></td><td class="v"><strong>${(pick.totalBits || 0).toFixed(2)} bits</strong></td></tr>
				</table>
			</div>
			<div class="group">
				<h3>Position</h3>
				<table>
					<tr><td class="k">expected rank</td><td class="v">${Math.round(est.expected)}</td></tr>
					<tr><td class="k">sigma</td><td class="v">±${Math.round(est.sigma)}</td></tr>
					<tr><td class="k">this candidate</td><td class="v">${pick.candRank != null ? pick.candRank : '—'}</td></tr>
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
	commit(forcedId) {
		const o = this.owner;
		const id = (forcedId !== undefined) ? forcedId : this.selection;
		if (!o || id === undefined) return;
		const r = this.row;
		const presented = r ? r.candidates : [];
		const cand = id === null ? null : this.app.data.byId.get(id);

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
			confidence: 'certain',
			anchored: !!(this.state.epsByOwner && this.state.epsByOwner.get(o.mention_id)
				&& cand && this.state.epsByOwner.get(o.mention_id).census.mention_id === cand.mention_id),
		});
		this.selection = id;
		this.selectedCensusId = (id && id !== null) ? id : null;
		if (cand) ReviewUI.playMatchSound();
		this.app.onDecision();
		this.renderSubject();
		this.renderWindow();
		this.renderCensus(false, false);
		this.renderDecide();
		this.renderEvidence();
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
		// Single-key review shortcuts removed
	}

	static esc(s) {
		return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
			{ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
	}
}

if (typeof window !== 'undefined') window.ReviewUI = ReviewUI;
if (typeof module !== 'undefined' && module.exports) module.exports = { ReviewUI };
