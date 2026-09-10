const fs = require('fs');
const Papa = require('papaparse');
const { Match } = require('../COMMON/match.js');
const { Fellegi } = require('../COMMON/fellegi.js');

const csvText = fs.readFileSync('./COMMON/mentions.csv', 'utf8');
const mentionsRows = Papa.parse(csvText, { header: true, skipEmptyLines: true }).data;

class Runner {
    normStr(s) { return String(s || '').trim(); }
    hhKey(m) {
        if (!m) return null;
        const h = m.household_id || m.census_household_id || m.hh_id;
        return h ? String(h).trim() : null;
    }
    parseRange(val) {
        if (!val) return null;
        const matches = String(val).match(/\d{4}/g);
        if (!matches || !matches.length) return null;
        const nums = matches.map(Number);
        return [Math.min(...nums), Math.max(...nums)];
    }
    birthBuckets(m) {
        const r = this.parseRange(m.birth_year);
        if (!r) return [];
        const b0 = Math.floor(r[0] / 5), b1 = Math.floor(r[1] / 5);
        const set = new Set();
        for (let b = b0 - 1; b <= b1 + 1; b++) set.add(b);
        return Array.from(set);
    }
    fbKey(fn, b) {
        return (fn || '').toUpperCase().slice(0, 3) + '_' + b;
    }
}

const runner = new Runner();
const sourceSource = 'AUG-CN-1870';
const targetSource = 'AUG-CN-1880';
const vpRows = mentionsRows.filter(r => (r.source || '').trim().toUpperCase() === sourceSource);
const censusMentions = mentionsRows.filter(r => (r.source || '').trim().toUpperCase() === targetSource);

const phoneticIndex = new Map();
const makeIndexKey = (prefix, val) => prefix + ':' + String(val).trim().toUpperCase();
const addToIndex = (prefix, val, mention) => {
    if (!val) return;
    const k = makeIndexKey(prefix, val);
    if (!phoneticIndex.has(k)) phoneticIndex.set(k, []);
    phoneticIndex.get(k).push(mention);
};

for (const m of censusMentions) {
    if (m.last_name) addToIndex('L', m.last_name, m);
    if (m.nysiis_last_name) addToIndex('N', m.nysiis_last_name, m);
    if (m.full_name) addToIndex('F', m.full_name, m);
    if (m.metaphone_last_name) {
        const parts = String(m.metaphone_last_name).split(':');
        if (parts[0]) addToIndex('M', parts[0], m);
        if (parts[1]) addToIndex('M', parts[1], m);
    }
    const fnm = m.norm_first_name || m.first_name;
    if (fnm) for (const b of runner.birthBuckets(m)) addToIndex('FB', runner.fbKey(fnm, b), m);
}

const matcher = new Match({ candidatePrior: 0.002 });
const fellegi = new Fellegi({ match: matcher, prior: 0.002 });
fellegi.usePool(censusMentions);
matcher._fellegi = fellegi;

const retrieveSurname = (person) => {
    const set = new Set();
    const addKeys = (prefix, val) => {
        if (set.size >= 800) return;
        const k = makeIndexKey(prefix, val);
        const list = phoneticIndex.get(k);
        if (list) for (let c = 0; c < list.length && set.size < 800; c++) set.add(list[c]);
    };
    if (person.last_name) addKeys('L', person.last_name);
    if (person.nysiis_last_name) addKeys('N', person.nysiis_last_name);
    if (person.full_name) addKeys('F', person.full_name);
    return set;
};

const retrieveFirstName = (person) => {
    const set = new Set();
    const fn = person.norm_first_name || person.first_name;
    const r = runner.parseRange(person.birth_year);
    if (fn && r) {
        const b0 = Math.floor(r[0] / 5) - 2, b1 = Math.floor(r[1] / 5) + 2;
        for (let b = b0; b <= b1 && set.size < 120; b++) {
            const k = makeIndexKey('FB', runner.fbKey(fn, b));
            const list = phoneticIndex.get(k);
            if (list) for (let c = 0; c < list.length && set.size < 120; c++) set.add(list[c]);
        }
    }
    return set;
};

const totalVp = vpRows.length;
const perPerson = new Array(totalVp).fill(null).map(() => []);
const edges = [];
const floor = 0.4;
const familyBoostEnabled = false;
const BETA = 0.0;
const LEVER_WEIGHTS = { name: 0.40, birth: 0.30 };
const BIRTH_PROFILES = {
    CENSUS_CENSUS: { sigma: 3.0, knockout: 12 },
    SCHEDULE_INVOLVED: { sigma: 3.5, knockout: 12 }
};

console.log('Starting optimized run across', totalVp, 'rows with familyBoostEnabled =', familyBoostEnabled);
let tPrev = Date.now();
const tStart = Date.now();
for (let c = 0; c < totalVp; c += 2000) {
    const endC = Math.min(c + 2000, totalVp);
    for (let i = c; i < endC; i++) {
        const person = vpRows[i];
        let hasPlausible = false;
        const seen = new Set();

        const evaluateCand = (cand) => {
            const mid = cand.mention_id;
            if (seen.has(mid)) return;
            seen.add(mid);

            const mr = matcher.MatchPerson(person, cand, {
                censusYear: 1880,
                personKin: null,
                candidateHousehold: null,
                weights: LEVER_WEIGHTS,
                birthProfiles: BIRTH_PROFILES,
                householdBoost: BETA,
                prior: 0.002
            });
            if (mr.tier === 'KNOCKOUT' || mr.score <= 0) return;
            const entry = { candidate: cand, score: mr.score, why: mr.why };
            perPerson[i].push(entry);
            if (mr.score >= floor) {
                edges.push({ pi: i, mid: mid, entry: entry });
                hasPlausible = true;
            }
        };

        for (const cand of retrieveSurname(person)) evaluateCand(cand);
        if (!hasPlausible) {
            for (const cand of retrieveFirstName(person)) evaluateCand(cand);
        }

        // Keep only top 8 candidates per person to avoid memory explosion
        if (perPerson[i].length > 8) {
            perPerson[i].sort((a, b) => b.score - a.score);
            perPerson[i].length = 8;
        }
    }
    const pct = Math.round((endC / totalVp) * 100);
    const memMb = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
    const dt = Date.now() - tPrev;
    tPrev = Date.now();
    console.log(`Processed ${endC}/${totalVp} (${pct}%) in ${dt}ms | Heap: ${memMb}MB | Edges: ${edges.length}`);
}
console.log(`FINISHED ALL 28,784 ROWS in ${(Date.now() - tStart)/1000}s! Final Heap: ${Math.round(process.memoryUsage().heapUsed/1024/1024)}MB`);
