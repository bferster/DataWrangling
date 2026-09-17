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
	const loadSBtn       = $('loadSession');
	const loadSessionFileEl = $('loadSessionFile');
	const exportABtn     = $('exportAssertions');
	const exportSBtn     = $('exportSession');
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

	function setProgress(pct, msg) {
		const bar = $('progressBar');
		const headerBar = $('headerProgress');
		const pctEl = $('progressPct');
		const msgEl = $('progressMsg');
		const p = Math.min(100, Math.max(0, Math.round(pct)));
		if (bar) bar.style.width = p + '%';
		if (headerBar) {
			headerBar.style.width = p + '%';
			headerBar.style.opacity = p === 100 ? '0' : '1';
		}
		if (pctEl) pctEl.textContent = p + '%';
		if (msgEl && msg) msgEl.textContent = msg;
	}

	// ---- load files --------------------------------------------------------
	async function loadMentions() {
		setStatus(mentionsStatus, 'loading\u2026');
		setProgress(5, 'Downloading mentions.csv\u2026');
		const text = await fetchText('../COMMON/mentions.csv', (l, t) => {
			const pct = t ? Math.round(5 + (l / t) * 30) : 15;
			setStatus(mentionsStatus, 'loading\u2026' + fmtPct(l, t));
			setProgress(pct, 'Downloading mentions.csv\u2026' + fmtPct(l, t));
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
			setProgress(35, 'Parsing mentions.csv\u2026');
			const r = await app.loadMentions(text, (l, t) => {
				const pct = t ? Math.round(35 + (l / t) * 35) : 50;
				setStatus(mentionsStatus, 'parsing\u2026' + fmtPct(l, t));
				setProgress(pct, 'Parsing mentions.csv\u2026' + fmtPct(l, t));
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

	if (countyEl) {
		countyEl.addEventListener('change', () => {
			app.county = countyEl.value;
			updateDiagnostics();
		});
	}

	if (yearEl) {
		yearEl.addEventListener('change', () => {
			app.year = parseInt(yearEl.value, 10);
			updateDiagnostics();
		});
	}

	// ---- diagnostics -------------------------------------------------------
	function updateDiagnostics() {
		if (!app.loaded.mentions) return;
		try {
			const d = app.diagnostics();
			setReport(Diagnostics.format(d));
		} catch (e) {
			setReport('Diagnostics error: ' + e.message);
		}
		if (runDiagBtn) runDiagBtn.disabled = false;
		if (prepareBtn) prepareBtn.disabled = false;
	}

	if (runDiagBtn) runDiagBtn.addEventListener('click', () => updateDiagnostics());

	// ---- session file loading ----------------------------------------------
	async function loadSessionFromFile(file) {
		if (!file) return;
		try {
			const text = await file.text();
			const o = JSON.parse(text);
			if (!o || o.kind !== 'verite-schedule2census-session') {
				throw new Error('Not a schedule2census session file');
			}
			app.store.loadSessionJson(text);

			if (o.county) {
				app.county = o.county;
				if (countyEl) countyEl.value = o.county;
			}
			if (o.reviewer) {
				if (reviewerEl) reviewerEl.value = o.reviewer;
				app.store.reviewer = o.reviewer;
			}
			const firstDecWithYear = (o.decisions || []).find((d) => d.year);
			if (firstDecWithYear && firstDecWithYear.year) {
				app.year = parseInt(firstDecWithYear.year, 10);
				if (yearEl) yearEl.value = String(app.year);
			}

			const sessionStatus = $('sessionStatus');
			const nDecisions = o.decisions ? o.decisions.length : 0;
			if (sessionStatus) sessionStatus.textContent = `${nDecisions} loaded`;

			if (app.data && app.data.mentions && app.data.mentions.length) {
				runPrepare();
				notice(`Loaded session file with ${nDecisions} decisions.`);
			} else {
				notice(`Session loaded (${nDecisions} decisions). Will apply when you Prepare.`);
			}
		} catch (e) {
			notice('Session file: ' + e.message);
			console.error(e);
		}
	}

	if (sessionFileEl) {
		sessionFileEl.addEventListener('change', () => {
			loadSessionFromFile(sessionFileEl.files[0]);
		});
	}

	if (loadSBtn) {
		loadSBtn.addEventListener('click', () => {
			if (loadSessionFileEl) {
				loadSessionFileEl.value = '';
				loadSessionFileEl.click();
			}
		});
	}

	if (loadSessionFileEl) {
		loadSessionFileEl.addEventListener('change', () => {
			loadSessionFromFile(loadSessionFileEl.files[0]);
		});
	}

	// ---- prepare -----------------------------------------------------------
	function runPrepare() {
		prepareBtn.disabled = true;
		clearNotices();
		app.store.reviewer = reviewerEl.value.trim();
		app.store.county   = countyEl.value;
		app.year           = parseInt(yearEl.value, 10);
		app.county         = countyEl.value;

		try {
			setProgress(95, 'Preparing blocks and anchors\u2026');
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

			showPane('review');
			updateCounter();
			setProgress(100, 'Ready');
			return true;
		} catch (e) {
			prepareBtn.disabled = false;
			notice('Prepare failed: ' + e.message);
			console.error(e);
			return false;
		}
	}

	if (prepareBtn) prepareBtn.addEventListener('click', () => runPrepare());

	// ---- auto-accept -------------------------------------------------------
	if (autoAcceptBtn) {
		autoAcceptBtn.addEventListener('click', () => {
			const n = app.acceptAuto();
			notice('Auto-accepted ' + n + ' match' + (n === 1 ? '' : 'es') + '.');
			updateCounter();
		});
	}

	// ---- exports -----------------------------------------------------------
	if (exportABtn) exportABtn.addEventListener('click', () => { app.exportAssertions(); });
	if (exportSBtn) exportSBtn.addEventListener('click', () => { app.exportSession(); });

	// ---- counter -----------------------------------------------------------
	function updateCounter() {
		const s = app.store.stats();
		if (!counterEl) return;
		if (!s.total) { counterEl.textContent = ''; return; }
		let txt = s.matched + ' matched';
		if (s.anchored) txt += ' (' + s.anchored + ' via EPS)';
		txt += ' \u00b7 ' + s.total + ' decided';
		counterEl.textContent = txt;
	}
	document.addEventListener('verite:decision', () => updateCounter());

	// ---- reload button -----------------------------------------------------
	function setReloadEnabled(on) {
		if (reloadBtn) reloadBtn.disabled = !on;
	}

	if (reloadBtn) reloadBtn.addEventListener('click', () => autoLoad());

	// ---- auto-load on startup ---------------------------------------------
	async function autoLoad() {
		clearNotices();
		setReloadEnabled(false);
		setStatus(mentionsStatus, 'waiting');
		setStatus(eps1850Status,  'waiting');
		setStatus(eps1860Status,  'waiting');
		setReport('Loading\u2026');
		setProgress(0, 'Connecting to data sources\u2026');

		const ok = await loadMentions();
		if (!ok) {
			setProgress(0, 'Failed to load mentions.csv');
			return;
		}

		setProgress(70, 'Loading 1850 slave schedule (eps1850.csv)\u2026');
		await new Promise((r) => setTimeout(r, 10));
		await loadEps(1850, eps1850Status);

		setProgress(76, 'Loading 1860 slave schedule (eps1860.csv)\u2026');
		await new Promise((r) => setTimeout(r, 10));
		await loadEps(1860, eps1860Status);

		app.year   = parseInt(yearEl.value, 10);
		app.county = countyEl.value;

		setProgress(82, 'Running diagnostics\u2026');
		await new Promise((r) => setTimeout(r, 20));
		updateDiagnostics();

		setProgress(90, 'Preparing blocks and anchors\u2026');
		await new Promise((r) => setTimeout(r, 20));
		const prepOk = runPrepare();

		if (prepOk) {
			setProgress(100, 'Ready');
		} else {
			setProgress(90, 'Prepare paused. Ready to retry.');
		}

		setReloadEnabled(true);
	}

	// Kick off immediately.
	autoLoad();

})();
