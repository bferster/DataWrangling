/**
 * CensusLinker — links people in the 1870 US census to the same people in the
 * 1880 US census for one county, from two in-memory tables (MENTIONS, ASSERTIONS).
 *
 * PRIMARY OUTPUT: a list of isSameAs assertion rows with calibrated confidence
 * in [0, 0.99], plus evidence bundles, hypotheses, unmatched list, and stats.
 *
 * Design: additive log-odds scoring -> logistic squash. Knockout gates live
 * OUTSIDE the scoring model. Feature vectors are emitted per pair so a fitted
 * logistic regression can later replace the hand-set weight table with no
 * structural change. Vanilla ES2020+, zero dependencies, deterministic.
 *
 * Phases:
 *   0 Preprocessor    — indexes, rarity tables, mortality index, kin edges,
 *                       enumeration-sequence adjacency (household_id proxy)
 *   1 Blocker         — union of three blocking passes
 *   2 PairScorer      — knockouts, Levers A/B + race + occupation
 *   3 FamilyAligner   — family-graph alignment, drift, fission/fusion,
 *                       Levers C/D, exactly two propagation rounds
 *   4 Assigner        — global one-to-one assignment, collisions
 *   5 OutputBuilder   — assertion rows, bundles, hypotheses, stats
 */

'use strict';

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */

const DEFAULT_NICKNAMES = {
	sallie: 'sarah', sally: 'sarah',
	bettie: 'elizabeth', betty: 'elizabeth', betsy: 'elizabeth', lizzie: 'elizabeth', eliza: 'elizabeth', bess: 'elizabeth',
	polly: 'mary', mollie: 'mary', molly: 'mary',
	fannie: 'frances', fanny: 'frances', frank_f: 'frances',
	nannie: 'nancy',
	kitty: 'catherine', katie: 'catherine', kate: 'catherine', cathy: 'catherine',
	peggy: 'margaret', maggie: 'margaret',
	patsy: 'martha', mattie: 'martha', patty: 'martha',
	jennie: 'jane', jenny: 'jane', jenetta: 'jane', jeanette: 'jane',
	becky: 'rebecca',
	lou: 'louisa', louise: 'louisa',
	vicky: 'victoria',
	willie: 'william', billy: 'william', bill: 'william', will: 'william',
	jim: 'james', jimmy: 'james',
	jack: 'john', johnny: 'john',
	hank: 'henry', harry: 'henry',
	alex: 'alexander', sandy: 'alexander',
	ned: 'edward', ed: 'edward', eddie: 'edward',
	tom: 'thomas', tommy: 'thomas',
	dick: 'richard',
	bob: 'robert', bobby: 'robert',
	dan: 'daniel', danny: 'daniel',
	dave: 'david',
	gus: 'augustus',
	sam: 'samuel',
	ben: 'benjamin',
	josh: 'joshua',
	nat: 'nathaniel',
	abe: 'abraham',
	tony: 'anthony',
};

function defaultConfig() {
	let uuidCounter = 0;
	return {
		// adjacency proxy (families, by enumeration-sequence order)
		adjacencyTight: 1,
		adjacencyWide: 15,
		maxHouseholdSize: 30,       // 1870 dwelling groups above this are ignored
		// rarity thresholds (occurrence counts within the 1870 census pool)
		rareCount: 3,
		commonCount: 30,
		// family alignment
		driftQuorum: 3,
		alignmentPrecedence: 1.2,   // bundle score needed for assignment priority
		// tiers (confidence)
		tier1: 0.98,  // was .98
		tier2: 0.60,  // was.75
		collisionBand: 0.05,
		// generational plausibility window (parent age at child's birth)
		genMinParentAge: 13,
		genMaxParentAge: 70,
		// spouse inference (1870)
		spouseMaxAgeGap: 15,
		childMinGapFromHead: 13,
		adultAge: 16,
		// knockouts
		maxBirthGap: 10,
		maxAgeRegression: 2,
		deathBirthWindow: 3,
		// blocking windows
		blockSurnameYearWindow: 12,
		blockGivenYearWindow: 5,
		// pruning: keep a pair only if base + max possible bonuses could reach tier2
		maxBonus: 3.0,              // leverC cap (2.4) + leverD cap (0.6)
		// log-odds weight table (THE MODEL — swappable for fitted LR coefficients)
		weights: {
			intercept: -4.0,
			A_exactFirstSurname: 4.0,
			A_nicknameSurname: 3.0,
			A_initialSurname: 2.5,
			A_givenOnly: 1.5,
			A_maleSurnameMismatch: -3.0,
			rarityRare: 1.5,
			rarityTypical: 1.0,
			rarityCommon: 0.5,
			B_exact: 2.0, B_1: 1.6, B_2: 1.2, B_3: 0.7, B_5: 0.3, B_6to10: -1.0,
			raceAgree: 0.5,
			raceConflict: -1.5,
			occupation: 0.4,
			C_spouse: 1.2, C_member: 0.6, C_cap: 2.4,
			D_neighbor: 0.3, D_cap: 0.6,
		},
		jwThreshold: 0.85,
		nicknameTable: DEFAULT_NICKNAMES,
		surnameBridges: new Map(),  // injected "surnameA|surnameB" -> true (VRM marriage bridges, v1 stub)
		// injectables for determinism in tests
		uuidFn: () => {
			// Browser (secure context) and modern runtimes expose crypto.randomUUID.
			if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
			if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
				const b = crypto.getRandomValues(new Uint8Array(16));
				b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
				const h = [...b].map((x) => x.toString(16).padStart(2, '0'));
				return `${h.slice(0, 4).join('')}-${h.slice(4, 6).join('')}-${h.slice(6, 8).join('')}-${h.slice(8, 10).join('')}-${h.slice(10).join('')}`;
			}
			return `uuid-${++uuidCounter}`;
		},
		nowFn: () => new Date().toISOString(),
		logger: null,
		engineName: 'CensusLinker-v1',
	};
}

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

const sigmoid = (x) => 1 / (1 + Math.exp(-x));
const logit = (p) => Math.log(p / (1 - p));

function toInt(v) {
	if (v === null || v === undefined || v === '') return null;
	const n = parseInt(v, 10);
	return Number.isFinite(n) ? n : null;
}

function isTrue(v) {
	if (v === true) return true;
	if (v === null || v === undefined) return false;
	const s = String(v).trim().toLowerCase();
	return s === 'true' || s === 't' || s === '1' || s === 'yes' || s === 'y';
}

function normStr(s) {
	return (s === null || s === undefined) ? '' : String(s).trim().toLowerCase();
}

function cleanName(s) {
	return normStr(s).replace(/[^a-z]/g, '');
}

/** numeric line component of a mention_id, e.g. ALB-CN-1870-432.1 -> 432 */
function parseSeq(mentionId) {
	const m = /-(\d+)(?:\.\d+)?$/.exec(String(mentionId));
	return m ? parseInt(m[1], 10) : null;
}

/** Jaro-Winkler similarity (implemented locally per spec). */
function jaroWinkler(a, b) {
	a = cleanName(a); b = cleanName(b);
	if (!a || !b) return 0;
	if (a === b) return 1;
	const window = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
	const aFlags = new Array(a.length).fill(false);
	const bFlags = new Array(b.length).fill(false);
	let matches = 0;
	for (let i = 0; i < a.length; i++) {
		const lo = Math.max(0, i - window), hi = Math.min(b.length - 1, i + window);
		for (let j = lo; j <= hi; j++) {
			if (!bFlags[j] && a[i] === b[j]) { aFlags[i] = true; bFlags[j] = true; matches++; break; }
		}
	}
	if (matches === 0) return 0;
	let t = 0, k = 0;
	for (let i = 0; i < a.length; i++) {
		if (!aFlags[i]) continue;
		while (!bFlags[k]) k++;
		if (a[i] !== b[k]) t++;
		k++;
	}
	t /= 2;
	const jaro = (matches / a.length + matches / b.length + (matches - t) / matches) / 3;
	let prefix = 0;
	for (let i = 0; i < Math.min(4, a.length, b.length); i++) {
		if (a[i] === b[i]) prefix++; else break;
	}
	return jaro + prefix * 0.1 * (1 - jaro);
}

/* ------------------------------------------------------------------ */
/* Phase 0 — Preprocessor                                              */
/* ------------------------------------------------------------------ */

class Preprocessor {
	constructor(mentions, assertions, config) {
		this.config = config;
		this.mentions = mentions;
		this.assertions = assertions;
	}

	/** Normalize a raw mention row into a working record. */
	wrap(row, censusYear) {
		const nf = cleanName(row.norm_first_name) || cleanName(row.first_name);
		return {
			id: String(row.mention_id),
			seq: parseSeq(row.mention_id),
			first: cleanName(row.first_name),
			last: cleanName(row.last_name),
			normFirst: nf,
			canonFirst: this.config.nicknameTable[nf] || nf,
			initial: (cleanName(row.first_name) || nf).charAt(0),
			nysiis: normStr(row.nysiis_last_name),
			soundex: normStr(row.soundex_last_name),
			birthYear: toInt(row.birth_year),
			gender: normStr(row.gender).toUpperCase(),
			race: (normStr(row.norm_race) || normStr(row.race)).toUpperCase(),
			occupation: normStr(row.norm_occupation),
			head: isTrue(row.head),
			familyId: normStr(row.family_id) ? String(row.family_id) : null,
			householdId: normStr(row.household_id) ? String(row.household_id) : null,
			censusYear,
			// kin roles, filled below
			isSpouseNode: false,
			parents: [],   // mention_ids
			row,
		};
	}

	build() {
		const cfg = this.config;
		const p = {
			m1870: [], m1880: [],
			byId: new Map(),
			// rarity: frequency within the 1870 census pool (per spec)
			surnameFreq1870: new Map(),
			givenFreq1870: new Map(),
			// mortality index: nysiis|canonFirst -> [{birthYear, deathYear}]
			mortality: new Map(),
			// isNotSameAs pairs: "a|b" (sorted)
			notSame: new Set(),
			// surname bridges (config-injected + hasNameVariant derived): "a|b" sorted
			bridges: new Set(),
			// families
			families1870: new Map(), families1880: new Map(), // familyId -> [rec]
			famOrder1870: new Map(), famOrder1880: new Map(), // familyId -> order index
			// oversized-dwelling ids (1870) ignored for co-residence evidence
			oversizedHouseholds: new Set(),
			// 1880 kin edges from relation assertions
			spouseEdges1880: new Set(),       // "a|b" sorted mention ids
			childToParent1880: [],            // {child, parent, assertionId, confidence}
		};

		for (const row of this.mentions) {
			const src = normStr(row.source).toUpperCase();
			if (src.endsWith('CN-1870')) {
				const r = this.wrap(row, 1870);
				p.m1870.push(r); p.byId.set(r.id, r);
			} else if (src.endsWith('CN-1880')) {
				const r = this.wrap(row, 1880);
				p.m1880.push(r); p.byId.set(r.id, r);
			} else if (src.includes('VRD') || src.endsWith('FG') || src.includes('-FG')) {
				const dy = toInt(row.death_year);
				if (dy !== null) {
					const key = `${normStr(row.nysiis_last_name)}|${this.config.nicknameTable[cleanName(row.norm_first_name) || cleanName(row.first_name)] ||
						(cleanName(row.norm_first_name) || cleanName(row.first_name))}`;
					if (!p.mortality.has(key)) p.mortality.set(key, []);
					p.mortality.get(key).push({ birthYear: toInt(row.birth_year), deathYear: dy });
				}
			}
		}

		// deterministic ordering
		p.m1870.sort((a, b) => (a.id < b.id ? -1 : 1));
		p.m1880.sort((a, b) => (a.id < b.id ? -1 : 1));

		// rarity tables (1870 pool)
		for (const r of p.m1870) {
			if (r.last) p.surnameFreq1870.set(r.last, (p.surnameFreq1870.get(r.last) || 0) + 1);
			if (r.canonFirst) p.givenFreq1870.set(r.canonFirst, (p.givenFreq1870.get(r.canonFirst) || 0) + 1);
		}

		// families + oversized 1870 dwellings
		const hhCount = new Map();
		for (const r of p.m1870) {
			if (r.familyId) {
				if (!p.families1870.has(r.familyId)) p.families1870.set(r.familyId, []);
				p.families1870.get(r.familyId).push(r);
			}
			if (r.householdId) hhCount.set(r.householdId, (hhCount.get(r.householdId) || 0) + 1);
		}
		for (const [hh, n] of hhCount) if (n > cfg.maxHouseholdSize) p.oversizedHouseholds.add(hh);
		for (const r of p.m1880) {
			if (r.familyId) {
				if (!p.families1880.has(r.familyId)) p.families1880.set(r.familyId, []);
				p.families1880.get(r.familyId).push(r);
			}
		}

		// family enumeration order (by min member sequence) — the household proxy
		const orderOf = (fams, out) => {
			const list = [...fams.entries()].map(([fid, members]) => ({
				fid,
				minSeq: Math.min(...members.map((m) => (m.seq === null ? Infinity : m.seq))),
			}));
			list.sort((a, b) => (a.minSeq - b.minSeq) || (a.fid < b.fid ? -1 : 1));
			list.forEach((e, i) => out.set(e.fid, i));
		};
		orderOf(p.families1870, p.famOrder1870);
		orderOf(p.families1880, p.famOrder1880);

		// assertions: notSame, bridges, 1880 kin edges
		const kinPreds = new Set(['isspouseof', 'ischildof', 'isparentof']);
		for (const a of this.assertions) {
			const pred = normStr(a.predicate);
			const s = String(a.subject_id), o = String(a.object_id);
			if (pred === 'isnotsameas') {
				p.notSame.add(s < o ? `${s}|${o}` : `${o}|${s}`);
				continue;
			}
			if (pred === 'hasnamevariant') {
				const rs = p.byId.get(s), ro = p.byId.get(o);
				if (rs && ro && rs.last && ro.last && rs.last !== ro.last) {
					const k = rs.last < ro.last ? `${rs.last}|${ro.last}` : `${ro.last}|${rs.last}`;
					p.bridges.add(k);
				}
				continue;
			}
			if (!kinPreds.has(pred)) continue;
			const rs = p.byId.get(s), ro = p.byId.get(o);
			if (!rs || !ro || rs.censusYear !== 1880 || ro.censusYear !== 1880) continue;
			if (pred === 'isspouseof') {
				p.spouseEdges1880.add(s < o ? `${s}|${o}` : `${o}|${s}`);
				rs.isSpouseNode = !rs.head || true; // refined below
				ro.isSpouseNode = true;
			} else if (pred === 'ischildof' || pred === 'isparentof') {
				// Direction is oriented by birth years when both are known (the unique
				// plausible direction wins). Observed ingest convention as fallback:
				// isChildOf: subject=PARENT, object=child; isParentOf: subject=child.
				let parent, child;
				const gap = (c, p) => (c.birthYear !== null && p.birthYear !== null)
					? c.birthYear - p.birthYear : null;
				const gSO = gap(ro, rs); // rs=parent, ro=child
				const gOS = gap(rs, ro); // ro=parent, rs=child
				const plaus = (g) => g !== null && g >= 13 && g <= 60;
				if (plaus(gSO) && !plaus(gOS)) { parent = rs; child = ro; }
				else if (plaus(gOS) && !plaus(gSO)) { parent = ro; child = rs; }
				else if (pred === 'ischildof') { parent = rs; child = ro; }
				else { parent = ro; child = rs; }
				p.childToParent1880.push({ child: child.id, parent: parent.id, assertionId: a.assertion_id, confidence: a.confidence });
				child.parents.push(parent.id);
			}
		}
		// spouse node = has a spouse edge and is not the head (the "wife" side of a couple)
		for (const r of p.m1880) {
			if (r.isSpouseNode && r.head) r.isSpouseNode = false;
		}

		// injected surname bridges
		for (const key of this.config.surnameBridges.keys()) {
			const [x, y] = String(key).split('|').map(cleanName);
			if (x && y) p.bridges.add(x < y ? `${x}|${y}` : `${y}|${x}`);
		}

		// infer 1870 kin edges (tagged inferred; hints only — never veto, never flag)
		for (const members of p.families1870.values()) {
			const head = members.find((m) => m.head) || null;
			if (!head || head.birthYear === null) continue;
			for (const m of members) {
				if (m === head) continue;
				if (
					m.gender && head.gender && m.gender !== head.gender &&
					m.birthYear !== null &&
					Math.abs(m.birthYear - head.birthYear) <= cfg.spouseMaxAgeGap &&
					(1870 - m.birthYear) >= cfg.adultAge &&
					!members.some((x) => x !== m && x.isSpouseNode)
				) {
					m.isSpouseNode = true;         // inferred spouse (first plausible)
					m.inferredSpouse = true;
				} else if (m.birthYear !== null && (m.birthYear - head.birthYear) >= cfg.childMinGapFromHead) {
					m.inferredChildOf = head.id;
				}
			}
		}

		return p;
	}
}

/* ------------------------------------------------------------------ */
/* Phase 1 — Blocker                                                   */
/* ------------------------------------------------------------------ */

class Blocker {
	constructor(pre, config) { this.pre = pre; this.config = config; }

	genderCompatible(a, b) {
		return !a.gender || !b.gender || a.gender === b.gender;
	}

	/** Union of three passes. Returns Map key "id70|id80" -> {m70, m80, passes:Set}.
	 *  Gender filtering here IS the gender knockout applied early; skips are
	 *  recorded in stats.knockouts.gender so the gate remains observable. */
	block(stats) {
		const cfg = this.config, pre = this.pre;
		const log = cfg.logger || (() => { });
		const pairs = new Map();
		const koGender = () => { stats.knockouts.gender = (stats.knockouts.gender || 0) + 1; };
		const add = (m70, m80, pass) => {
			const key = `${m70.id}|${m80.id}`;
			let e = pairs.get(key);
			if (!e) { e = { m70, m80, passes: new Set() }; pairs.set(key, e); }
			e.passes.add(pass);
		};

		log('  Building phonetic index for 1880...');
		// Pass 1: phonetic surname (nysiis OR soundex) + gender + birth ±12
		const idx80 = { nysiis: new Map(), soundex: new Map(), given: new Map() };
		for (const r of pre.m1880) {
			if (r.nysiis) {
				if (!idx80.nysiis.has(r.nysiis)) idx80.nysiis.set(r.nysiis, []);
				idx80.nysiis.get(r.nysiis).push(r);
			}
			if (r.soundex) {
				if (!idx80.soundex.has(r.soundex)) idx80.soundex.set(r.soundex, []);
				idx80.soundex.get(r.soundex).push(r);
			}
			if (r.canonFirst) {
				if (!idx80.given.has(r.canonFirst)) idx80.given.set(r.canonFirst, []);
				idx80.given.get(r.canonFirst).push(r);
			}
		}

		log('  Running Blocker Passes 1 & 2...');
		let processed = 0;
		for (const a of pre.m1870) {
			if (++processed % 10000 === 0) log(`    Processed ${processed} / ${pre.m1870.length} 1870 mentions...`);
			const seen = new Set();
			for (const bucket of [idx80.nysiis.get(a.nysiis), idx80.soundex.get(a.soundex)]) {
				if (!bucket) continue;
				for (const b of bucket) {
					if (seen.has(b.id)) continue;
					seen.add(b.id);
					if (!this.genderCompatible(a, b)) { koGender(); continue; }
					if (a.birthYear !== null && b.birthYear !== null &&
						Math.abs(a.birthYear - b.birthYear) > cfg.blockSurnameYearWindow) continue;
					add(a, b, 1);
				}
			}
			// Pass 2: given name (canonical / nickname) + gender + birth ±5, surname ignored
			// OPTIMIZATION: Skip common given names (freq >= commonCount) if they don't match on surname/phonetic/bridge.
			const gb = idx80.given.get(a.canonFirst);
			if (gb) {
				const givenFreq = pre.givenFreq1870.get(a.canonFirst) || 0;
				const isCommonGiven = givenFreq >= cfg.commonCount;
				for (const b of gb) {
					if (!this.genderCompatible(a, b)) { koGender(); continue; }
					if (a.birthYear !== null && b.birthYear !== null &&
						Math.abs(a.birthYear - b.birthYear) > cfg.blockGivenYearWindow) continue;

					if (isCommonGiven) {
						// Only add if there is some surname agreement (exact, phonetic, or bridge)
						const surMatch = a.last && b.last && (
							a.last === b.last ||
							(a.nysiis && a.nysiis === b.nysiis) ||
							(a.soundex && a.soundex === b.soundex) ||
							pre.bridges.has(a.last < b.last ? `${a.last}|${b.last}` : `${b.last}|${a.last}`)
						);
						if (!surMatch) continue;
					}
					add(a, b, 2);
				}
			}
		}

		log(`  Running Blocker Pass 3 over ${pairs.size} current pairs...`);
		const existing = [...pairs.values()];
		let p3Count = 0;
		for (const e of existing) {
			if (++p3Count % 20000 === 0) log(`    Processed ${p3Count} / ${existing.length} existing pairs...`);
			const f70 = e.m70.familyId ? this.pre.families1870.get(e.m70.familyId) : null;
			const f80 = e.m80.familyId ? this.pre.families1880.get(e.m80.familyId) : null;
			if (!f70 || !f80) continue;
			for (const a of f70) {
				for (const b of f80) {
					if (a.id === e.m70.id && b.id === e.m80.id) continue;
					if (!this.genderCompatible(a, b)) { koGender(); continue; }
					if (a.birthYear !== null && b.birthYear !== null &&
						Math.abs(a.birthYear - b.birthYear) > cfg.maxBirthGap) continue;
					add(a, b, 3);
				}
			}
		}
		return pairs;
	}
}

/* ------------------------------------------------------------------ */
/* Phase 2 — PairScorer                                                */
/* ------------------------------------------------------------------ */

class PairScorer {
	constructor(pre, config, hypotheses) {
		this.pre = pre; this.config = config; this.hypotheses = hypotheses;
		this.w = config.weights;
	}

	rarityMult(count) {
		const cfg = this.config;
		if (count <= cfg.rareCount) return this.w.rarityRare;
		if (count >= cfg.commonCount) return this.w.rarityCommon;
		return this.w.rarityTypical;
	}

	surnameMatch(a, b) {
		if (!a.last || !b.last) return { matched: false, type: 'absent' };
		if (a.last === b.last) return { matched: true, type: 'exact' };
		if ((a.nysiis && a.nysiis === b.nysiis) || (a.soundex && a.soundex === b.soundex)) {
			return { matched: true, type: 'phonetic' };
		}
		const k = a.last < b.last ? `${a.last}|${b.last}` : `${b.last}|${a.last}`;
		if (this.pre.bridges.has(k)) return { matched: true, type: 'bridge' };
		return { matched: false, type: 'none' };
	}

	/** Knockout gates — checked before any scoring. Returns reason or null. */
	knockout(a, b) {
		const cfg = this.config;
		if (a.gender && b.gender && a.gender !== b.gender) return 'gender';
		if (a.birthYear !== null && b.birthYear !== null) {
			if (Math.abs(a.birthYear - b.birthYear) > cfg.maxBirthGap) return 'birthGap';
			if (a.birthYear - b.birthYear > cfg.maxAgeRegression) return 'ageRegression';
		}
		const key = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
		if (this.pre.notSame.has(key)) return 'isNotSameAs';
		// death before 1880 (1870 person matched to a VRD/FG record)
		const mk = `${a.nysiis}|${a.canonFirst}`;
		const deaths = this.pre.mortality.get(mk);
		if (deaths) {
			for (const d of deaths) {
				if (d.deathYear >= 1880) continue;
				if (d.birthYear !== null && a.birthYear !== null &&
					Math.abs(d.birthYear - a.birthYear) > cfg.deathBirthWindow) continue;
				return 'deathBefore1880';
			}
		}
		return null;
	}

	/** Lever A — name cascade. Returns feature object; value may be pending. */
	leverA(a, b) {
		const w = this.w, cfg = this.config, pre = this.pre;
		const sur = this.surnameMatch(a, b);
		const multSur = a.last ? this.rarityMult(pre.surnameFreq1870.get(a.last) || 0) : w.rarityTypical;
		const multGiven = a.canonFirst ? this.rarityMult(pre.givenFreq1870.get(a.canonFirst) || 0) : w.rarityTypical;
		const exactFirst = a.normFirst && b.normFirst && a.normFirst === b.normFirst;
		const nickFirst = !exactFirst && a.canonFirst && b.canonFirst &&
			(a.canonFirst === b.canonFirst || jaroWinkler(a.normFirst, b.normFirst) >= cfg.jwThreshold);
		const initFirst = !exactFirst && !nickFirst && a.initial && b.initial && a.initial === b.initial;

		if (sur.matched) {
			// one surname signal (string/phonetic/bridge — never double-counted)
			const m = (multGiven + multSur) / 2;
			if (exactFirst) return { rung: 'exactFirstSurname', surname: sur.type, value: w.A_exactFirstSurname * m, rarity: m, pending: false };
			if (nickFirst) return { rung: 'nicknameSurname', surname: sur.type, value: w.A_nicknameSurname * m, rarity: m, pending: false };
			if (initFirst) return { rung: 'initialSurname', surname: sur.type, value: w.A_initialSurname * multSur, rarity: multSur, pending: false };
			return { rung: 'surnameOnly', surname: sur.type, value: 0, rarity: multSur, pending: false };
		}

		// no surname match
		const givenAgrees = exactFirst || nickFirst;
		const bothMale = a.gender === 'M' && b.gender === 'M';
		const hardMismatch = a.last && b.last && sur.type === 'none';
		if (bothMale && hardMismatch && !givenAgrees) {
			return { rung: 'maleSurnameMismatch', surname: 'mismatch', value: w.A_maleSurnameMismatch, rarity: 1, pending: false };
		}
		if (givenAgrees) {
			// given-name-only rung: pending — counts only with corroboration (B ±2+ or C)
			const base = { rung: 'givenOnly', surname: sur.type, value: w.A_givenOnly * multGiven, rarity: multGiven, pending: true };
			if (bothMale && hardMismatch) base.penalty = w.A_maleSurnameMismatch; // male: penalty still applies
			return base;
		}
		if (bothMale && hardMismatch) {
			return { rung: 'maleSurnameMismatch', surname: 'mismatch', value: w.A_maleSurnameMismatch, rarity: 1, pending: false };
		}
		return { rung: 'none', surname: sur.type, value: 0, rarity: 1, pending: false };
	}

	leverB(a, b) {
		const w = this.w;
		if (a.birthYear === null || b.birthYear === null) return { rung: 'absent', value: 0 };
		const gap = Math.abs(a.birthYear - b.birthYear);
		if (gap === 0) return { rung: 'exact', value: w.B_exact };
		if (gap === 1) return { rung: '±1', value: w.B_1 };
		if (gap === 2) return { rung: '±2', value: w.B_2 };
		if (gap === 3) return { rung: '±3', value: w.B_3 };
		if (gap <= 5) return { rung: '±5', value: w.B_5 };
		return { rung: '6-10', value: w.B_6to10 }; // >10 already knocked out
	}

	raceSignal(a, b) {
		const w = this.w;
		if (!a.race || !b.race) return { rung: 'absent', value: 0 };
		const nonWhite = (r) => r === 'B' || r === 'M';
		if (a.race === b.race || (nonWhite(a.race) && nonWhite(b.race))) return { rung: 'agree', value: w.raceAgree };
		if ((nonWhite(a.race) && b.race === 'W') || (a.race === 'W' && nonWhite(b.race))) {
			return { rung: 'conflict', value: w.raceConflict };
		}
		return { rung: 'other', value: 0 };
	}

	occSignal(a, b) {
		const cfg = this.config;
		const adult = (r) => r.birthYear !== null && (r.censusYear - r.birthYear) >= cfg.adultAge;
		if (a.occupation && b.occupation && a.occupation === b.occupation && adult(a) && adult(b)) {
			return { rung: 'match', value: this.w.occupation };
		}
		return { rung: 'none', value: 0 };
	}

	/**
	 * Score a blocked pair. Returns a pair object or null when knocked out /
	 * pruned (below any reachable tier even with maximum family/neighbor bonus).
	 */
	score(entry, stats) {
		const { m70: a, m80: b } = entry;
		const ko = this.knockout(a, b);
		if (ko) {
			stats.knockouts[ko] = (stats.knockouts[ko] || 0) + 1;
			if (ko === 'deathBefore1880') {
				this.hypotheses.push({
					type: 'dualIdentity',
					subjects: [a.id, b.id],
					narrative: `1870 mention ${a.id} has a death record before 1880; same-named 1880 mention ${b.id} is likely a different individual (e.g., a Jr.).`,
					relatedBundle: null,
				});
			}
			return null;
		}
		const A = this.leverA(a, b);
		const B = this.leverB(a, b);
		const R = this.raceSignal(a, b);
		const O = this.occSignal(a, b);
		const pair = {
			m70: a, m80: b, key: `${a.id}|${b.id}`,
			passes: [...entry.passes].sort(),
			features: { leverA: A, leverB: B, race: R, occupation: O, leverC: { value: 0, backing: [] }, leverD: { value: 0, count: 0 } },
			bundleId: null,
			spousalPair: a.isSpouseNode && b.isSpouseNode,
		};
		// prune: even with max C+D and a qualified pending A, can it reach tier2?
		const maxPossible = this.confidence(pair, /*assumeMax*/ true);
		if (maxPossible < this.config.tier2) { stats.pruned++; return null; }
		pair.confidence = this.confidence(pair);
		return pair;
	}

	/** Combine features -> confidence. Enforces the given-name-only gating. */
	confidence(pair, assumeMax = false) {
		const w = this.w, f = pair.features;
		const C = assumeMax ? w.C_cap : f.leverC.value;
		const D = assumeMax ? w.D_cap : f.leverD.value;
		let A = f.leverA.value;
		let firedA = A > 0;
		if (f.leverA.pending) {
			const corroborated = assumeMax || f.leverB.value >= w.B_2 || f.leverC.value > 0;
			if (!corroborated) { A = 0; firedA = false; }
			if (f.leverA.penalty) A += f.leverA.penalty;
		}
		const score = w.intercept + A + f.leverB.value + f.race.value + f.occupation.value + C + D;
		if (!assumeMax) {
			pair.score = score;
			pair.leversFired = [firedA, f.leverB.value > 0, f.leverC.value > 0, f.leverD.value > 0]
				.filter(Boolean).length;
		}
		return Math.min(0.99, sigmoid(score));
	}
}

/* ------------------------------------------------------------------ */
/* Phase 3 — FamilyAligner                                             */
/* ------------------------------------------------------------------ */

class FamilyAligner {
	constructor(pre, config, scorer, hypotheses) {
		this.pre = pre; this.config = config; this.scorer = scorer; this.hypotheses = hypotheses;
		this.bundles = new Map(); // "f70|f80" -> bundle
	}

	/** Greedy bipartite assignment on a small family pair (one-to-one members). */
	align(memberPairs) {
		const sorted = [...memberPairs].sort((x, y) =>
			(y.score - x.score) || (x.key < y.key ? -1 : 1));
		const used70 = new Set(), used80 = new Set(), aligned = [];
		for (const p of sorted) {
			if (used70.has(p.m70.id) || used80.has(p.m80.id)) continue;
			if (p.score <= this.config.weights.intercept) continue; // no positive evidence at all
			used70.add(p.m70.id); used80.add(p.m80.id); aligned.push(p);
		}
		return aligned;
	}

	bundleScore(aligned) {
		const w = this.config.weights;
		let s = 0;
		for (const p of aligned) s += p.spousalPair ? w.C_spouse : w.C_member;
		return Math.min(w.C_cap, s);
	}

	/** Per-pair Lever C from OTHER aligned pairs only (feedback guard). */
	applyLeverC(aligned) {
		const w = this.config.weights;
		for (const p of aligned) {
			let s = 0; const backing = [];
			for (const q of aligned) {
				if (q === p) continue; // a pair never feeds its own bonus
				s += q.spousalPair ? w.C_spouse : w.C_member;
				backing.push({ m1870: q.m70.id, m1880: q.m80.id, spousal: q.spousalPair });
			}
			p.features.leverC = { value: Math.min(w.C_cap, s), backing };
		}
	}

	/** Block surname drift: >= quorum aligned members share the same shift. */
	applyDrift(aligned, bundle) {
		const w = this.config.weights;
		const shifts = new Map();
		for (const p of aligned) {
			if (p.m70.last && p.m80.last && p.m70.last !== p.m80.last) {
				const k = `${p.m70.last}>${p.m80.last}`;
				if (!shifts.has(k)) shifts.set(k, []);
				shifts.get(k).push(p);
			}
		}
		for (const [k, ps] of shifts) {
			if (ps.length < this.config.driftQuorum) continue;
			bundle.surnameDrift = { from: k.split('>')[0], to: k.split('>')[1] };
			for (const p of ps) {
				const A = p.features.leverA;
				if (A.rung === 'givenOnly' || A.rung === 'maleSurnameMismatch' || A.rung === 'none') {
					// one surname signal for the whole family: rarity multiplier 1.0
					const a = p.m70, b = p.m80;
					const exact = a.normFirst && a.normFirst === b.normFirst;
					const nick = !exact && a.canonFirst && (a.canonFirst === b.canonFirst ||
						jaroWinkler(a.normFirst, b.normFirst) >= this.config.jwThreshold);
					const init = !exact && !nick && a.initial && a.initial === b.initial;
					let rung = 'surnameOnly', value = 0;
					if (exact) { rung = 'exactFirstSurname'; value = w.A_exactFirstSurname; }
					else if (nick) { rung = 'nicknameSurname'; value = w.A_nicknameSurname; }
					else if (init) { rung = 'initialSurname'; value = w.A_initialSurname; }
					p.features.leverA = { rung, surname: 'drift', value, rarity: 1.0, pending: false };
				}
			}
		}
	}

	emitStructuralHypotheses(aligned, f70, f80) {
		const cfg = this.config;
		for (const p of aligned) {
			// fission: young 1880 head matched to a non-head 1870 member
			if (p.m80.head && !p.m70.head && p.m80.birthYear !== null) {
				const age = 1880 - p.m80.birthYear;
				if (age >= 20 && age <= 35) {
					this.hypotheses.push({
						type: 'fission',
						subjects: [p.m70.id, p.m80.id],
						narrative: `1870 family ${f70} appears to have fissioned: non-head member ${p.m70.id} matches ${p.m80.id}, head of new 1880 family ${f80}.`,
						relatedBundle: `${f70}|${f80}`,
					});
				}
			}
			// fusion: 1870 head appearing as a non-head in an 1880 family
			if (p.m70.head && !p.m80.head) {
				this.hypotheses.push({
					type: 'fusion',
					subjects: [p.m70.id, p.m80.id],
					narrative: `1870 head ${p.m70.id} appears absorbed as a non-head member ${p.m80.id} of 1880 family ${f80}.`,
					relatedBundle: `${f70}|${f80}`,
				});
			}
		}
	}

	/** Generational plausibility on explicit (non-inferred) 1880 edges. */
	generationalFlags() {
		const cfg = this.config, pre = this.pre;
		const seen = new Set();
		for (const e of pre.childToParent1880) {
			const c = pre.byId.get(e.child), par = pre.byId.get(e.parent);
			if (!c || !par || c.birthYear === null || par.birthYear === null) continue;
			const ageAtBirth = c.birthYear - par.birthYear;
			if (ageAtBirth < cfg.genMinParentAge || ageAtBirth > cfg.genMaxParentAge) {
				const key = `${e.child}|${e.parent}`;
				if (seen.has(key)) continue;
				seen.add(key);
				this.hypotheses.push({
					type: 'generationalFlag',
					subjects: [e.child, e.parent],
					narrative: `1880 relation implies parent ${e.parent} was ${ageAtBirth} at the birth of ${e.child}; relation is implausible as stated (grandchild or enumerator error likely).`,
					relatedBundle: null,
				});
			}
		}
	}

	/** Lever D from a provisional one-to-one over current confidences. */
	applyLeverD(pairs) {
		const cfg = this.config, w = this.config.weights, pre = this.pre;
		// provisional winners: greedy 1:1 by confidence
		const sorted = [...pairs].sort((x, y) => (y.confidence - x.confidence) || (x.key < y.key ? -1 : 1));
		const u70 = new Set(), u80 = new Set(), winners = [];
		for (const p of sorted) {
			if (p.confidence < cfg.tier2) break;
			if (u70.has(p.m70.id) || u80.has(p.m80.id)) continue;
			u70.add(p.m70.id); u80.add(p.m80.id); winners.push(p);
		}
		// index winners by family order position
		const wins = winners
			.filter((p) => p.m70.familyId && p.m80.familyId)
			.map((p) => ({
				p,
				o70: pre.famOrder1870.get(p.m70.familyId),
				o80: pre.famOrder1880.get(p.m80.familyId),
			}))
			.filter((e) => e.o70 !== undefined && e.o80 !== undefined);
		// Group winners by o70 for fast window lookups (reduces O(N*M) to O(N))
		const winsBy70 = new Map();
		for (const e of wins) {
			if (!winsBy70.has(e.o70)) winsBy70.set(e.o70, []);
			winsBy70.get(e.o70).push(e);
		}

		for (const p of pairs) {
			const o70 = pre.famOrder1870.get(p.m70.familyId);
			const o80 = pre.famOrder1880.get(p.m80.familyId);
			if (o70 === undefined || o80 === undefined) continue;
			let count = 0;

			const minO70 = o70 - cfg.adjacencyWide;
			const maxO70 = o70 + cfg.adjacencyWide;
			for (let w70 = minO70; w70 <= maxO70; w70++) {
				const bucket = winsBy70.get(w70);
				if (!bucket) continue;
				for (const e of bucket) {
					if (e.p.m70.familyId === p.m70.familyId) continue;      // other families only
					if (e.p.m70.id === p.m70.id || e.p.m80.id === p.m80.id) continue; // never self-feed
					if (Math.abs(e.o80 - o80) <= cfg.adjacencyWide) count++;
				}
			}
			p.features.leverD = { value: Math.min(w.D_cap, count * w.D_neighbor), count };
		}
	}

	/** Exactly two propagation rounds. Mutates pairs; returns bundles. */
	run(pairs) {
		// group pairs into candidate family pairs
		const famPairs = new Map();
		for (const p of pairs) {
			if (!p.m70.familyId || !p.m80.familyId) continue;
			const k = `${p.m70.familyId}|${p.m80.familyId}`;
			if (!famPairs.has(k)) famPairs.set(k, []);
			famPairs.get(k).push(p);
		}
		const famKeys = [...famPairs.keys()].sort();

		// ROUND 1 — align from Phase 2 scores; drift; Lever C; hypotheses
		for (const k of famKeys) {
			const members = famPairs.get(k);
			const aligned = this.align(members);
			if (!aligned.length) continue;
			const [f70, f80] = k.split('|');
			const bundle = {
				bundle_id: k, family_1870: f70, family_1880: f80,
				memberAlignment: [], surnameDrift: null, alignmentScore: 0,
			};
			this.applyDrift(aligned, bundle);
			this.applyLeverC(aligned);
			bundle.alignmentScore = this.bundleScore(aligned);
			bundle.memberAlignment = aligned.map((p) => ({
				m1870: p.m70.id, m1880: p.m80.id,
				backing: p.features.leverC.backing.map((x) => `${x.m1870}~${x.m1880}`),
			}));
			for (const p of aligned) p.bundleId = k;
			this.bundles.set(k, bundle);
			this.emitStructuralHypotheses(aligned, f70, f80);
		}
		// refresh confidences, then Lever D from provisional winners
		for (const p of pairs) p.confidence = this.scorer.confidence(p);
		this.applyLeverD(pairs);
		for (const p of pairs) p.confidence = this.scorer.confidence(p);

		// ROUND 2 — re-solve alignments once with updated scores; final C; stop.
		for (const k of famKeys) {
			const members = famPairs.get(k);
			const aligned = this.align(members);
			if (!aligned.length) { this.bundles.delete(k); continue; }
			const bundle = this.bundles.get(k) || {
				bundle_id: k, family_1870: k.split('|')[0], family_1880: k.split('|')[1],
				memberAlignment: [], surnameDrift: null, alignmentScore: 0,
			};
			this.applyDrift(aligned, bundle);
			this.applyLeverC(aligned);
			bundle.alignmentScore = this.bundleScore(aligned);
			bundle.memberAlignment = aligned.map((p) => ({
				m1870: p.m70.id, m1880: p.m80.id,
				backing: p.features.leverC.backing.map((x) => `${x.m1870}~${x.m1880}`),
			}));
			for (const p of aligned) p.bundleId = k;
			this.bundles.set(k, bundle);
		}
		for (const p of pairs) p.confidence = this.scorer.confidence(p);
		this.generationalFlags();
		return this.bundles;
	}
}

/* ------------------------------------------------------------------ */
/* Phase 4 — Assigner                                                  */
/* ------------------------------------------------------------------ */

class Assigner {
	constructor(config, bundles, hypotheses) {
		this.config = config; this.bundles = bundles; this.hypotheses = hypotheses;
	}

	/** Global one-to-one: household-precedence first, then confidence; ties by id. */
	assign(pairs) {
		const cfg = this.config;
		const priority = (p) => {
			const b = p.bundleId ? this.bundles.get(p.bundleId) : null;
			return b && b.alignmentScore >= cfg.alignmentPrecedence ? 1 : 0;
		};
		const sorted = [...pairs].sort((x, y) =>
			(priority(y) - priority(x)) || (y.confidence - x.confidence) || (x.key < y.key ? -1 : 1));
		const u70 = new Map(), u80 = new Map(), winners = [];
		const displaced = [];
		for (const p of sorted) {
			if (p.confidence < cfg.tier2) continue;
			if (u70.has(p.m70.id) || u80.has(p.m80.id)) { displaced.push(p); continue; }
			u70.set(p.m70.id, p); u80.set(p.m80.id, p); winners.push(p);
		}
		for (const p of displaced) {
			const rival = u70.get(p.m70.id) || u80.get(p.m80.id);
			if (rival && Math.abs(rival.confidence - p.confidence) <= cfg.collisionBand) {
				this.hypotheses.push({
					type: 'collision',
					subjects: [p.m70.id, p.m80.id, rival.m70.id, rival.m80.id],
					narrative: `Candidate ${p.m70.id}~${p.m80.id} (conf ${p.confidence.toFixed(3)}) was displaced by ${rival.m70.id}~${rival.m80.id} (conf ${rival.confidence.toFixed(3)}) within the collision band.`,
					relatedBundle: p.bundleId,
				});
			}
		}
		return { winners, displacedCount: displaced.length };
	}
}

/* ------------------------------------------------------------------ */
/* Phase 5 — OutputBuilder                                             */
/* ------------------------------------------------------------------ */

class OutputBuilder {
	constructor(config) { this.config = config; }

	tierOf(p) {
		const cfg = this.config;
		if (p.confidence >= cfg.tier1 && p.leversFired >= 2) return 1;
		if (p.confidence >= cfg.tier2) return 2;
		return 3;
	}

	build(winners, bundles, hypotheses, pre, stats) {
		const cfg = this.config;
		const sameAsAssertions = [];
		for (const p of winners) {
			const tier = this.tierOf(p);
			if (tier > 2) continue;
			sameAsAssertions.push({
				assertion_id: cfg.uuidFn(),
				subject_id: p.m70.id,
				predicate: 'isSameAs',
				object_id: p.m80.id,
				start_year: 1870,
				end_year: 1880,
				who: cfg.engineName,
				confidence: Math.round(p.confidence * 1000) / 1000,
				created: cfg.nowFn(),
				tier,
				review: tier === 2,
				features: p.features,
				evidence_bundle_id: p.bundleId,
			});
			stats.tiers[tier] = (stats.tiers[tier] || 0) + 1;
		}
		sameAsAssertions.sort((a, b) => (a.subject_id < b.subject_id ? -1 : 1));
		const matched70 = new Set(sameAsAssertions.map((a) => a.subject_id));
		const unmatched1870 = pre.m1870.map((m) => m.id).filter((id) => !matched70.has(id));
		hypotheses.forEach((h, i) => { h.hypothesis_id = `H-${String(i + 1).padStart(5, '0')}`; });
		return {
			sameAsAssertions,
			evidenceBundles: [...bundles.values()].sort((a, b) => (a.bundle_id < b.bundle_id ? -1 : 1)),
			hypotheses,
			unmatched1870,
			stats,
		};
	}
}

/* ------------------------------------------------------------------ */
/* Facade                                                              */
/* ------------------------------------------------------------------ */

class CensusLinker {
	/**
	 * @param {Array<Object>} mentions   rows of the MENTIONS table
	 * @param {Array<Object>} assertions rows of the ASSERTIONS table
	 * @param {Object} [config]          overrides of defaultConfig()
	 */
	constructor(mentions, assertions, config = {}) {
		this.config = Object.assign(defaultConfig(), config);
		if (config.weights) this.config.weights = Object.assign(defaultConfig().weights, config.weights);
		this.mentions = mentions;
		this.assertions = assertions;
	}

	run() {
		const cfg = this.config;
		const log = cfg.logger || (() => { });
		log('Starting Preprocessor...');
		const stats = { knockouts: {}, pruned: 0, tiers: {}, phase: {} };
		const hypotheses = [];

		const pre = new Preprocessor(this.mentions, this.assertions, cfg).build();
		stats.phase.mentions1870 = pre.m1870.length;
		stats.phase.mentions1880 = pre.m1880.length;
		stats.phase.oversizedHouseholds1870 = pre.oversizedHouseholds.size;
		log(`Preprocessor complete. 1870 mentions: ${pre.m1870.length}, 1880 mentions: ${pre.m1880.length}`);

		log('Starting Blocker...');
		const blocked = new Blocker(pre, cfg).block(stats);
		stats.phase.blockedPairs = blocked.size;
		log(`Blocker complete. Candidate pairs: ${blocked.size}`);

		log('Starting PairScorer...');
		const scorer = new PairScorer(pre, cfg, hypotheses);
		const pairs = [];
		let count = 0;
		for (const entry of blocked.values()) {
			if (++count % 50000 === 0) log(`  Scored ${count} / ${blocked.size} pairs...`);
			const p = scorer.score(entry, stats);
			if (p) pairs.push(p);
		}
		stats.phase.scoredPairs = pairs.length;
		log(`PairScorer complete. Scored pairs surviving pruning: ${pairs.length}`);

		log('Starting FamilyAligner...');
		const aligner = new FamilyAligner(pre, cfg, scorer, hypotheses);
		const bundles = aligner.run(pairs);
		stats.phase.familyBundles = bundles.size;
		log(`FamilyAligner complete. Family bundles: ${bundles.size}`);

		log('Starting Assigner...');
		const { winners, displacedCount } = new Assigner(cfg, bundles, hypotheses).assign(pairs);
		stats.phase.assigned = winners.length;
		stats.phase.displaced = displacedCount;
		log(`Assigner complete. Assigned winners: ${winners.length}`);

		log('Building output...');
		return new OutputBuilder(cfg).build(winners, bundles, hypotheses, pre, stats);
	}

	/* ---------------------------------------------------------------- */
	/* Self test — acceptance suite (tier bands + boolean flags)         */
	/* ---------------------------------------------------------------- */

	static selfTest() {
		const results = [];
		const check = (name, cond, detail = '') =>
			results.push({ name, passed: !!cond, detail });

		const M = (id, fam, opts) => Object.assign({
			mention_id: id, source: id.includes('-1870-') ? 'TST-CN-1870' : 'TST-CN-1880',
			family_id: fam, head: false, race: 'B', norm_race: 'B',
		}, opts);
		const testCfg = () => {
			let n = 0;
			return { uuidFn: () => `uuid-${++n}`, nowFn: () => '2026-01-01T00:00:00Z' };
		};

		/* Fixture A — Goings world (tests 1, 2, 3) */
		const A_mentions = [
			// 1870 family F1 (seq 10-12): H. Gains + Agnes + James  (surname count 3 -> rare)
			M('TST-CN-1870-10', 'F1', { first_name: 'H.', norm_first_name: 'H', last_name: 'Gains', nysiis_last_name: 'GAN', soundex_last_name: 'G520', birth_year: 1795, gender: 'M', head: true }),
			M('TST-CN-1870-11', 'F1', { first_name: 'Agnes', norm_first_name: 'AGNES', last_name: 'Gains', nysiis_last_name: 'GAN', soundex_last_name: 'G520', birth_year: 1810, gender: 'F' }),
			M('TST-CN-1870-12', 'F1', { first_name: 'James', norm_first_name: 'JAMES', last_name: 'Gains', nysiis_last_name: 'GAN', soundex_last_name: 'G520', birth_year: 1850, gender: 'M' }),
			// neighbors (own families, adjacent sequence)
			M('TST-CN-1870-15', 'F2', { first_name: 'Ben', norm_first_name: 'BEN', last_name: 'Brown', nysiis_last_name: 'BRAN', soundex_last_name: 'B650', birth_year: 1820, gender: 'M', head: true }),
			M('TST-CN-1870-16', 'F3', { first_name: 'Sam', norm_first_name: 'SAM', last_name: 'Carter', nysiis_last_name: 'CARTAR', soundex_last_name: 'C636', birth_year: 1825, gender: 'M', head: true }),
			// 1880 family G1 (seq 5-8): Henderson + Agnes + Francis + John
			M('TST-CN-1880-5', 'G1', { first_name: 'Henderson', norm_first_name: 'HENDERSON', last_name: 'Goings', nysiis_last_name: 'GAN', soundex_last_name: 'G520', birth_year: 1795, gender: 'M', head: true }),
			M('TST-CN-1880-6', 'G1', { first_name: 'Agnes', norm_first_name: 'AGNES', last_name: 'Goings', nysiis_last_name: 'GAN', soundex_last_name: 'G520', birth_year: 1815, gender: 'F' }),
			M('TST-CN-1880-7', 'G1', { first_name: 'Francis', norm_first_name: 'FRANCIS', last_name: 'Goings', nysiis_last_name: 'GAN', soundex_last_name: 'G520', birth_year: 1847, gender: 'F' }),
			M('TST-CN-1880-8', 'G1', { first_name: 'John', norm_first_name: 'JOHN', last_name: 'Goings', nysiis_last_name: 'GAN', soundex_last_name: 'G520', birth_year: 1870, gender: 'M' }),
			// 1880 neighbors
			M('TST-CN-1880-9', 'G2', { first_name: 'Ben', norm_first_name: 'BEN', last_name: 'Brown', nysiis_last_name: 'BRAN', soundex_last_name: 'B650', birth_year: 1820, gender: 'M', head: true }),
			M('TST-CN-1880-10', 'G3', { first_name: 'Sam', norm_first_name: 'SAM', last_name: 'Carter', nysiis_last_name: 'CARTAR', soundex_last_name: 'C636', birth_year: 1825, gender: 'M', head: true }),
			// 1880 family G4 (seq 200+): James's new family (fission)
			M('TST-CN-1880-200', 'G4', { first_name: 'James', norm_first_name: 'JAMES', last_name: 'Goings', nysiis_last_name: 'GAN', soundex_last_name: 'G520', birth_year: 1850, gender: 'M', head: true }),
			M('TST-CN-1880-201', 'G4', { first_name: 'Fannie', norm_first_name: 'FANNIE', last_name: 'Goings', nysiis_last_name: 'GAN', soundex_last_name: 'G520', birth_year: 1859, gender: 'F' }),
			M('TST-CN-1880-202', 'G4', { first_name: 'Lina', norm_first_name: 'LINA', last_name: 'Goings', nysiis_last_name: 'GAN', soundex_last_name: 'G520', birth_year: 1877, gender: 'F' }),
		];
		const A_assertions = [
			{ assertion_id: 'a1', subject_id: 'TST-CN-1880-6', predicate: 'isSpouseOf', object_id: 'TST-CN-1880-5', who: '1880Census', confidence: 0.9 },
			{ assertion_id: 'a2', subject_id: 'TST-CN-1880-8', predicate: 'isChildOf', object_id: 'TST-CN-1880-5', who: '1880Census', confidence: 0.9 },
			{ assertion_id: 'a3', subject_id: 'TST-CN-1880-7', predicate: 'isChildOf', object_id: 'TST-CN-1880-5', who: '1880Census', confidence: 0.9 },
			{ assertion_id: 'a4', subject_id: 'TST-CN-1880-201', predicate: 'isSpouseOf', object_id: 'TST-CN-1880-200', who: '1880Census', confidence: 0.9 },
		];
		const rA = new CensusLinker(A_mentions, A_assertions, testCfg()).run();

		// Test 1 — name drift + spouse: H. Gains -> Henderson Goings at Tier 1
		const t1 = rA.sameAsAssertions.find((a) => a.subject_id === 'TST-CN-1870-10' && a.object_id === 'TST-CN-1880-5');
		check('T1 link exists', !!t1);
		check('T1 Tier 1 / conf >= 0.98', t1 && t1.tier === 1 && t1.confidence >= 0.98, t1 ? `conf=${t1.confidence}` : 'missing');
		check('T1 Lever A initial-or-better + surname', t1 && ['initialSurname', 'nicknameSurname', 'exactFirstSurname'].includes(t1.features.leverA.rung), t1 ? t1.features.leverA.rung : '');
		check('T1 Lever C spouse backing', t1 && t1.features.leverC.backing.some((b) => b.spousal), t1 ? JSON.stringify(t1.features.leverC.backing) : '');

		// Test 2 — fission: James matches; fission hypothesis; no isChildOf written
		const t2 = rA.sameAsAssertions.find((a) => a.subject_id === 'TST-CN-1870-12' && a.object_id === 'TST-CN-1880-200');
		check('T2 James matched', !!t2, t2 ? `conf=${t2.confidence}` : 'missing');
		check('T2 fission hypothesis', rA.hypotheses.some((h) => h.type === 'fission' && h.subjects.includes('TST-CN-1870-12')));
		check('T2 no kin assertions emitted', rA.sameAsAssertions.every((a) => a.predicate === 'isSameAs'));

		// Test 3 — generational flag (John b.1870, head b.1795 -> parent age 75)
		check('T3 generational flag', rA.hypotheses.some((h) => h.type === 'generationalFlag' && h.subjects.includes('TST-CN-1880-8')));

		/* Fixture B — common-name restraint + one-to-one (tests 4, 7) */
		const B_mentions = [
			M('TST-CN-1870-1', 'F1', { first_name: 'Henry', norm_first_name: 'HENRY', last_name: 'Going', nysiis_last_name: 'GAN', soundex_last_name: 'G520', birth_year: 1849, gender: 'M', head: true }),
			// filler Henrys so 'henry' is typical, and filler Goings so surname typical
			M('TST-CN-1870-2', 'F2', { first_name: 'Henry', norm_first_name: 'HENRY', last_name: 'Smith', nysiis_last_name: 'SNAT', soundex_last_name: 'S530', birth_year: 1830, gender: 'M', head: true }),
			M('TST-CN-1870-3', 'F3', { first_name: 'Henry', norm_first_name: 'HENRY', last_name: 'Jones', nysiis_last_name: 'JAN', soundex_last_name: 'J520', birth_year: 1835, gender: 'M', head: true }),
			M('TST-CN-1870-4', 'F4', { first_name: 'Henry', norm_first_name: 'HENRY', last_name: 'Davis', nysiis_last_name: 'DAV', soundex_last_name: 'D120', birth_year: 1840, gender: 'M', head: true }),
			M('TST-CN-1870-5', 'F5', { first_name: 'Anna', norm_first_name: 'ANNA', last_name: 'Going', nysiis_last_name: 'GAN', soundex_last_name: 'G520', birth_year: 1830, gender: 'F', head: true }),
			M('TST-CN-1870-6', 'F6', { first_name: 'Mark', norm_first_name: 'MARK', last_name: 'Going', nysiis_last_name: 'GAN', soundex_last_name: 'G520', birth_year: 1810, gender: 'M', head: true }),
			M('TST-CN-1870-7', 'F7', { first_name: 'Rose', norm_first_name: 'ROSE', last_name: 'Going', nysiis_last_name: 'GAN', soundex_last_name: 'G520', birth_year: 1845, gender: 'F', head: true }),
			// three interchangeable 1880 Henry Goings, unrelated families
			M('TST-CN-1880-1', 'G1', { first_name: 'Henry', norm_first_name: 'HENRY', last_name: 'Goings', nysiis_last_name: 'GAN', soundex_last_name: 'G520', birth_year: 1849, gender: 'M', head: true }),
			M('TST-CN-1880-2', 'G2', { first_name: 'Henry', norm_first_name: 'HENRY', last_name: 'Goings', nysiis_last_name: 'GAN', soundex_last_name: 'G520', birth_year: 1849, gender: 'M', head: true }),
			M('TST-CN-1880-3', 'G3', { first_name: 'Henry', norm_first_name: 'HENRY', last_name: 'Goings', nysiis_last_name: 'GAN', soundex_last_name: 'G520', birth_year: 1849, gender: 'M', head: true }),
		];
		const rB = new CensusLinker(B_mentions, [], testCfg()).run();
		const bLinks = rB.sameAsAssertions.filter((a) => a.subject_id === 'TST-CN-1870-1');
		check('T4 no Tier 1 among common-name candidates', rB.sameAsAssertions.every((a) => a.tier > 1),
			JSON.stringify(rB.sameAsAssertions.map((a) => [a.object_id, a.tier, a.confidence])));
		check('T7 exactly one isSameAs for the Henry subject', bLinks.length === 1, `n=${bLinks.length}`);
		check('T7 collision hypothesis emitted', rB.hypotheses.some((h) => h.type === 'collision'));

		/* Fixture C — knockouts (test 5) */
		const C_mentions = [
			M('TST-CN-1870-1', 'F1', { first_name: 'Pat', norm_first_name: 'PAT', last_name: 'Miller', nysiis_last_name: 'MALAR', soundex_last_name: 'M460', birth_year: 1850, gender: 'M', head: true }),
			M('TST-CN-1880-1', 'G1', { first_name: 'Pat', norm_first_name: 'PAT', last_name: 'Miller', nysiis_last_name: 'MALAR', soundex_last_name: 'M460', birth_year: 1850, gender: 'F', head: true }),
			M('TST-CN-1870-2', 'F2', { first_name: 'Amos', norm_first_name: 'AMOS', last_name: 'Reed', nysiis_last_name: 'RAD', soundex_last_name: 'R300', birth_year: 1840, gender: 'M', head: true }),
			M('TST-CN-1880-2', 'G2', { first_name: 'Amos', norm_first_name: 'AMOS', last_name: 'Reed', nysiis_last_name: 'RAD', soundex_last_name: 'R300', birth_year: 1852, gender: 'M', head: true }),
			M('TST-CN-1870-3', 'F3', { first_name: 'Silas', norm_first_name: 'SILAS', last_name: 'Webb', nysiis_last_name: 'WAB', soundex_last_name: 'W100', birth_year: 1830, gender: 'M', head: true }),
			M('TST-CN-1880-3', 'G3', { first_name: 'Silas', norm_first_name: 'SILAS', last_name: 'Webb', nysiis_last_name: 'WAB', soundex_last_name: 'W100', birth_year: 1832, gender: 'M', head: true }),
			// death record: Silas Webb died 1877
			{ mention_id: 'TST-VRD-1', source: 'TST-VRD', first_name: 'Silas', norm_first_name: 'SILAS', last_name: 'Webb', nysiis_last_name: 'WAB', soundex_last_name: 'W100', birth_year: 1830, death_year: 1877 },
		];
		const rC = new CensusLinker(C_mentions, [], testCfg()).run();
		check('T5 all knockout pairs excluded', rC.sameAsAssertions.length === 0, JSON.stringify(rC.sameAsAssertions.map((a) => a.subject_id)));
		check('T5 gender + birthGap + death knockouts fired',
			(rC.stats.knockouts.gender || 0) > 0 && (rC.stats.knockouts.birthGap || 0) > 0 && (rC.stats.knockouts.deathBefore1880 || 0) > 0,
			JSON.stringify(rC.stats.knockouts));
		check('T5 dualIdentity hypothesis', rC.hypotheses.some((h) => h.type === 'dualIdentity' && h.subjects.includes('TST-CN-1870-3')));

		/* Fixture D — female surname change (test 6) */
		const D_mentions = [
			// 1870 family F1: Dilcey Jones (rare given) + mother Milly Jones
			M('TST-CN-1870-1', 'F1', { first_name: 'Milly', norm_first_name: 'MILLY', last_name: 'Jones', nysiis_last_name: 'JAN', soundex_last_name: 'J520', birth_year: 1830, gender: 'F', head: true }),
			M('TST-CN-1870-2', 'F1', { first_name: 'Dilcey', norm_first_name: 'DILCEY', last_name: 'Jones', nysiis_last_name: 'JAN', soundex_last_name: 'J520', birth_year: 1852, gender: 'F' }),
			// 1870 Kizzie (control, no corroborator, B beyond ±3)
			M('TST-CN-1870-3', 'F2', { first_name: 'Kizzie', norm_first_name: 'KIZZIE', last_name: 'Jones', nysiis_last_name: 'JAN', soundex_last_name: 'J520', birth_year: 1850, gender: 'F', head: true }),
			// 1880 family G1: Sam Carter head, Dilcey Carter wife, Milly Jones mother-in-law
			M('TST-CN-1880-1', 'G1', { first_name: 'Sam', norm_first_name: 'SAM', last_name: 'Carter', nysiis_last_name: 'CARTAR', soundex_last_name: 'C636', birth_year: 1848, gender: 'M', head: true }),
			M('TST-CN-1880-2', 'G1', { first_name: 'Dilcey', norm_first_name: 'DILCEY', last_name: 'Carter', nysiis_last_name: 'CARTAR', soundex_last_name: 'C636', birth_year: 1852, gender: 'F' }),
			M('TST-CN-1880-3', 'G1', { first_name: 'Milly', norm_first_name: 'MILLY', last_name: 'Jones', nysiis_last_name: 'JAN', soundex_last_name: 'J520', birth_year: 1830, gender: 'F' }),
			// 1880 Kizzie Hall, wife elsewhere, birth gap 4
			M('TST-CN-1880-4', 'G2', { first_name: 'Kizzie', norm_first_name: 'KIZZIE', last_name: 'Hall', nysiis_last_name: 'HAL', soundex_last_name: 'H400', birth_year: 1854, gender: 'F' }),
		];
		const D_assertions = [
			{ assertion_id: 'd1', subject_id: 'TST-CN-1880-2', predicate: 'isSpouseOf', object_id: 'TST-CN-1880-1', who: '1880Census', confidence: 0.9 },
		];
		const rD = new CensusLinker(D_mentions, D_assertions, testCfg()).run();
		const t6 = rD.sameAsAssertions.find((a) => a.subject_id === 'TST-CN-1870-2' && a.object_id === 'TST-CN-1880-2');
		check('T6 corroborated female surname change reaches >= Tier 2', !!t6 && t6.tier <= 2, t6 ? `tier=${t6.tier} conf=${t6.confidence}` : 'missing');
		check('T6 uncorroborated control stays Tier 3', !rD.sameAsAssertions.some((a) => a.subject_id === 'TST-CN-1870-3'));

		/* Test 8 — determinism (fixture A twice, injectables fixed) */
		const rA2 = new CensusLinker(A_mentions, A_assertions, testCfg()).run();
		check('T8 deterministic output', JSON.stringify(rA) === JSON.stringify(rA2));

		const passed = results.every((r) => r.passed);
		return { passed, results };
	}
}

/* ------------------------------------------------------------------ */
/* Usage — the engine is I/O-agnostic. It takes parsed arrays and       */
/* returns results; loading CSVs is a thin adapter chosen per host.     */
/* ------------------------------------------------------------------ */
//
// The core never reads files. Provide `mentions` and `assertions` as arrays of
// row objects however the host environment supplies them:
//
//   // Browser — from a file <input> or fetch():
//   const text = await file.text();                 // or (await fetch(url)).text()
//   const mentions = parseCsv(text);                // your CSV parser
//   const linker = new CensusLinker(mentions, assertions);
//   const { sameAsAssertions } = linker.run();
//
//   // Antigravity / any JS host with local reads — same engine, different shell:
//   const mentions = parseCsv(await readLocal('mentions.csv'));
//
// selfTest() needs no I/O at all:  CensusLinker.selfTest();

/* Universal export: ES module, CommonJS, or plain <script> global. */
const __exports = { CensusLinker, defaultConfig, jaroWinkler };
if (typeof module !== 'undefined' && module.exports) module.exports = __exports;
else if (typeof globalThis !== 'undefined') globalThis.CensusLinkerModule = __exports;
export { CensusLinker, defaultConfig, jaroWinkler };
