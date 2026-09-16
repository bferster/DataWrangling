// diagnostics.js
// ---------------------------------------------------------------------------
// Diagnostics — the numbers that decide how much work the rest of the app has
// to do. Run this before reviewing anything.
//
// The four that matter most:
//
//   epsJoin        Do the EPS HISTIDs actually resolve to census records we
//                  hold? If they do, most of the county is identified without
//                  the matcher touching it. If they do not, the matcher is
//                  doing all of the work and the review queue is long.
//   holdingCounts  Our holding count against the EPS holding count. A shortfall
//                  on the EPS side means our ingest split multi-enslaver
//                  holdings, which puts the wrong enslaver on real people.
//   initials       The share of single-letter given names. In 1860 this is
//                  around 30% of owners and 21% of heads, and it is the reason
//                  name similarity cannot carry the 1860 pass.
//   nameUniqueness How often an exact first+last match finds exactly one
//                  candidate in the block. This is the ceiling on seeding from
//                  names alone.
// ---------------------------------------------------------------------------

class Diagnostics {

	constructor(data, fellegi) {
		this.data = data;
		this.f = fellegi;
	}

	static pct(a, b) { return b ? +(100 * a / b).toFixed(1) : null; }

	run(county, year, eps) {
		const data = this.data;
		const owners = data.owners(county, year);
		const holdings = data.holdings(county, year);
		const census = data.census(county, year);
		const pool = data.censusPool(county, year);
		const blocks = data.blocks(county, year);

		const out = {
			county, year,
			sources: {
				census: census.length,
				schedule: data.schedule(county, year).length,
				owners: owners.length,
				holdings: holdings.length,
				candidatePool: pool.length,
				heads: census.filter((m) => m._head).length,
			},
			blocks: blocks.map((b) => ({
				enum: b.key === null ? '(unknown)' : b.key,
				owners: b.nOwners,
				candidates: b.nCandidates,
				unblocked: !!b.unblocked,
			})),
		};

		out.ownerNames = this._ownerNames(owners);
		out.initials = this._initials(owners, pool);
		out.nameUniqueness = this._nameUniqueness(blocks);
		out.monotone = this._monotone(county, year);
		out.ipums = {
			mentionsWithId: data.ipumsCoverage.withId,
			mentionsTotal: data.ipumsCoverage.total,
			censusWithId: census.filter((m) => m._ipums).length,
			censusTotal: census.length,
		};

		if (eps) {
			out.eps = eps.joinReport(data);
			out.eps.sizeHistogram = eps.sizeHistogram().slice(0, 12);
			out.holdingCounts = {
				ours: holdings.length,
				eps: eps.holdings.length,
				difference: holdings.length - eps.holdings.length,
			};
		}

		if (this.f && blocks.length) {
			const b = blocks.find((x) => x.nCandidates > 0) || blocks[0];
			try { out.capability = this.f.capability(b.owners, b.candidates); } catch (e) { out.capability = null; }
		}
		return out;
	}

	_ownerNames(owners) {
		const byName = new Map();
		let blank = 0, nonPerson = 0;
		const nonPersonSamples = [];
		// Token-level test, not a substring test: "estate" as a substring is
		// harmless but the moment the list grows, "heir" catches nothing and
		// "co" catches sixty Cochrans.
		const NP = /(^|\s)(estate|estates|heirs?|heirs'|trustee|trustees|guardian|admr|administrator|executor|exor|agent|agt|company|co)(\s|$|')/i;
		for (const o of owners) {
			const nm = String(o.full_name || '').trim();
			if (!nm) { blank++; continue; }
			if (NP.test(nm) || /&/.test(nm) || /'s\s+estate/i.test(nm)) {
				nonPerson++;
				if (nonPersonSamples.length < 10) nonPersonSamples.push(nm);
			}
			const key = (Match.normUpper(o.first_name) + '|' + Match.normUpper(o.last_name));
			byName.set(key, (byName.get(key) || 0) + 1);
		}
		let repeated = 0, maxRep = 0;
		for (const c of byName.values()) { if (c > 1) repeated++; if (c > maxRep) maxRep = c; }
		return {
			rows: owners.length,
			distinctNames: byName.size,
			repeatedNames: repeated,
			maxRepetitions: maxRep,
			blankNames: blank,
			nonPersonNames: nonPerson,
			nonPersonSamples,
		};
	}

	_initials(owners, pool) {
		const single = (arr, get) => arr.filter((x) => String(get(x) || '').trim().length === 1).length;
		return {
			ownerSingleLetter: Diagnostics.pct(single(owners, (x) => x.first_name), owners.length),
			candidateSingleLetter: Diagnostics.pct(single(pool, (x) => x.first_name), pool.length),
			ownerWithMiddle: Diagnostics.pct(owners.filter((x) => Match.isPresent(x.middle_name)).length, owners.length),
			candidateWithMiddle: Diagnostics.pct(pool.filter((x) => Match.isPresent(x.middle_name)).length, pool.length),
		};
	}

	// How many owners have exactly one exact first+last match inside their own
	// block. This is the size of the seed set: the anchors that can be laid down
	// before any interpolation is trustworthy.
	_nameUniqueness(blocks) {
		let zero = 0, one = 0, many = 0, total = 0;
		for (const b of blocks) {
			const idx = new Map();
			for (const c of b.candidates) {
				const k = Match.normUpper(c.first_name) + '|' + Match.normUpper(c.last_name);
				idx.set(k, (idx.get(k) || 0) + 1);
			}
			const seen = new Set();
			for (const o of b.owners) {
				const k = Match.normUpper(o.first_name) + '|' + Match.normUpper(o.last_name);
				if (seen.has(k)) continue;
				seen.add(k);
				total++;
				const n = idx.get(k) || 0;
				if (n === 0) zero++; else if (n === 1) one++; else many++;
			}
		}
		return { distinctOwners: total, noExactMatch: zero, exactlyOne: one, twoOrMore: many, seedRate: Diagnostics.pct(one, total) };
	}

	// Verify the assumption the whole alignment rests on: that enumeration date
	// increases with line number, separately on each side. If a block comes back
	// well below 100%, the order prior is not safe there and the position term
	// should be widened or switched off for that block.
	_monotone(county, year) {
		const check = (arr) => {
			const v = arr.filter((m) => m._date != null).sort((a, b) => (a._line || 0) - (b._line || 0)).map((m) => m._date);
			if (v.length < 2) return null;
			let ok = 0;
			for (let i = 1; i < v.length; i++) if (v[i] >= v[i - 1]) ok++;
			return Diagnostics.pct(ok, v.length - 1);
		};
		const byEnum = (arr) => {
			const g = new Map();
			for (const m of arr) { const k = m._enum || '(unknown)'; if (!g.has(k)) g.set(k, []); g.get(k).push(m); }
			const out = {};
			for (const [k, v] of g.entries()) out[k] = check(v);
			return out;
		};
		return {
			schedule: byEnum(this.data.owners(county, year)),
			census: byEnum(this.data.censusPool(county, year)),
		};
	}

	// Plain-text rendering, for the diagnostics pane and for pasting into notes.
	static format(d) {
		const L = [];
		const p = (s) => L.push(s);
		p(`${d.county} ${d.year}`);
		p('');
		p('Sources');
		p(`  census rows            ${d.sources.census}`);
		p(`  heads of household     ${d.sources.heads}`);
		p(`  candidate pool (15+)   ${d.sources.candidatePool}`);
		p(`  schedule rows          ${d.sources.schedule}`);
		p(`  enslaver rows          ${d.sources.owners}`);
		p(`  holdings               ${d.sources.holdings}`);
		p('');
		p('Enumerator blocks');
		for (const b of d.blocks) p(`  ${String(b.enum).padEnd(12)} ${String(b.owners).padStart(5)} owners  ${String(b.candidates).padStart(6)} candidates${b.unblocked ? '  (unblocked)' : ''}`);
		p('');
		p('Enslaver names');
		p(`  distinct               ${d.ownerNames.distinctNames} of ${d.ownerNames.rows} rows`);
		p(`  repeated names         ${d.ownerNames.repeatedNames} (max ${d.ownerNames.maxRepetitions}x)`);
		p(`  blank                  ${d.ownerNames.blankNames}`);
		p(`  not a person           ${d.ownerNames.nonPersonNames}${d.ownerNames.nonPersonSamples.length ? '  e.g. ' + d.ownerNames.nonPersonSamples.slice(0, 3).join(', ') : ''}`);
		p('');
		p('Given names as a single letter');
		p(`  enslavers              ${d.initials.ownerSingleLetter}%`);
		p(`  census candidates      ${d.initials.candidateSingleLetter}%`);
		p('');
		p('Exact first+last inside the block');
		p(`  no match               ${d.nameUniqueness.noExactMatch}`);
		p(`  exactly one            ${d.nameUniqueness.exactlyOne}   (seed anchors: ${d.nameUniqueness.seedRate}%)`);
		p(`  two or more            ${d.nameUniqueness.twoOrMore}`);
		p('');
		p('Enumeration date monotone in line order');
		for (const [k, v] of Object.entries(d.monotone.schedule)) p(`  schedule ${String(k).padEnd(10)} ${v == null ? 'n/a' : v + '%'}`);
		for (const [k, v] of Object.entries(d.monotone.census)) p(`  census   ${String(k).padEnd(10)} ${v == null ? 'n/a' : v + '%'}`);
		p('');
		p('IPUMS identifiers');
		p(`  census rows with an id ${d.ipums.censusWithId} of ${d.ipums.censusTotal}`);
		if (d.eps) {
			p('');
			p('EPS');
			p(`  holdings               ${d.eps.holdings}   (ours: ${d.holdingCounts.ours}, difference ${d.holdingCounts.difference})`);
			p(`  ids look like GUIDs    ${d.eps.idLooksLikeGuid ? 'yes' : 'no'}`);
			p(`  holdings with a holder ${d.eps.linked}  (${Diagnostics.pct(d.eps.linked, d.eps.holdings)}%)`);
			p(`  resolving to a census  ${d.eps.resolvable}  (${Diagnostics.pct(d.eps.resolvable, d.eps.linked)}% of linked)`);
			if (!d.eps.idLooksLikeGuid) {
				p('');
				p('  HISTID is documented as a 36-character string matching the');
				p('  slaveholder in the IPUMS full count population data. These are not');
				p('  in that form, so this file has been through a transform that lost');
				p('  the join. Re-download from usa.ipums.org/usa/slave/slave_data.shtml.');
			} else if (d.eps.resolvable === 0 && d.eps.linked > 0) {
				p('');
				p('  The ids are well formed but none resolve. Either the census ingest');
				p('  is not carrying ipums_id, or the two id spaces are different.');
			}
		}
		if (d.capability) {
			p('');
			p('Evidence available for this source pair');
			p(`  ceiling                ${d.capability.ceilingBits} bits`);
			p(`  needed for p >= 0.9    ${d.capability.bitsNeededFor90} bits`);
			p(`  headroom               ${d.capability.headroom} bits`);
			const have = Object.entries(d.capability.available).filter(([, v]) => v).map(([k]) => k);
			p(`  fields in play         ${have.join(', ') || 'none'}`);
		}
		return L.join('\n');
	}
}

if (typeof window !== 'undefined') window.Diagnostics = Diagnostics;
if (typeof module !== 'undefined' && module.exports) module.exports = { Diagnostics };
