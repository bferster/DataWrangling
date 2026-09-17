// data.js
// ---------------------------------------------------------------------------
// VeriteData  — mentions.csv, indexed for this task.
// EpsSource   — an IPUMS full-count enslaved-population file, grouped into
//               holdings.
//
// The hoisted fields (_line, _enum, _date, _ipums, _head) exist because the
// three signals this whole app runs on — enumerator block, enumeration order,
// and enumeration date — are not columns. The first is buried in the `data`
// JSONB, the second is the tail of the mention_id, and the third is stored as
// a month.day float that must never be compared as a number: 7.9 is July 9 and
// sorts BELOW 7.13, which is July 13. Everything is converted once, here.
// ---------------------------------------------------------------------------

class VeriteData {

	constructor() {
		this.mentions = [];
		this.bySource = new Map();       // source string -> mention[]
		this.byId = new Map();           // mention_id -> mention
		this.households = new Map();     // household_id -> mention[]
		this.byIpums = new Map();        // UPPERCASE ipums id -> mention
		this.counties = new Set();
		this.ipumsCoverage = { withId: 0, total: 0 };
	}

	static MONTH_DAYS = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];

	// "7.5" -> July 5 -> day-of-year. Returns null when unparseable or when the
	// value is the "-" / blank placeholder.
	static parseEnumDate(v) {
		if (v === null || v === undefined) return null;
		const s = String(v).trim();
		if (!s || s === '-' || s.toLowerCase() === 'null') return null;
		const m = s.match(/^(\d{1,2})[.\/](\d{1,2})$/);
		if (!m) return null;
		const mo = parseInt(m[1], 10), da = parseInt(m[2], 10);
		if (!(mo >= 1 && mo <= 12) || !(da >= 1 && da <= 31)) return null;
		return VeriteData.MONTH_DAYS[mo - 1] + da;
	}

	static dateLabel(ord) {
		if (ord == null) return '';
		const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
		for (let i = 11; i >= 0; i--) {
			if (ord > VeriteData.MONTH_DAYS[i]) return names[i] + ' ' + (ord - VeriteData.MONTH_DAYS[i]);
		}
		return '';
	}

	// AUG-CN-1860-8437  -> 8437     (a ".2" disambiguator suffix is dropped)
	static lineOf(mentionId) {
		const s = String(mentionId || '');
		const tail = s.slice(s.lastIndexOf('-') + 1);
		const n = parseInt(String(tail).split('.')[0], 10);
		return Number.isFinite(n) ? n : null;
	}

	static countyOf(mentionId) {
		const s = String(mentionId || '');
		const i = s.indexOf('-');
		return i > 0 ? s.slice(0, i) : '';
	}

	static truthy(v) {
		const s = String(v == null ? '' : v).trim().toLowerCase();
		return s === 't' || s === 'true' || s === 'y' || s === 'yes' || s === '1';
	}

	// Build one working record from a raw mentions.csv row.
	static shape(raw) {
		const rec = raw;
		let extra = null;
		if (rec.data && String(rec.data).trim() && String(rec.data).trim() !== 'null') {
			try { extra = JSON.parse(rec.data); } catch (e) { extra = null; }
		}
		rec._extra = extra || {};
		rec._enum = (extra && extra.enum != null && String(extra.enum).trim() !== '' && String(extra.enum).trim() !== '-')
			? String(extra.enum).trim() : null;
		rec._date = VeriteData.parseEnumDate(extra && extra.enum_date);
		rec._prop = (extra && extra.prop_value != null) ? Number(extra.prop_value) : null;
		// ipums_id may arrive under any of these spellings depending on ingest vintage
		const ip = (extra && (extra.ipums_id || extra.ipumsId || extra.histid || extra.HISTID)) || rec.ipums_id || '';
		rec._ipums = String(ip || '').trim().toUpperCase();
		rec._line = VeriteData.lineOf(rec.mention_id);
		rec._head = VeriteData.truthy(rec.head);
		rec._county = VeriteData.countyOf(rec.mention_id);
		rec._year = parseInt(rec.source_year, 10) || null;
		return rec;
	}

	async loadMentions(text, onProgress) {
		const res = await CSV.parseAsync(text, {
			onProgress,
			rowFn: (row) => (row.mention_id ? VeriteData.shape(row) : null),
		});
		this.mentions = res.rows;
		this._index();
		return this;
	}

	_index() {
		this.bySource.clear(); this.byId.clear();
		this.households.clear(); this.byIpums.clear(); this.counties.clear();
		let withId = 0;
		for (const m of this.mentions) {
			this.byId.set(m.mention_id, m);
			if (m._county) this.counties.add(m._county);
			let a = this.bySource.get(m.source);
			if (!a) { a = []; this.bySource.set(m.source, a); }
			a.push(m);
			const h = String(m.household_id || '').trim();
			if (h) {
				let hh = this.households.get(h);
				if (!hh) { hh = []; this.households.set(h, hh); }
				hh.push(m);
			}
			if (m._ipums) {
				withId++;
				if (!this.byIpums.has(m._ipums)) this.byIpums.set(m._ipums, m);
			}
		}
		for (const arr of this.bySource.values()) arr.sort((a, b) => (a._line || 0) - (b._line || 0));
		this.ipumsCoverage = { withId, total: this.mentions.length };
	}

	sourceName(county, type, year) { return county + '-' + type + '-' + year; }

	census(county, year) { return this.bySource.get(this.sourceName(county, 'CN', year)) || []; }
	heads(county, year) { return this.census(county, year).filter((m) => m._head); }
	schedule(county, year) { return this.bySource.get(this.sourceName(county, 'SS', year)) || []; }

	// Enslaver rows on a slave schedule. legal_status 'H' is set at ingest.
	owners(county, year) {
		return this.schedule(county, year).filter((m) => String(m.legal_status || '').toUpperCase() === 'H');
	}

	// One holding per enslaver row: the owner plus every enslaved mention the
	// ingest hung on the same household_id.
	holdings(county, year) {
		const out = [];
		const byHH = new Map();
		for (const m of this.schedule(county, year)) {
			const h = String(m.household_id || '').trim();
			if (!h) continue;
			let g = byHH.get(h);
			if (!g) { g = { household_id: h, owner: null, people: [] }; byHH.set(h, g); }
			if (String(m.legal_status || '').toUpperCase() === 'H') g.owner = m;
			else g.people.push(m);
		}
		for (const g of byHH.values()) {
			g.people.sort((a, b) => (a._line || 0) - (b._line || 0));
			g.line = g.owner ? g.owner._line : (g.people[0] ? g.people[0]._line : null);
			g.size = g.people.length;
			g.enumBlock = g.owner ? g.owner._enum : (g.people[0] ? g.people[0]._enum : null);
			out.push(g);
		}
		out.sort((a, b) => (a.line || 0) - (b.line || 0));
		out.forEach((g, i) => { g.order = i; });
		return out;
	}

	// Candidate pool for enslaver matching. Deliberately NOT restricted to heads
	// of household: widows living with a son and adult sons in a father's house
	// are enslavers who are not heads, and filtering them out loses the match
	// rather than merely lowering its rank. Head status is scored, not required.
	censusPool(county, year, opts = {}) {
		const minAge = opts.minAge != null ? opts.minAge : 18;
		const pool = [];
		for (const m of this.census(county, year)) {
			const by = parseInt(m.birth_year, 10);
			if (Number.isFinite(by) && (year - by) < minAge) continue;
			pool.push(m);
		}
		pool.forEach((m, i) => { m._poolRank = i; });
		return pool;
	}

	// Without blocking: the entire county is compared as a single unified pool
	// rather than partitioning into separate enumerator blocks.
	blocks(county, year) {
		const owners = this.owners(county, year);
		const pool = this.censusPool(county, year);
		owners.sort((a, c) => (a._line || 0) - (c._line || 0));
		pool.sort((a, c) => (a._line || 0) - (c._line || 0));
		owners.forEach((o, i) => { o._blockRank = i; });
		const rankOf = new Map();
		pool.forEach((c, i) => { rankOf.set(c.mention_id, i); });
		const b = {
			key: 'county',
			owners,
			candidates: pool,
			nOwners: owners.length,
			nCandidates: pool.length,
			rankOf,
			rank: (c) => (c ? rankOf.get(c.mention_id != null ? c.mention_id : c) : undefined),
			unblocked: true,
			year,
		};
		return [b];
	}

	householdOf(mention) {
		const h = String(mention && mention.household_id || '').trim();
		if (!h || !this.households.has(h)) return [];
		return this.households.get(h).filter((x) => x !== mention);
	}
}


// ---------------------------------------------------------------------------
// EpsSource — one eps18xx.csv, grouped into holdings.
//
// The file is one row per enslaved person. The enslaver identifiers ride on
// every row of the holding, so the first job is to collapse to holdings. HISTID
// is documented as a 36-character string matching the slaveholder's HISTID in
// the IPUMS full count population data; if it arrives as a short integer the
// file has been through a transform that destroyed the join, and joinRate()
// will report zero rather than pretending.
// ---------------------------------------------------------------------------

class EpsSource {

	constructor(year) {
		this.year = year;
		this.rows = [];
		this.holdings = [];
		this.byHoldnum = new Map();
		this.idLooksLikeGuid = false;
	}

	static SEX = { '1': 'M', '2': 'F' };
	// IPUMS RACE codes present in the enslaved files.
	static RACE = { '100': 'W', '200': 'B', '210': 'M', '120': 'B' };

	static num(v) {
		const n = parseInt(String(v == null ? '' : v).trim(), 10);
		return Number.isFinite(n) ? n : null;
	}

	static id(v) {
		const s = String(v == null ? '' : v).trim().toUpperCase();
		if (!s || s === '.' || s === 'NULL') return '';
		return s;
	}

	static isGuid(s) { return /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/.test(s); }

	load(text) {
		const res = CSV.parse(text);
		this.rows = res.rows;
		this.header = res.header;
		this._group();
		return this;
	}

	_group() {
		this.holdings = []; this.byHoldnum.clear();
		let guidSeen = 0, idSeen = 0;

		for (const r of this.rows) {
			const hn = EpsSource.num(r.holdnum);
			if (hn == null) continue;
			let h = this.byHoldnum.get(hn);
			if (!h) {
				h = {
					holdnum: hn,
					sizehold: EpsSource.num(r.sizehold),
					county: String(r.county || '').trim(),
					countyicp: String(r.countyicp || '').trim(),
					statefip: String(r.statefip || '').trim(),
					histid: EpsSource.id(r.histid),
					histid2: EpsSource.id(r.histid2),
					histid3: EpsSource.id(r.histid3),
					nholders: EpsSource.num(r.nholders),
					nlinksHolding: EpsSource.num(r.nlinks_holding),
					sh1type: String(r.sh1type || '').trim(),
					linkpop: String(r.linkpop || '').trim(),
					nhouses: EpsSource.num(r.nhouses),
					people: [],
				};
				this.byHoldnum.set(hn, h);
				this.holdings.push(h);
			}
			const age = EpsSource.num(r.age);
			const sex = EpsSource.SEX[String(r.sex).trim()] || (r.gender ? String(r.gender).trim().toUpperCase() : '');
			const race = EpsSource.RACE[String(r.race).trim()] || (r.norm_race ? String(r.norm_race).trim().toUpperCase() : '');
			h.people.push({
				slavenum: EpsSource.num(r.slavenum),
				age,
				sex,
				race,
				histid_slave: EpsSource.id(r.histid_slave),
			});
			if (h.histid) { idSeen++; if (EpsSource.isGuid(h.histid)) guidSeen++; }
		}

		for (const h of this.holdings) {
			h.people.sort((a, b) => (a.slavenum || 0) - (b.slavenum || 0));
			h.size = h.people.length;
			h.holderIds = [h.histid, h.histid2, h.histid3].filter(Boolean);
			h.linked = h.holderIds.length > 0;
		}
		this.holdings.sort((a, b) => a.holdnum - b.holdnum);
		this.holdings.forEach((h, i) => { h.order = i; });
		this.idLooksLikeGuid = idSeen > 0 && (guidSeen / idSeen) > 0.9;
	}

	// How many holdings carry a usable slaveholder identifier, and how many of
	// those identifiers actually appear in the census we hold. These are two
	// different numbers and the second is the one that matters.
	joinReport(data) {
		let linked = 0, resolvable = 0;
		const missing = [];
		for (const h of this.holdings) {
			if (!h.linked) continue;
			linked++;
			const hit = data.byIpums.get(h.histid);
			if (hit) { h._censusMention = hit; resolvable++; }
			else if (missing.length < 25) missing.push(h.histid);
		}
		return {
			holdings: this.holdings.length,
			linked,
			resolvable,
			linkedRate: this.holdings.length ? linked / this.holdings.length : 0,
			resolvableRate: linked ? resolvable / linked : 0,
			idLooksLikeGuid: this.idLooksLikeGuid,
			sampleUnresolved: missing,
		};
	}

	sizeHistogram() {
		const h = new Map();
		for (const x of this.holdings) h.set(x.size, (h.get(x.size) || 0) + 1);
		return [...h.entries()].sort((a, b) => a[0] - b[0]);
	}
}

if (typeof window !== 'undefined') { window.VeriteData = VeriteData; window.EpsSource = EpsSource; }
if (typeof module !== 'undefined' && module.exports) module.exports = { VeriteData, EpsSource };
