// csv.js
// ---------------------------------------------------------------------------
// Delimited-text parsing for Verite. RFC4180 quoting, BOM stripping, automatic
// comma/tab sniffing, and a chunked async mode so a 170k-row mentions.csv does
// not freeze the tab while it loads.
//
// Header quirks this must survive, because the real files have them:
//   - a UTF-8 BOM glued to the first header name
//   - an empty header name (mentions.csv has one at column 3)
//   - duplicate header names
// Empty and duplicate names are given synthetic keys rather than silently
// overwriting a real column.
// ---------------------------------------------------------------------------

class CSV {

	static sniffDelimiter(sample) {
		const line = String(sample).split(/\r?\n/, 1)[0] || '';
		let inQ = false, commas = 0, tabs = 0, pipes = 0;
		for (const ch of line) {
			if (ch === '"') { inQ = !inQ; continue; }
			if (inQ) continue;
			if (ch === ',') commas++;
			else if (ch === '\t') tabs++;
			else if (ch === '|') pipes++;
		}
		if (tabs > commas && tabs >= pipes) return '\t';
		if (pipes > commas && pipes > tabs) return '|';
		return ',';
	}

	// Split one delimited text blob into an array of string arrays.
	// Handles quoted fields containing the delimiter, newlines, and "" escapes.
	static parseRows(text, delim) {
		if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
		const rows = [];
		let row = [], field = '', inQ = false, i = 0;
		const n = text.length;
		while (i < n) {
			const c = text[i];
			if (inQ) {
				if (c === '"') {
					if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
					inQ = false; i++; continue;
				}
				field += c; i++; continue;
			}
			if (c === '"') { inQ = true; i++; continue; }
			if (c === delim) { row.push(field); field = ''; i++; continue; }
			if (c === '\r') { i++; continue; }
			if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
			field += c; i++;
		}
		if (field.length || row.length) { row.push(field); rows.push(row); }
		return rows;
	}

	static makeHeader(rawHeader) {
		const seen = new Map();
		return rawHeader.map((h, idx) => {
			let name = String(h == null ? '' : h).replace(/^\uFEFF/, '').trim();
			if (!name) name = 'col' + idx;
			if (seen.has(name)) {
				const k = seen.get(name) + 1;
				seen.set(name, k);
				name = name + '__' + k;
			} else {
				seen.set(name, 0);
			}
			return name;
		});
	}

	// Synchronous parse to array of plain objects. Fine for the EPS files.
	static parse(text, opts = {}) {
		const delim = opts.delimiter || CSV.sniffDelimiter(text);
		const rows = CSV.parseRows(text, delim);
		if (!rows.length) return { header: [], rows: [], delimiter: delim };
		const header = CSV.makeHeader(rows[0]);
		const out = [];
		for (let r = 1; r < rows.length; r++) {
			const cells = rows[r];
			if (cells.length === 1 && cells[0] === '') continue;
			const o = {};
			for (let c = 0; c < header.length; c++) o[header[c]] = cells[c] !== undefined ? cells[c] : '';
			out.push(o);
		}
		return { header, rows: out, delimiter: delim };
	}

	// Chunked parse. Yields to the event loop every `chunk` rows so a progress
	// callback can actually paint. Returns a promise of the same shape as parse().
	//
	// rowFn, when supplied, is called per row and its return value is stored
	// instead of the plain object. Returning null drops the row. Building the
	// final record here rather than in a second pass halves the peak allocation,
	// which matters at 170k rows in a browser tab.
	static parseAsync(text, opts = {}) {
		const delim = opts.delimiter || CSV.sniffDelimiter(text);
		const chunk = opts.chunk || 8000;
		const onProgress = opts.onProgress || null;
		const rowFn = opts.rowFn || null;

		const rows = CSV.parseRows(text, delim);
		const header = rows.length ? CSV.makeHeader(rows[0]) : [];
		const total = Math.max(0, rows.length - 1);
		const out = [];

		return new Promise((resolve) => {
			let r = 1;
			const step = () => {
				const end = Math.min(rows.length, r + chunk);
				for (; r < end; r++) {
					const cells = rows[r];
					if (cells.length === 1 && cells[0] === '') continue;
					const o = {};
					for (let c = 0; c < header.length; c++) o[header[c]] = cells[c] !== undefined ? cells[c] : '';
					const rec = rowFn ? rowFn(o, r - 1) : o;
					if (rec !== null && rec !== undefined) out.push(rec);
				}
				if (onProgress) onProgress(Math.min(r - 1, total), total);
				if (r < rows.length) setTimeout(step, 0);
				else resolve({ header, rows: out, delimiter: delim, total });
			};
			step();
		});
	}

	// Serialize back out. Quotes only what needs it.
	static stringify(records, columns, delim = ',') {
		const cols = columns || (records.length ? Object.keys(records[0]) : []);
		const esc = (v) => {
			const s = (v === null || v === undefined) ? '' : String(v);
			return /["\n\r]|[,\t|]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
		};
		const lines = [cols.join(delim)];
		for (const rec of records) lines.push(cols.map((c) => esc(rec[c])).join(delim));
		return lines.join('\n') + '\n';
	}

	static readFile(file, onProgress) {
		return new Promise((resolve, reject) => {
			const fr = new FileReader();
			fr.onerror = () => reject(new Error('Could not read ' + file.name));
			if (onProgress) fr.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded, e.total); };
			fr.onload = () => resolve(String(fr.result));
			fr.readAsText(file);
		});
	}
}

if (typeof window !== 'undefined') window.CSV = CSV;
if (typeof module !== 'undefined' && module.exports) module.exports = { CSV };
