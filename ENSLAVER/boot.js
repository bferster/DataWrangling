// boot.js
// ---------------------------------------------------------------------------
// Browser boot — wires App to the DOM, auto-loads CSV files, and drives the
// setup pane. Nothing here runs under Node; the Node test lives in test/boot.js.
// ---------------------------------------------------------------------------

(function () {
	'use strict';

	// ---- globals exposed for the Node test harness -------------------------
	const app = new App();
	if (typeof window !== 'undefined') window.verite = app;

	// ---- DOM refs ----------------------------------------------------------
	const $ = (id) => document.getElementById(id);

	const mentionsStatus = $('mentionsStatus');
	const eps1850Status  = $('eps1850Status');
	const eps1860Status  = $('eps1860Status');
	const reportEl       = $('report');
	const noticesEl      = $('notices');
	const countyEl       = $('county');
	const yearEl         = $('year');
	const reviewerEl     = $('reviewer');
	const reloadBtn      = $('reload');
	const runDiagBtn     = $('runDiag');
	const prepareBtn     = $('prepare');
	const autoAcceptBtn  = $('autoAccept');
	const exportABtn     = $('exportAssertions');
	const exportSBtn     = $('exportSession');
	const exportHBtn     = $('exportHoldings');
	const counterEl      = $('counter');
	const sessionFileEl  = $('sessionFile');

	// Pane navigation
	const panes   = document.querySelectorAll('.pane');
	const navBtns = document.querySelectorAll('nav.steps button');

	function showPane(id) {
		panes.forEach((p)   => p.classList.toggle('active', p.id === id));
		navBtns.forEach((b) => b.setAttribute('aria-selected', b.dataset.pane === id ? 'true' : 'false'));
	}
	navBtns.forEach((b) => b.addEventListener('click', () => showPane(b.dataset.pane)));

	// ---- status helpers ----------------------------------------------------
	function setStatus(el, text, cls) {
		el.textContent = text;
		el.className = 'status' + (cls ? ' ' + cls : '');
	}

	function setReport(text) {
		reportEl.textContent = text;
	}

	function notice(msg, type) {
		const d = document.createElement('div');
		d.className = 'notice' + (type ? ' ' + type : '');
		d.textContent = msg;
		noticesEl.appendChild(d);
	}

	function clearNotices() {
		noticesEl.innerHTML = '';
	}

	// ---- streaming fetch with progress ------------------------------------
	// Returns the full text; calls onProgress(loaded, total) as data arrives.
	async function fetchText(url, onProgress) {
		let resp;
		try { resp = await fetch(url); } catch (e) { return null; }
		if (!resp.ok) return null;

		const total = parseInt(resp.headers.get('content-length') || '0', 10);

		// Prefer streaming so progress works on large files.
		if (resp.body) {
			const reader = resp.body.getReader();
			const decoder = new TextDecoder();
			let chunks = '', loaded = 0;
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				chunks += decoder.decode(value, { stream: true });
				loaded += value.length;
				if (onProgress && total) onProgress(loaded, total);
			}
			return chunks;
		}

		// Fallback (e.g. jsdom in tests)
		return resp.text();
	}

	function fmtRows(n) { return n.toLocaleString() + ' row' + (n === 1 ? '' : 's'); }
	function fmtPct(loaded, total) {
		if (!total) return '';
		return ' ' + Math.round(100 * loaded / total) + '%';
	}

	// ---- load files --------------------------------------------------------
	async function loadMentions() {
		setStatus(mentionsStatus, 'loading\u2026');
		const text = await fetchText('../COMMON/mentions.csv', (l, t) => {
			setStatus(mentionsStatus, 'loading\u2026' + fmtPct(l, t));
		});
		if (text === null) {
			if (location.protocol === 'file:') {
				setStatus(mentionsStatus, 'needs http.server', 'bad');
				setReport(
					'Opening index.html off the filesystem will not work.\n' +
					'A file:// page cannot fetch its neighbouring files.\n\n' +
					'Serve the folder first:\n\n' +
					'    python3 -m http.server 8000\n\n' +
					'then open  http://localhost:8000/ENSLAVER/'
				);
				setReloadEnabled(true);
				return false;
			}
			setStatus(mentionsStatus, 'not found', 'bad');
			notice('mentions.csv not found in ../COMMON/. Check the path.');
			setReloadEnabled(true);
			return false;
		}
		try {
			const r = await app.loadMentions(text, (l, t) => {
				setStatus(mentionsStatus, 'parsing\u2026' + fmtPct(l, t));
			});
			setStatus(mentionsStatus, fmtRows(r.rows), 'ok');
			populateCounties(r.counties);
			return true;
		} catch (e) {
			setStatus(mentionsStatus, 'error', 'bad');
			notice('mentions.csv: ' + e.message);
			setReloadEnabled(true);
			return false;
		}
	}

	async function loadEps(year, statusEl) {
		setStatus(statusEl, 'loading\u2026');
		const text = await fetchText('./eps' + year + '.csv', (l, t) => {
			setStatus(statusEl, 'loading\u2026' + fmtPct(l, t));
		});
		if (text === null) {
			setStatus(statusEl, 'not in this folder', '');
			return false;
		}
		try {
			const r = app.loadEps(year, text);
			setStatus(statusEl, r.holdings + ' holdings / ' + fmtRows(r.rows), 'ok');
			return true;
		} catch (e) {
			setStatus(statusEl, 'error', 'bad');
			notice('eps' + year + '.csv: ' + e.message);
			return false;
		}
	}

	// ---- county / year selects --------------------------------------------
	function populateCounties(counties) {
		const prev = countyEl.value;
		countyEl.innerHTML = counties.map((c) =>
			'<option value="' + c + '"' + (c === prev ? ' selected' : '') + '>' + c + '</option>'
		).join('');
		if (!prev && counties.length) countyEl.value = counties[0];
		app.county = countyEl.value || counties[0] || null;
	}

	countyEl.addEventListener('change', () => {
		app.county = countyEl.value;
		updateDiagnostics();
	});

	yearEl.addEventListener('change', () => {
		app.year = parseInt(yearEl.value, 10);
		updateDiagnostics();
	});

	// ---- diagnostics -------------------------------------------------------
	function updateDiagnostics() {
		if (!app.loaded.mentions) return;
		try {
			const d = app.diagnostics();
			setReport(Diagnostics.format(d));
		} catch (e) {
			setReport('Diagnostics error: ' + e.message);
		}
		runDiagBtn.disabled = false;
		prepareBtn.disabled = false;
	}

	runDiagBtn.addEventListener('click', () => updateDiagnostics());

	// ---- session file ------------------------------------------------------
	sessionFileEl.addEventListener('change', () => {
		const f = sessionFileEl.files[0];
		if (!f) return;
		const fr = new FileReader();
		fr.onload = () => {
			try {
				app.store.loadSessionJson(String(fr.result));
				app.store.reviewer = reviewerEl.value.trim() || app.store.reviewer;
				app.store.county   = app.county;
				const sessionStatus = $('sessionStatus');
				if (sessionStatus) sessionStatus.textContent = 'loaded';
			} catch (e) {
				notice('Session file: ' + e.message);
			}
		};
		fr.readAsText(f);
	});

	// ---- prepare -----------------------------------------------------------
	prepareBtn.addEventListener('click', () => {
		prepareBtn.disabled = true;
		clearNotices();
		app.store.reviewer = reviewerEl.value.trim();
		app.store.county   = countyEl.value;
		app.year           = parseInt(yearEl.value, 10);
		app.county         = countyEl.value;

		try {
			const r = app.prepare();
			let msg = 'Prepared: ' + r.blocks + ' blocks, ' + r.owners + ' enslavers';
			if (r.epsAnchors) msg += ', ' + r.epsAnchors + ' EPS anchors';
			setReport(msg);

			// Mount ReviewUI
			const reviewSection = document.getElementById('review');
			if (!app.ui) {
				app.ui = new ReviewUI(app, reviewSection);
			}
			app.ui.mount();
			app.ui.setBlocks(app.blocks);

			autoAcceptBtn.disabled = false;
			exportABtn.disabled    = false;
			exportSBtn.disabled    = false;
			exportHBtn.disabled    = !app.holdingAlignment;

			showPane('review');
			updateCounter();
		} catch (e) {
			prepareBtn.disabled = false;
			notice('Prepare failed: ' + e.message);
			console.error(e);
		}
	});

	// ---- auto-accept -------------------------------------------------------
	autoAcceptBtn.addEventListener('click', () => {
		const key = app.ui ? app.ui.blockKey : null;
		if (!key) return;
		const n = app.acceptAuto(key);
		notice('Auto-accepted ' + n + ' match' + (n === 1 ? '' : 'es') + '.');
		updateCounter();
	});

	// ---- exports -----------------------------------------------------------
	exportABtn.addEventListener('click', () => { app.exportAssertions(); });
	exportSBtn.addEventListener('click', () => { app.exportSession(); });
	exportHBtn.addEventListener('click', () => { app.exportHoldingReport(); });

	// ---- counter -----------------------------------------------------------
	function updateCounter() {
		const s = app.store.stats();
		counterEl.textContent = s.total ? (s.matched + ' matched \u00b7 ' + s.total + ' decided') : '';
	}
	document.addEventListener('verite:decision', () => updateCounter());

	// ---- reload button -----------------------------------------------------
	function setReloadEnabled(on) {
		reloadBtn.disabled = !on;
	}

	reloadBtn.addEventListener('click', () => autoLoad());

	// ---- auto-load on startup ---------------------------------------------
	async function autoLoad() {
		clearNotices();
		setReloadEnabled(false);
		setStatus(mentionsStatus, 'waiting');
		setStatus(eps1850Status,  'waiting');
		setStatus(eps1860Status,  'waiting');
		setReport('Loading\u2026');

		const ok = await loadMentions();
		if (!ok) return;

		// Both EPS years load up-front so switching year never goes back to the network.
		await Promise.all([
			loadEps(1850, eps1850Status),
			loadEps(1860, eps1860Status),
		]);

		app.year   = parseInt(yearEl.value, 10);
		app.county = countyEl.value;

		updateDiagnostics();
		setReloadEnabled(true);
	}

	// Kick off immediately.
	autoLoad();

})();
