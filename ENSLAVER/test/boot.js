// test/boot.js — exercises the auto-loading path in boot.js under jsdom, with
// fetch stubbed to serve real files from disk.
//   node test/boot.js /path/to/mentions.csv [eps1850.csv] [eps1860.csv]
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const mentionsPath = process.argv[2];
if (!mentionsPath || !fs.existsSync(mentionsPath)) {
	console.error('usage: node test/boot.js /path/to/mentions.csv [eps1850.csv] [eps1860.csv]');
	process.exit(2);
}
const epsPaths = { 1850: process.argv[3], 1860: process.argv[4] };

let fails = 0;
const ok = (c, label, extra) => {
	if (c) console.log('  pass  ' + label);
	else { fails++; console.log('  FAIL  ' + label + (extra ? '  ' + extra : '')); }
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function makeDom(serve) {
	const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
	const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost:8000/' });
	const { window } = dom;
	window.URL.createObjectURL = () => 'blob:stub';
	window.URL.revokeObjectURL = () => {};
	window.confirm = () => true;
	window.fetch = serve;
	window.TextDecoder = TextDecoder;
	window.ReadableStream = ReadableStream;
	const files = ['../COMMON/match.js', '../COMMON/fellegi.js', 'csv.js', 'data.js', 'holdings.js',
		'candidates.js', 'aligner.js', 'review.js', 'diagnostics.js',
		'ui.js', 'app.js', 'boot.js'];
	for (const f of files) window.eval(fs.readFileSync(path.join(root, f), 'utf8'));
	return dom;
}

// A fetch that streams, so the progress path is the one under test rather than
// the text() fallback.
function streamingServe(map) {
	return async (url) => {
		// Normalize fetch URLs: '../COMMON/mentions.csv' -> 'mentions.csv',
		// './eps1850.csv' -> 'eps1850.csv', etc.
		const name = String(url).replace(/^(?:\.\.\/[^/]+\/|\.\/)/, '');
		const p = map[name];
		if (!p || !fs.existsSync(p)) return { ok: false, status: 404 };
		const buf = fs.readFileSync(p);
		let sent = 0;
		const body = new ReadableStream({
			pull(c) {
				if (sent >= buf.length) { c.close(); return; }
				const end = Math.min(buf.length, sent + 4 * 1024 * 1024);
				c.enqueue(new Uint8Array(buf.subarray(sent, end)));
				sent = end;
			},
		});
		return {
			ok: true, status: 200, body,
			headers: { get: (k) => (k.toLowerCase() === 'content-length' ? String(buf.length) : null) },
			text: async () => buf.toString('utf8'),
		};
	};
}

(async () => {
	console.log('\nno file inputs for the sources');
	{
		const dom = makeDom(async () => ({ ok: false, status: 404 }));
		const d = dom.window.document;
		ok(!d.getElementById('mentionsFile'), 'mentions has no file input');
		ok(!d.getElementById('eps1850File') && !d.getElementById('eps1860File'), 'EPS has no file input');
		ok(!!d.getElementById('sessionFile'), 'an earlier session can still be opened by hand');
		ok(!!d.getElementById('reload'), 'there is a way to reload');
		// let its own autoLoad finish before the window goes away, or the
		// pending promise chain touches a closed document
		await wait(300);
		dom.window.close();
	}

	console.log('\nautomatic load');
	const map = { 'mentions.csv': mentionsPath };
	if (epsPaths[1850]) map['eps1850.csv'] = epsPaths[1850];
	if (epsPaths[1860]) map['eps1860.csv'] = epsPaths[1860];
	const dom = makeDom(streamingServe(map));
	const w = dom.window, d = w.document;

	const t0 = Date.now();
	for (let i = 0; i < 600; i++) {
		if (/mentions/.test(d.getElementById('mentionsStatus').textContent)) break;
		await wait(100);
	}
	const st = d.getElementById('mentionsStatus');
	console.log(`  mentions: ${st.textContent}  (${Date.now() - t0} ms)`);
	ok(st.classList.contains('ok'), 'mentions.csv loaded without being chosen');
	ok(w.verite.data.mentions.length > 0, 'mentions are in memory', String(w.verite.data.mentions.length));
	ok(d.getElementById('county').options.length > 0, 'counties populated from the data');

	for (const y of [1850, 1860]) {
		const s = d.getElementById('eps' + y + 'Status').textContent;
		console.log(`  eps${y}: ${s}`);
		if (map['eps' + y + '.csv']) ok(!!w.verite.eps[y], `eps${y} loaded`);
		else ok(/not in this folder/.test(s), `eps${y} absence reported plainly, not as an error`);
	}

	console.log('\ndiagnostics run on their own');
	for (let i = 0; i < 100; i++) {
		if (d.getElementById('report').textContent.indexOf('Enumerator blocks') >= 0) break;
		await wait(100);
	}
	const rep = d.getElementById('report').textContent;
	ok(rep.indexOf('Enumerator blocks') >= 0, 'the diagnostics report rendered without being asked');
	ok(!d.getElementById('prepare').disabled, 'Prepare is enabled once the data is in');

	console.log('\nyear switch stays offline');
	{
		let calls = 0;
		const inner = streamingServe(map);
		w.fetch = (...a) => { calls++; return inner(...a); };
		const sel = d.getElementById('year');
		sel.value = '1860';
		sel.dispatchEvent(new w.Event('change'));
		await wait(50);
		ok(calls === 0, 'switching year does not go back to the network', String(calls));
		ok(d.getElementById('report').textContent.indexOf('1860') >= 0, 'diagnostics follow the year');
	}

	console.log('\nprepare and review');
	{
		const sel = d.getElementById('year');
		sel.value = '1850'; sel.dispatchEvent(new w.Event('change'));
		await wait(50);
		d.getElementById('prepare').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
		for (let i = 0; i < 200; i++) {
			if (d.getElementById('review').classList.contains('active')) break;
			await wait(100);
		}
		ok(d.getElementById('review').classList.contains('active'), 'review pane opens after Prepare');
		ok(d.querySelectorAll('#review .qrow').length > 0, 'the enslaver queue is populated');
	}
	dom.window.close();

	console.log('\nserved from the filesystem');
	{
		const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
		const fdom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'file:///tmp/index.html' });
		fdom.window.fetch = async () => { throw new TypeError('Failed to fetch'); };
		fdom.window.URL.createObjectURL = () => 'blob:stub';
		for (const f of ['../COMMON/match.js', '../COMMON/fellegi.js', 'csv.js', 'data.js', 'holdings.js',
			'candidates.js', 'aligner.js', 'review.js', 'diagnostics.js',
			'ui.js', 'app.js', 'boot.js']) {
			fdom.window.eval(fs.readFileSync(path.join(root, f), 'utf8'));
		}
		await wait(300);
		const r = fdom.window.document.getElementById('report').textContent;
		ok(/http\.server/.test(r), 'a file:// page says exactly what to do instead of failing silently');
		ok(!fdom.window.document.getElementById('reload').disabled, 'reload is available after a failure');
		fdom.window.close();
	}

	console.log(fails ? `\n${fails} failing check(s)\n` : '\nall checks passed\n');
	process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
