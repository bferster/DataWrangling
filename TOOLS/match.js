// match.js
// ---------------------------------------------------------------------------
// Match — standalone name-comparison primitives.
//
// Collects the three name-matching capabilities the scoring pipeline needs:
//   1. nickname / canonical-name resolution
//   2. Jaro-Winkler string similarity
//   3. name-rarity weighting
//
// No external dependencies — does not require score.js, Normalize, or any
// module. Everything is inline. Tunables (rarity thresholds, extra nickname
// pairs) can be supplied through the constructor.
//
// NOTE ON PROVENANCE: score.js contained no nickname data of its own — it only
// called Normalize.getNickname(). The NICKNAMES table below is transcribed in
// full from Normalize.md (the project's authoritative source). Likewise the
// rarity buckets and the Jaro-Winkler contract (case-insensitive, no external
// deps) follow the algorithms specified in Normalize.md.
// ---------------------------------------------------------------------------

class Match {

	// Rarity thresholds + modifiers (Fellegi-Sunter name weighting, per Normalize.md):
	//   Count <= 5  (Very Rare):        +15
	//   Count <= 20 (Uncommon):          +5
	//   Count 21-100 (Average):           0
	//   Count 101-500 (Common):          -5
	//   Count > 500 (Extremely Common): -15
	// The *Max fields are the inclusive upper bound of each bucket.
	static DEFAULT_RARITY = {
		veryRareMax: 5,
		uncommonMax: 20,
		averageMax: 100,
		commonMax: 500,
		modVeryRare: 15,
		modUncommon: 5,
		modAverage: 0,
		modCommon: -5,
		modExtremelyCommon: -15,
	};

	// Below this Jaro-Winkler score a "Fuzzy" name match is treated as ~zero rather
	// than a small positive (jwFuzzyPassThreshold in score.js).
	static DEFAULT_JW_FUZZY_PASS = 0.85;

	// Nickname -> canonical map, transcribed in full from the NICKNAMES object in
	// Normalize.md. Direction is nickname -> full name ("BILL" -> "WILLIAM").
	//
	// KNOWN DUPLICATE KEYS (JS object literal = last-wins, matching how the source
	// object evaluates): "ED" resolves to EDMUND (a later entry) although the
	// source comments note EDWARD was the intended winner; "KIT" resolves to
	// CATHERINE (shadowing CHRISTOPHER); "SUSY" resolves to SUSANNAH (shadowing
	// SUSAN). Reassign any of these via `new Match({ nicknames: { ED: 'EDWARD' } })`.
	static DEFAULT_NICKNAMES = {
		// William
		"WM": "WILLIAM", "BILL": "WILLIAM", "BILLY": "WILLIAM",
		"WILL": "WILLIAM", "WILLY": "WILLIAM", "WILLIE": "WILLIAM",

		// Robert
		"ROBT": "ROBERT", "ROB": "ROBERT", "BOB": "ROBERT",
		"BOBBY": "ROBERT", "ROBBIE": "ROBERT",

		// James
		"JAS": "JAMES", "JIM": "JAMES", "JIMMY": "JAMES", "JAMIE": "JAMES",

		// Charles
		"CHAS": "CHARLES", "CHARLIE": "CHARLES", "CHUCK": "CHARLES", "CARL": "CHARLES",

		// Thomas
		"THOS": "THOMAS", "TOM": "THOMAS", "TOMMY": "THOMAS",

		// John
		"JNO": "JOHN", "JON": "JOHN", "JACK": "JOHN", "JACKIE": "JOHN",
		"JONNY": "JOHN", "JOHNNY": "JOHN",

		// Daniel
		"DAN": "DANIEL", "DANNY": "DANIEL",

		// Edward
		"ED": "EDWARD", "EDDIE": "EDWARD", "NED": "EDWARD", "TED": "EDWARD", "TEDDY": "EDWARD",

		// George
		"GEO": "GEORGE",

		// Joseph
		"JOS": "JOSEPH", "JOE": "JOSEPH", "JOEY": "JOSEPH",

		// Samuel
		"SAM": "SAMUEL", "SAMMY": "SAMUEL",

		// Alexander
		"ALEX": "ALEXANDER", "ALECK": "ALEXANDER", "ALEC": "ALEXANDER",
		"SANDY": "ALEXANDER",

		// Patrick
		"PAT": "PATRICK", "PADDY": "PATRICK",

		// Matthew
		"MATT": "MATTHEW", "MAT": "MATTHEW",

		// Michael
		"MIKE": "MICHAEL", "MICK": "MICHAEL", "MICKEY": "MICHAEL",
		"MICH": "MICHAEL",

		// David
		"DAVE": "DAVID", "DAVEY": "DAVID", "DAVY": "DAVID",

		// Christopher
		"CHRIS": "CHRISTOPHER", "KIT": "CHRISTOPHER",

		// Richard
		"RICH": "RICHARD", "RICK": "RICHARD", "DICK": "RICHARD",
		"RICHD": "RICHARD", "DICKY": "RICHARD",

		// Henry
		"HARRY": "HENRY", "HAL": "HENRY", "HEN": "HENRY",

		// Benjamin
		"BEN": "BENJAMIN", "BENNY": "BENJAMIN", "BENJ": "BENJAMIN",

		// Frederick
		"FRED": "FREDERICK", "FREDDY": "FREDERICK", "FREDK": "FREDERICK",

		// Francis
		"FRANK": "FRANCIS", "FRAN": "FRANCIS", "FRAS": "FRANCIS",

		// Andrew
		"ANDY": "ANDREW",

		// Anthony
		"TONY": "ANTHONY", "ANT": "ANTHONY",

		// Arthur
		"ART": "ARTHUR", "ARTIE": "ARTHUR",

		// Albert
		"AL": "ALBERT", "ALB": "ALBERT",

		// Alfred
		"ALF": "ALFRED", "ALFIE": "ALFRED",

		// Walter
		"WALT": "WALTER", "WALLY": "WALTER",

		// Peter
		"PETE": "PETER",

		// Stephen/Steven
		"STEVE": "STEPHEN", "STEPH": "STEPHEN",

		// Nicholas
		"NICK": "NICHOLAS", "NICKY": "NICHOLAS",

		// Nathaniel
		"NAT": "NATHANIEL", "NATE": "NATHANIEL", "NATHL": "NATHANIEL",

		// Abraham
		"ABE": "ABRAHAM",

		// Isaac
		"IKE": "ISAAC",

		// Elijah
		"LI": "ELIJAH", "LIJE": "ELIJAH",

		// Emanuel / Emmanuel
		"MANNY": "EMANUEL", "MANUEL": "EMANUEL",

		// Harvey
		"HARV": "HARVEY",

		// Lewis / Louis
		"LEW": "LEWIS",

		// Moses
		"MOSE": "MOSES",

		// Solomon
		"SOL": "SOLOMON",

		// Tobias
		"TOBY": "TOBIAS",

		// Jeremiah
		"JERRY": "JEREMIAH", "JER": "JEREMIAH",

		// Ezekiel
		"ZEKE": "EZEKIEL",

		// Cornelius
		"NEIL": "CORNELIUS", "CORN": "CORNELIUS",

		// Bartholomew
		"BART": "BARTHOLOMEW",

		// Edmund  (NOTE: "ED" here overrides the Edward entry above under last-wins)
		"ED": "EDMUND",

		// Archibald
		"ARCH": "ARCHIBALD", "ARCHIE": "ARCHIBALD",

		// Augustus
		"GUS": "AUGUSTUS",

		// Ambrose
		"AMB": "AMBROSE",

		// Zachariah / Zachary
		"ZACH": "ZACHARIAH", "ZACK": "ZACHARIAH",

		// ---------- Female names ----------

		// Elizabeth
		"LIZ": "ELIZABETH", "LIZZIE": "ELIZABETH", "LIZZY": "ELIZABETH",
		"BETH": "ELIZABETH", "BETTY": "ELIZABETH", "BETTE": "ELIZABETH",
		"BESS": "ELIZABETH", "BESSIE": "ELIZABETH", "ELIZA": "ELIZABETH",
		"ELIZ": "ELIZABETH", "LIBBY": "ELIZABETH",

		// Mary
		"MOLLY": "MARY", "POLLY": "MARY", "MAE": "MARY", "MAMIE": "MARY",

		// Margaret
		"MAG": "MARGARET", "MAGGIE": "MARGARET", "MEG": "MARGARET",
		"PEGGY": "MARGARET", "MARG": "MARGARET", "MARGT": "MARGARET",
		"RITA": "MARGARET",

		// Catherine / Katherine  (NOTE: "KIT" here overrides the Christopher entry)
		"KATE": "CATHERINE", "KATIE": "CATHERINE", "KIT": "CATHERINE",
		"KITTY": "CATHERINE", "KATH": "CATHERINE",

		// Sarah
		"SARA": "SARAH", "SALLY": "SARAH", "SAL": "SARAH",

		// Susan / Susannah  (NOTE: "SUSY" here overrides the Susan entry)
		"SUE": "SUSAN", "SUSIE": "SUSAN", "SUSY": "SUSAN",
		"SUSY_": "SUSANNAH", "SUSA": "SUSANNAH",
		"SUSY": "SUSANNAH",

		// Ann / Anne / Hannah
		"ANNIE": "ANN", "ANNA": "ANN", "NAN": "ANN", "NANNY": "ANN",
		"HANNA": "HANNAH",

		// Martha
		"MART": "MARTHA", "MATTIE": "MARTHA",

		// Rebecca
		"BECCA": "REBECCA", "BECKY": "REBECCA",

		// Caroline / Carolina
		"CARRIE": "CAROLINE", "CAROL": "CAROLINE",

		// Eleanor
		"NELL": "ELEANOR", "NELLIE": "ELEANOR", "NORA": "ELEANOR",

		// Frances
		"FANNY": "FRANCES",

		// Harriet
		"HATTIE": "HARRIET",

		// Louisa
		"LOU": "LOUISA", "LULA": "LOUISA",

		// Matilda
		"TILLY": "MATILDA", "TILLIE": "MATILDA",

		// Virginia
		"GINNY": "VIRGINIA",

		// Lavinia
		"VINA": "LAVINIA", "VINEY": "LAVINIA",

		// Priscilla
		"PRISSY": "PRISCILLA", "CILLA": "PRISCILLA",

		// Delilah
		"DELIA": "DELILAH", "LILA": "DELILAH",

		// Lucinda
		"LUCY": "LUCINDA",

		// Phillis / Phyllis (common in enslaved records)
		"PHILLIS": "PHYLLIS",

		// Minerva
		"MINNIE": "MINERVA",

		// -----------------------------------------------------------------------
		// Additions mined from mentions.csv (first-name frequency analysis).
		// These are abbreviations, -ie/-y diminutives, and spelling variants of
		// canonicals already in the table; counts below are occurrences in the
		// 150,827-row mentions set at time of analysis. Ambiguous diminutives
		// (NANCY, JENNIE, NETTIE, HETTIE, MILLIE, PATSY, MAY, MARIAH, ABRAM, ...)
		// were intentionally left out pending a mapping decision — see notes.
		// -----------------------------------------------------------------------

		// abbreviations
		"SAML": "SAMUEL",       // 446
		"ALEXR": "ALEXANDER",   // 10
		"ANDW": "ANDREW",       // 1
		"EDWD": "EDWARD",       // 18
		"JOSH": "JOSHUA",       // 3

		// Elizabeth cluster
		"ELISABETH": "ELIZABETH", // 347
		"BETTIE": "ELIZABETH",    // 529
		"BETSY": "ELIZABETH",     // 257
		"BETSEY": "ELIZABETH",    // 51
		"LIZA": "ELIZABETH",      // 6

		// Sarah cluster
		"SALLIE": "SARAH",      // 709
		"SADIE": "SARAH",       // 29
		"SADY": "SARAH",        // 1

		// Frances cluster
		"FANNIE": "FRANCES",    // 558
		"FRANKIE": "FRANCES",   // 1

		// Ann cluster
		"NANNIE": "ANN",        // 336

		// Mary cluster
		"MOLLIE": "MARY",       // 147

		// Margaret cluster
		"MARGIE": "MARGARET",   // 6
		"MAGGY": "MARGARET",    // 2

		// Catherine cluster
		"CATHARINE": "CATHERINE", // 970
		"KATY": "CATHERINE",      // 13

		// Rachel (spelling variant -> standalone canonical)
		"RACHAEL": "RACHEL",    // 199

		// Susannah cluster
		"SUSANNA": "SUSANNAH",  // 85
		"SUSANAH": "SUSANNAH",  // 43

		// male -ie/-y diminutives
		"JOHNNIE": "JOHN",      // 13
		"JIMMIE": "JAMES",      // 4
		"TOMMIE": "THOMAS",     // 1
		"BILLIE": "WILLIAM",    // 6
		"GEORGIE": "GEORGE",    // 19
		"CHARLEY": "CHARLES",   // 25
		"FREDDIE": "FREDERICK", // 3

		// Ambiguous diminutives — added by explicit decision. Each has plausible
		// alternate canonicals (noted); revisit if false merges appear in ER.
		"NETTIE": "HENRIETTA",  // 114  (alt: Antoinette / Jeannette / Nannette)
		"HETTIE": "HESTER",     // 93   (alt: Henrietta)
		"MILLIE": "MILDRED",    // 81   (alt: Amelia / Millicent / Emily)
		"MAY": "MARY",          // 72   (alt: Margaret; also a standalone name)
		"ABRAM": "ABRAHAM",     // 82   (alt: distinct biblical name, not a variant)
	};

	// --- small self-contained helpers ---
	static isPresent(v) {
		return v !== null && v !== undefined && String(v).trim() !== "" && String(v).trim().toLowerCase() !== "null";
	}

	static normUpper(s) {
		return Match.isPresent(s) ? String(s).trim().toUpperCase().replace(/[^A-Z]/g, "") : "";
	}

	static clamp(x, lo, hi) {
		return Math.max(lo, Math.min(hi, x));
	}

	constructor(config = {}) {
		// Rarity bucketing config — override individual buckets via the constructor.
		this.rarity = { ...Match.DEFAULT_RARITY, ...(config.rarity || {}) };

		// Threshold governing how Jaro-Winkler results feed fuzzy name matching.
		this.jwFuzzyPassThreshold = (config.jwFuzzyPassThreshold != null)
			? config.jwFuzzyPassThreshold
			: Match.DEFAULT_JW_FUZZY_PASS;

		// Build the nickname -> canonical lookup from the built-in table, then
		// fold in caller additions (same { NICK: 'CANONICAL' } shape). Every
		// canonical also maps to itself so a canonical input is stable. normUpper
		// on keys collapses the placeholder "SUSY_" back onto "SUSY" harmlessly —
		// it exists only so both source lines survive object-literal parsing.
		this._nickToCanon = new Map();
		const tables = [Match.DEFAULT_NICKNAMES, config.nicknames || {}];
		for (const table of tables) {
			for (const nickRaw of Object.keys(table)) {
				const nick = Match.normUpper(nickRaw);
				const canon = Match.normUpper(table[nickRaw]);
				if (!nick || !canon) continue;
				this._nickToCanon.set(nick, canon);
				if (!this._nickToCanon.has(canon)) this._nickToCanon.set(canon, canon);
			}
		}
	}

	// -----------------------------------------------------------------------
	// 1. NICKNAME
	// -----------------------------------------------------------------------

	// Canonical form of a given name, upper-cased and normalized
	// ("Bill"/"Billy"/"Will" -> "WILLIAM"). Unknown names return their own
	// normalized-upper form (treated as already canonical).
	nickname(name) {
		const key = Match.normUpper(name);
		if (!key) return "";
		return this._nickToCanon.get(key) || key;
	}

	// Alias kept for API parity: the normalized-upper canonical form is exactly
	// what `nickname` already returns.
	canonical(name) {
		return this.nickname(name);
	}

	// True when two given names share a canonical root (nickname-equivalent).
	sameNickname(a, b) {
		const ca = this.nickname(a);
		const cb = this.nickname(b);
		return !!ca && ca === cb;
	}

	// -----------------------------------------------------------------------
	// 2. JARO-WINKLER  (case-insensitive, no external deps, per Normalize.md)
	// -----------------------------------------------------------------------

	// Jaro similarity in [0, 1] — proportion of matching characters (within a
	// sliding window) adjusted for transpositions.
	jaro(s1, s2) {
		if (!s1 || !s2) return 0.0;
		s1 = String(s1).toUpperCase();
		s2 = String(s2).toUpperCase();
		if (s1 === s2) return 1.0;

		const len1 = s1.length;
		const len2 = s2.length;
		const matchDistance = Math.max(0, Math.floor(Math.max(len1, len2) / 2) - 1);

		const s1Matches = new Array(len1).fill(false);
		const s2Matches = new Array(len2).fill(false);

		let matches = 0;
		for (let i = 0; i < len1; i++) {
			const start = Math.max(0, i - matchDistance);
			const end = Math.min(i + matchDistance + 1, len2);
			for (let j = start; j < end; j++) {
				if (s2Matches[j]) continue;
				if (s1[i] !== s2[j]) continue;
				s1Matches[i] = true;
				s2Matches[j] = true;
				matches++;
				break;
			}
		}
		if (matches === 0) return 0.0;

		// Count transpositions among the matched characters.
		let transpositions = 0;
		let k = 0;
		for (let i = 0; i < len1; i++) {
			if (!s1Matches[i]) continue;
			while (!s2Matches[k]) k++;
			if (s1[i] !== s2[k]) transpositions++;
			k++;
		}
		transpositions /= 2;

		return (matches / len1 + matches / len2 + (matches - transpositions) / matches) / 3;
	}

	// Jaro-Winkler: Jaro similarity with a bonus for a shared leading prefix (up
	// to 4 chars), applied only once the Jaro score clears boostThreshold.
	jaroWinkler(s1, s2, prefixScale = 0.1, boostThreshold = 0.7) {
		if (!s1 || !s2) return 0.0;                 // Quit if empty
		s1 = String(s1).toUpperCase();
		s2 = String(s2).toUpperCase();
		if (s1 === s2) return 1.0;                  // Identical

		const j = this.jaro(s1, s2);                // Phase 1: base Jaro
		if (j < boostThreshold) return j;

		// Phase 2: Winkler prefix-scale modification.
		const maxPrefix = Math.min(4, s1.length, s2.length);
		let prefix = 0;
		while (prefix < maxPrefix && s1[prefix] === s2[prefix]) prefix++;

		return j + prefix * prefixScale * (1 - j);
	}

	// -----------------------------------------------------------------------
	// 3. RARITY  (Fellegi-Sunter name weighting, per Normalize.md)
	// -----------------------------------------------------------------------

	// Build first/last-name frequency maps over a candidate pool — the input the
	// rarity modifier is measured against. Keys are normalized-upper names.
	buildNameFrequencies(mentions) {
		const firstNameFreq = new Map();
		const lastNameFreq = new Map();
		if (Array.isArray(mentions)) {
			for (const m of mentions) {
				if (!m) continue;
				const fk = Match.normUpper(m.first_name || m.norm_first_name);
				if (fk) firstNameFreq.set(fk, (firstNameFreq.get(fk) || 0) + 1);
				const lk = Match.normUpper(m.last_name);
				if (lk) lastNameFreq.set(lk, (lastNameFreq.get(lk) || 0) + 1);
			}
		}
		return { firstNameFreq, lastNameFreq };
	}

	// Raw rarity modifier (in the "x100" points score.js logs), given a name and
	// the matching frequency map. Positive for rare names, negative for common.
	// Name missing / not in map -> 0.
	nameWeightModifier(value, freqMap) {
		const r = this.rarity;
		const key = Match.normUpper(value);
		if (!key || !freqMap || typeof freqMap.get !== 'function' || !freqMap.has(key)) return 0;
		const count = freqMap.get(key) || 0;

		if (count <= r.veryRareMax) return r.modVeryRare;
		if (count <= r.uncommonMax) return r.modUncommon;
		if (count <= r.averageMax) return r.modAverage;
		if (count <= r.commonMax) return r.modCommon;
		return r.modExtremelyCommon;
	}

	// Apply rarity to a base name-lever score the way score.js's field scorers
	// did: convert the x100 modifier to a 0-1 delta and clamp back into range.
	applyRarity(base, value, freqMap) {
		if (!(base > 0)) return base;
		const modifier = this.nameWeightModifier(value, freqMap) / 100;
		return Match.clamp(base + modifier, 0, 1);
	}

	// =======================================================================
	// LEVER A — NAME AGREEMENT   (implements Step 3 of the scoring spec)
	//
	//   MatchName(objA, objB) -> Number in [0, 1]
	//
	// objA is treated as the target, objB as the candidate. Each object may
	// carry: full_name, first_name, middle_name, last_name, norm_first_name,
	// metaphone_last_name ("PRIMARY:SECONDARY"), nysiis_last_name. Any may be
	// absent. Only the single highest-firing rung contributes the base score
	// (rungs are NOT summed); rarity (3.5) then adjusts it and the result is
	// clamped to [0, 1]. Middle name is excluded from the score (3.6, tiebreak
	// only) and surfaced separately in the detail object.
	//
	// Optional inputs (set once on the instance, since MatchName takes only the
	// two objects):
	//   usePool(mentions) / useFrequencies(ff, lf) -> enables rarity (3.5).
	//     Without them the rarity term is 0 and the rungs score on their own.
	//   setSurnameBridge(fn) -> enables the BRIDGED surname rung (3.1). fn(a,b)
	//     returns true when a hasNameVariant / marriage assertion links the two
	//     surnames. Without it, BRIDGED is skipped.
	// =======================================================================

	// Load a blocked candidate pool for rarity weighting (3.5). Callers should
	// pass the pool already blocked to the target's source list / norm_race /
	// gender, per the spec — Match does not re-block.
	usePool(mentions) {
		const { firstNameFreq, lastNameFreq } = this.buildNameFrequencies(mentions);
		return this.useFrequencies(firstNameFreq, lastNameFreq);
	}

	// Attach precomputed frequency maps directly (keys normalized-upper).
	useFrequencies(firstNameFreq, lastNameFreq) {
		this._firstNameFreq = firstNameFreq || null;
		this._lastNameFreq = lastNameFreq || null;
		this._initialFreq = null; // derived lazily from _firstNameFreq
		return this;
	}

	// Provide a surname-bridge predicate for the BRIDGED rung (3.1).
	setSurnameBridge(fn) {
		this._surnameBridge = (typeof fn === 'function') ? fn : null;
		return this;
	}

	// --- public score ------------------------------------------------------

	// Returns the Lever A score in [0, 1].
	MatchName(objA, objB) {
		return this.matchNameDetail(objA, objB).score;
	}

	// Same computation, but returns the full breakdown: { score, rung,
	// surnameStrength, surnameKind, weakSurnameHint, needsCorroboration,
	// givenClass, rarityFirst, raritySurname, middleTiebreak }. Useful to the
	// caller because needsCorroboration / weakSurnameHint tell Levers B and C
	// whether this candidate may stand on name evidence alone.
	matchNameDetail(objA, objB) {
		objA = objA || {};
		objB = objB || {};

		// --- 3.1 surname-match determination -------------------------------
		const sm = this._surnameMatch(objA, objB);
		const firedSurname = sm.strength >= 0.8;          // 0.6 weak does NOT fire

		// --- 3.2 given-name classification ---------------------------------
		const gA = this._classifyGiven(objA);
		const gB = this._classifyGiven(objB);

		let rung = 'NONE';
		let base = 0.0;
		let needsCorroboration = false;
		let usedFirstNameAgreement = false; // gates first-name rarity (3.5)
		let usedInitial = false;            // gates initial-letter rarity (3.5)
		let initialLetter = '';

		if (gA.cls === 'ABSENT' || gB.cls === 'ABSENT') {
			// Given-name lever excluded — rely on surname alone.
			if (firedSurname) { rung = 'SURNAME_ONLY'; base = 0.3; needsCorroboration = true; }
		} else if (gA.cls === 'FULL' && gB.cls === 'FULL') {
			// --- 3.3 Jaro-Winkler rung (FULL vs FULL) ---
			const canonA = this.nickname(gA.norm);
			const canonB = this.nickname(gB.norm);
			const givenExact = !!canonA && canonA === canonB;
			const jw = this.jaroWinkler(gA.norm, gB.norm);
			const givenNickname = jw >= this.jwFuzzyPassThreshold;

			if (givenExact && firedSurname) {
				rung = 'EXACT_FIRST_SURNAME'; base = 1.0; usedFirstNameAgreement = true;
			} else if (givenNickname && firedSurname) {
				rung = 'NICKNAME_FIRST_SURNAME'; base = 0.85; usedFirstNameAgreement = true;
			} else if ((givenExact || givenNickname) && sm.strength >= 0.6 && sm.strength < 0.8) {
				// Moderate/weak phonetic surname (only 0.6 lands here) paired with
				// first-name agreement. Spec sets base 0.7 and states this rung
				// "requires no additional corroboration" — the first-name
				// agreement is treated as the corroboration for the weak hint.
				rung = 'PHONETIC_MODERATE_SURNAME'; base = 0.7; usedFirstNameAgreement = true;
			} else if ((givenExact || givenNickname) && sm.strength === 0.0) {
				rung = 'GIVEN_NAME_ONLY'; base = 0.4; needsCorroboration = true; usedFirstNameAgreement = true;
			} else if (firedSurname) {
				// First names are both full but disagree; lean on surname alone at
				// a reduced independent weight (mirrors 3.4's inconsistent path).
				rung = 'SURNAME_ONLY'; base = 0.3; needsCorroboration = true;
			}
		} else {
			// --- 3.4 initial-consistency rung (at least one INITIAL) ---
			const bothInitials = gA.cls === 'INITIAL' && gB.cls === 'INITIAL';
			const consistent = bothInitials
				? gA.initial === gB.initial
				: gA.initial === gB.initial; // FULL-vs-INITIAL: compare first letters
			initialLetter = gA.initial || gB.initial;

			if (!consistent) {
				if (firedSurname) { rung = 'SURNAME_ONLY'; base = 0.3; needsCorroboration = true; }
			} else if (bothInitials) {
				if (firedSurname) {
					rung = 'BOTH_INITIALS_SURNAME'; base = 0.35; needsCorroboration = true; usedInitial = true;
				}
			} else {
				// one INITIAL, one FULL, consistent
				if (firedSurname) {
					rung = 'INITIAL_CONSISTENT_SURNAME'; base = 0.55; needsCorroboration = true; usedInitial = true;
				}
			}
		}

		// --- 3.5 rarity weighting ------------------------------------------
		let rarityFirst = 0;
		let raritySurname = 0;
		if (base > 0) {
			// Surname rarity: applies whenever a surname rung fired.
			if (firedSurname && this._lastNameFreq) {
				const surname = this._resolveSurname(objA) || this._resolveSurname(objB);
				raritySurname = this.nameWeightModifier(surname, this._lastNameFreq) / 100;
			}
			// Given-name rarity: first-name frequency when the rung fired on
			// first-name agreement; initial-letter inverse modifier for the
			// initials rungs.
			if (usedFirstNameAgreement && this._firstNameFreq) {
				const fn = Match.isPresent(objA.norm_first_name) ? objA.norm_first_name : objA.first_name;
				rarityFirst = this.nameWeightModifier(fn, this._firstNameFreq) / 100;
			} else if (usedInitial && this._firstNameFreq) {
				rarityFirst = this._initialLetterModifier(initialLetter) / 100;
			}
		}

		const score = base > 0 ? Match.clamp(base + rarityFirst + raritySurname, 0, 1) : 0;

		return {
			score,
			rung,
			surnameStrength: sm.strength,
			surnameKind: sm.kind,
			weakSurnameHint: !!sm.weakHint,
			needsCorroboration,
			givenClass: gA.cls + '/' + gB.cls,
			rarityFirst,
			raritySurname,
			middleTiebreak: this._middleTiebreak(objA, objB), // 3.6, not in score
		};
	}

	// --- Lever A helpers ---------------------------------------------------

	// 3.1: resolve the surname-match strength and kind between two objects.
	_surnameMatch(a, b) {
		// 1. full_name exact (case-insensitive, punctuation stripped)
		const fa = this._normFullName(a.full_name);
		const fb = this._normFullName(b.full_name);
		if (fa && fb && fa === fb) return { strength: 1.0, kind: 'EXACT_FULLNAME' };

		// 2. last_name exact (case-insensitive)
		const la = this._normLast(a.last_name);
		const lb = this._normLast(b.last_name);
		if (la && lb && la === lb) return { strength: 1.0, kind: 'EXACT_LASTNAME' };

		// 3. bridged (hasNameVariant / marriage) — only if a bridge is provided
		if (this._surnameBridge && this._surnameBridge(a, b)) {
			return { strength: 0.9, kind: 'BRIDGED' };
		}

		// 4. double metaphone, else NYSIIS fallback
		const dm = this._doubleMetaphoneScore(a.metaphone_last_name, b.metaphone_last_name);
		if (dm === null) {
			// metaphone absent on at least one side -> NYSIIS equality
			const na = Match.normUpper(a.nysiis_last_name);
			const nb = Match.normUpper(b.nysiis_last_name);
			if (na && nb && na === nb) return { strength: 0.85, kind: 'NYSIIS' };
			return { strength: 0.0, kind: 'NO_MATCH' };
		}
		if (dm === 1.0) return { strength: 1.0, kind: 'PHONETIC_STRONG' };
		if (dm === 0.8) return { strength: 0.8, kind: 'PHONETIC_MODERATE' };
		if (dm === 0.6) return { strength: 0.6, kind: 'PHONETIC_WEAK', weakHint: true };
		return { strength: 0.0, kind: 'NO_MATCH' };
	}

	// Compare two double-metaphone codes ("PRIMARY:SECONDARY"). Returns
	// 1.0 / 0.8 / 0.6 / 0.0, or null when either code is absent (caller then
	// falls back to NYSIIS, per 3.1).
	_doubleMetaphoneScore(codeA, codeB) {
		if (!Match.isPresent(codeA) || !Match.isPresent(codeB)) return null;
		const parse = (c) => {
			const parts = String(c).toUpperCase().split(':').map((x) => x.trim().replace(/[^A-Z]/g, ''));
			const primary = parts[0] || '';
			const secondary = parts[1] || primary;
			return { primary, secondary };
		};
		const A = parse(codeA);
		const B = parse(codeB);
		if (!A.primary || !B.primary) return 0.0;
		if (A.primary === B.primary) return 1.0;                       // strong
		if (A.primary === B.secondary || A.secondary === B.primary) return 0.8; // moderate
		if (A.secondary && A.secondary === B.secondary) return 0.6;    // weak
		return 0.0;
	}

	// 3.2: classify a first name as FULL / INITIAL / ABSENT, preferring
	// norm_first_name. Returns { cls, norm, initial }.
	_classifyGiven(o) {
		const raw = Match.isPresent(o.norm_first_name) ? o.norm_first_name : o.first_name;
		const n = Match.normUpper(raw); // strips non-alpha (so "J." -> "J")
		if (!n) return { cls: 'ABSENT', norm: '', initial: '' };
		if (n.length === 1) return { cls: 'INITIAL', norm: n, initial: n };
		return { cls: 'FULL', norm: n, initial: n[0] };
	}

	// full_name: uppercase, punctuation -> space, collapse whitespace.
	_normFullName(s) {
		if (!Match.isPresent(s)) return '';
		return String(s).toUpperCase().replace(/[^A-Z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
	}

	// last_name: case-insensitive exact string (trimmed, alpha-folded).
	_normLast(s) {
		return Match.normUpper(s);
	}

	// Resolve the surname string for rarity (the name, not the metaphone code):
	// prefer last_name, else the final token of full_name.
	_resolveSurname(o) {
		if (Match.isPresent(o.last_name)) return Match.normUpper(o.last_name);
		const full = this._normFullName(o.full_name);
		if (full) { const t = full.split(' '); return Match.normUpper(t[t.length - 1]); }
		return '';
	}

	// 3.5: inverse initial-letter modifier for the initials rungs. Rarer
	// starting letters score higher; common ones (J/M/W...) lower or negative.
	// Derived from the loaded first-name frequency pool; 0 when no pool.
	_initialLetterModifier(letter) {
		const L = Match.normUpper(letter);
		if (!L || !this._firstNameFreq) return 0;
		if (!this._initialFreq) {
			const m = new Map();
			let total = 0;
			for (const [name, cnt] of this._firstNameFreq.entries()) {
				const c = name && name[0];
				if (!c) continue;
				m.set(c, (m.get(c) || 0) + cnt);
				total += cnt;
			}
			m.set('__total__', total || 1);
			this._initialFreq = m;
		}
		const total = this._initialFreq.get('__total__') || 1;
		const share = (this._initialFreq.get(L) || 0) / total;
		// Bucketed inverse mapping onto the same +/-15 scale as name rarity.
		if (share >= 0.09) return -15; // very common initial
		if (share >= 0.06) return -5;
		if (share >= 0.03) return 0;
		if (share >= 0.01) return 5;
		return 15;                     // rare initial
	}

	// 3.6: middle-name tiebreak (not part of the score). Returns
	// 'MATCH' (exact middle name/initial), 'NO_DATA' (either side absent), or
	// 'MISMATCH'. The caller uses this only to break ties after Step 6.
	_middleTiebreak(a, b) {
		const ma = Match.normUpper(a.middle_name);
		const mb = Match.normUpper(b.middle_name);
		if (!ma || !mb) return 'NO_DATA';
		if (ma === mb) return 'MATCH';
		if (ma[0] === mb[0] && (ma.length === 1 || mb.length === 1)) return 'MATCH'; // initial vs full
		return 'MISMATCH';
	}

	// =======================================================================
	// CROSS-CENSUS PERSON MATCHING   (score.md: Levers A+B+C, knockouts, Step 4)
	//
	// Ranks candidate mentions in a later census against one anchor (a verified
	// person or an earlier-census mention treated as one). Scoring is delegated
	// to MatchPerson() (Steps 4-6: profile-aware birth, household continuity
	// with weight redistribution) — this is the canonical cross-census scorer;
	// the earlier fixed-cascade matchCensus()/scoreBirth()/knockouts() were
	// retired in favor of it (2024 cleanup) to avoid two scorers drifting apart.
	//
	// NOTE (1850/1860): neither census recorded relationship-to-head, so no
	// isChildOf/isSpouseOf assertions exist for these sources. Lever C therefore
	// scores household-ROSTER continuity (co-residents matched by name + birth
	// year), not asserted kin. Spouse cannot be singled out without 1880/VR
	// data, so each persisting co-resident contributes equally (+0.5, cap 2.0).
	// =======================================================================

	_gender(o) {
		const g = String((o && o.gender) || '').split(':')[0].trim().toUpperCase();
		return (g === 'M' || g === 'MALE') ? 'M' : (g === 'F' || g === 'FEMALE') ? 'F' : '';
	}
	_race(o) {
		return String((o && (o.norm_race || o.race)) || '').split(':')[0].trim().toUpperCase();
	}
	_birthYear(o) {
		const v = String((o && o.birth_year != null) ? o.birth_year : '').split(':')[0].trim();
		const n = parseInt(v, 10);
		return Number.isFinite(n) ? n : null;
	}

	// --- Lever C — household / family continuity ---------------------------
	// anchorMembers / candidateMembers are the co-resident rosters (excluding
	// the anchor and candidate themselves). Each anchor member is matched to at
	// most one candidate member by name (>= nameThreshold) + birth-year gap +
	// non-disagreeing gender. +0.5 per persisting member, capped at 2.0.
	// Used by MatchPerson() as its Lever C (ctx.personKin / ctx.candidateHousehold).
	scoreHousehold(anchorMembers, candidateMembers, opts = {}) {
		const maxGap = opts.birthGap != null ? opts.birthGap : 3;
		const nameThreshold = opts.nameThreshold != null ? opts.nameThreshold : 0.6;
		const aM = (anchorMembers || []).filter(Boolean);
		const cM = (candidateMembers || []).filter(Boolean);
		const used = new Set();
		const matched = [];
		for (const am of aM) {
			let best = null, bestScore = 0, bestIdx = -1;
			for (let i = 0; i < cM.length; i++) {
				if (used.has(i)) continue;
				const cm = cM[i];
				const ga = this._gender(am), gc = this._gender(cm);
				if (ga && gc && ga !== gc) continue;
				const ay = this._birthYear(am), cy = this._birthYear(cm);
				const gap = (ay != null && cy != null) ? Math.abs(ay - cy) : null;
				if (gap != null && gap > maxGap) continue;
				const ns = this.MatchName(am, cm);
				if (ns < nameThreshold) continue;
				const combo = ns + (gap != null ? (1 - gap / (maxGap + 1)) : 0);
				if (combo > bestScore) { bestScore = combo; best = cm; bestIdx = i; }
			}
			if (best) { used.add(bestIdx); matched.push({ anchor: am, candidate: best }); }
		}
		const score = Math.min(2.0, matched.length * 0.5);
		return { score, matched, count: matched.length, fired: matched.length >= 1 };
	}

	// --- rank a later-census pool against one anchor ----------------------
	// pool: array of candidate mentions (e.g. all AUG-CN-1860 rows).
	// opts: { households: Map(household_id -> [members]), anchorHousehold: [members],
	//         birthWindow: 10, householdOpts: {...}, censusYear, weights, birthProfiles }
	// Blocks the pool (gender/race/birth-window), then scores survivors with
	// MatchPerson() — anchorHousehold is passed through as ctx.personKin.
	rankCensusCandidates(anchor, pool, opts = {}) {
		const window = opts.birthWindow != null ? opts.birthWindow : 10;
		const ay = this._birthYear(anchor);
		const ag = this._gender(anchor);
		const ar = this._race(anchor);
		const anchorHH = opts.anchorHousehold || [];
		const households = opts.households || null;
		const out = [];
		for (const cand of pool) {
			if (cand === anchor) continue;
			// blocking
			if (ag) { const cg = this._gender(cand); if (cg && cg !== ag) continue; }
			if (ar) { const cr = this._race(cand); if (cr && ar && cr !== ar) continue; }
			if (ay != null) { const cy = this._birthYear(cand); if (cy != null && Math.abs(cy - ay) > window) continue; }
			// candidate roster
			let candHH = [];
			if (households) {
				const h = String(cand.household_id || '').trim();
				if (h && households.has(h)) candHH = households.get(h).filter((m) => m !== cand);
			}
			const censusYear = opts.censusYear != null ? opts.censusYear : (parseInt(cand.source_year, 10) || null);
			const res = this.MatchPerson(anchor, cand, {
				censusYear,
				personKin: anchorHH,
				candidateHousehold: candHH,
				householdOpts: opts.householdOpts,
				weights: opts.weights,
				birthProfiles: opts.birthProfiles,
				targetSource: opts.targetSource,
				candidateSource: opts.candidateSource,
			});
			if (res.tier === 'KNOCKOUT') continue;
			out.push(Object.assign({ candidate: cand }, res));
		}
		out.sort((x, y) => y.score - x.score);
		return out;
	}

	// =======================================================================
	// PROBABILITY CALIBRATION
	//
	// The raw lever scores are ordinal similarity, NOT probabilities. This
	// fits P(same person | scores) by logistic regression on labeled pairs
	// (e.g. resolved HITL rows), turning the three lever sub-scores into a
	// calibrated probability. It is Platt-style scaling on the sub-scores.
	//
	// IMPORTANT: a fitted calibrator is only valid on the distribution it was
	// trained on (this census pass, this blocking, this base rate). Re-fit per
	// census pass (1850->1860 weights won't transfer unchanged to 1870->1880),
	// and check reliability() before trusting the numbers. Calibrate on BLOCKED
	// pairs only, so the base rate reflects where the probability is applied.
	// =======================================================================

	// Feature vector for calibration: [ name (A), birth (B), family (Cnorm, 0..1) ].
	// Accepts a raw array, a MatchPerson() result (reads res.why, already
	// normalized), or a flat {name,birth,family}.
	_calibFeatures(res) {
		if (Array.isArray(res)) return res.slice();
		const w = (res && res.why) ? res.why : null;
		const A = w ? (w.name || 0) : (res.name != null ? res.name : 0);
		const B = w ? (w.birth || 0) : (res.birth != null ? res.birth : 0);
		const C = w ? (w.family || 0) : (res.family != null ? res.family : 0); // already 0..1 in `why`
		return [A || 0, B || 0, Math.min(1, C || 0)];
	}

	// Fit P = sigmoid(b + w . z), z = standardized features. Stores the model on
	// the instance so MatchPerson()/probability() can use it.
	// rows: [{ features:[...] | res:<MatchPerson result> | {name,birth,family}, label: 0|1 }]
	// opts: { lambda (L2), lr, epochs }
	fitCalibration(rows, opts = {}) {
		const lambda = opts.lambda != null ? opts.lambda : 1e-3;
		const lr = opts.lr != null ? opts.lr : 0.1;
		const epochs = opts.epochs != null ? opts.epochs : 3000;

		const X = [], y = [];
		for (const r of (rows || [])) {
			const f = r.features ? r.features.slice() : this._calibFeatures(r.res || r);
			if (!f || !f.length) continue;
			X.push(f); y.push(r.label ? 1 : 0);
		}
		const n = X.length, d = n ? X[0].length : 0;
		if (n < 2 || d === 0) throw new Error('fitCalibration: need >=2 labeled rows with features');
		const pos = y.reduce((a, v) => a + v, 0);
		if (pos === 0 || pos === n) {
			// degenerate: all one class — can't learn a slope, warn via flag.
		}

		// standardize features (store mean/std so predict matches)
		const mean = new Array(d).fill(0), std = new Array(d).fill(0);
		for (const row of X) for (let j = 0; j < d; j++) mean[j] += row[j];
		for (let j = 0; j < d; j++) mean[j] /= n;
		for (const row of X) for (let j = 0; j < d; j++) std[j] += (row[j] - mean[j]) ** 2;
		for (let j = 0; j < d; j++) std[j] = Math.sqrt(std[j] / n) || 1;
		const Z = X.map((row) => row.map((v, j) => (v - mean[j]) / std[j]));

		const w = new Array(d).fill(0);
		let b = 0;
		const sig = (t) => 1 / (1 + Math.exp(-t));
		for (let e = 0; e < epochs; e++) {
			const gw = new Array(d).fill(0);
			let gb = 0;
			for (let i = 0; i < n; i++) {
				let t = b;
				for (let j = 0; j < d; j++) t += w[j] * Z[i][j];
				const err = sig(t) - y[i];
				gb += err;
				for (let j = 0; j < d; j++) gw[j] += err * Z[i][j];
			}
			b -= lr * (gb / n);
			for (let j = 0; j < d; j++) w[j] -= lr * (gw[j] / n + lambda * w[j]);
		}

		// training log-loss (fit quality)
		let ll = 0;
		for (let i = 0; i < n; i++) {
			let t = b;
			for (let j = 0; j < d; j++) t += w[j] * Z[i][j];
			const p = Math.min(1 - 1e-12, Math.max(1e-12, sig(t)));
			ll += -(y[i] * Math.log(p) + (1 - y[i]) * Math.log(1 - p));
		}
		ll /= n;

		// unstandardized coefficients (interpretable per lever)
		const rawW = w.map((wj, j) => wj / std[j]);
		let rawB = b;
		for (let j = 0; j < d; j++) rawB -= w[j] * mean[j] / std[j];

		this._calib = { w, b, mean, std, d, n, positives: pos, lambda, logloss: ll, rawW, rawB };
		return this._calib;
	}

	// Predict P(same person). input: feature array | matchCensus result | {name,birth,family}.
	probability(input) {
		if (!this._calib) return null;
		const f = Array.isArray(input) ? input : this._calibFeatures(input);
		const c = this._calib;
		if (f.length !== c.d) throw new Error('probability: feature length ' + f.length + ' != ' + c.d);
		let t = c.b;
		for (let j = 0; j < c.d; j++) t += c.w[j] * ((f[j] - c.mean[j]) / c.std[j]);
		return 1 / (1 + Math.exp(-t));
	}

	// Reliability table: bins predictions and compares mean predicted prob to the
	// empirical match rate, so you can see whether "0.7" really means ~70%.
	reliability(rows, bins = 10) {
		const preds = [];
		for (const r of (rows || [])) {
			const f = r.features ? r.features : this._calibFeatures(r.res || r);
			preds.push({ p: this.probability(f), y: r.label ? 1 : 0 });
		}
		const out = [];
		for (let k = 0; k < bins; k++) {
			const lo = k / bins, hi = (k + 1) / bins;
			const inb = preds.filter((x) => x.p >= lo && (k === bins - 1 ? x.p <= hi + 1e-9 : x.p < hi));
			if (!inb.length) { out.push({ lo, hi, n: 0, meanPred: null, empirical: null }); continue; }
			const meanPred = inb.reduce((a, x) => a + x.p, 0) / inb.length;
			const empirical = inb.reduce((a, x) => a + x.y, 0) / inb.length;
			out.push({ lo, hi, n: inb.length, meanPred, empirical });
		}
		return out;
	}

	// =======================================================================
	// PERSON <-> MENTION MATCHING (strategy Steps 4-6: profile-aware birth,
	// household continuity with weight redistribution, redistributing combiner)
	// =======================================================================

	// Score a verified PERSON against a census/record MENTION. name + birth +
	// family are scored; gender, race, death-before-census, and an out-of-profile
	// birth gap are KNOCKOUTS. A lever with no data is EXCLUDED (not scored 0) and
	// its weight redistributes across the levers that do have data. corroboration
	// (Step 5.3) is a stubbed input until that section is specced.
	//
	// Requires: this.matchNameDetail, this.scoreHousehold (only if rosters supplied).
	// Optional: this.probability([name,birth,Cnorm]) once fitCalibration() has run.
	MatchPerson(person, mention, ctx = {}) {
		const censusYear = ctx.censusYear != null ? ctx.censusYear : (parseInt(mention.source_year, 10) || null);
		const W0 = Object.assign({ name: 0.40, birth: 0.30, household: 0.30 }, ctx.weights || {});
		const corroboration = ctx.corroboration != null ? ctx.corroboration : 0; // Step 5.3 — STUB
		const ko = (reason) => ({ score: 0, tier: 'KNOCKOUT', reason, firedLevers: [], why: null });

		// Lever B source-pair profiles (Step 4.1): Gaussian sigma + knockout ceiling.
		// sigma=2 gives ~0.88 at a 1-year gap; bump sigma for the strategy's ~0.92.
		const PROFILES = ctx.birthProfiles || {
			CENSUS_CENSUS: { sigma: 2.0, knockout: 10 },
			SCHEDULE_INVOLVED: { sigma: 3.5, knockout: 10 },
		};

		const range = (v) => { if (v == null) return null; const n = String(v).match(/\d{3,4}/g); if (!n) return null; const y = n.map(Number); return [Math.min(...y), Math.max(...y)]; };
		const gen = (o) => { const s = String(o.gender || '').split(':')[0].trim().toUpperCase(); return s === 'M' || s === 'MALE' ? 'M' : s === 'F' || s === 'FEMALE' ? 'F' : ''; };
		const rc = (o) => String(o.norm_race || o.race || '').split(':')[0].trim().toUpperCase();
		const isSchedule = (o, src) => /(-SS-|SLAVE)/i.test(String((o && o.source) || src || ''));

		// --- KNOCKOUTS (Step 2): gender / race / death-before-census ---
		const gp = gen(person), gm = gen(mention);
		if (gp && gm && gp !== gm) return ko('GENDER_DISAGREE');
		const rp = rc(person), rm = rc(mention);
		if (rp && rm && rp !== rm) return ko('RACE_DISAGREE');
		const death = range(person.death_year);
		if (death && censusYear && death[1] < censusYear) return ko('DIED_BEFORE_CENSUS');

		// ===== LEVER A: name (gender-aware) =====
		const nd = this.matchNameDetail(person, mention);
		let A = nd.score;
		const gender = gp || gm, surnameFired = nd.surnameStrength >= 0.8, bothLast = person.last_name && mention.last_name;
		if (gender === 'F' && surnameFired) A = Math.min(1, A + 0.05);
		else if (gender === 'M' && !surnameFired && bothLast && nd.surnameStrength === 0) A = Math.min(A, 0.3);
		const aAvailable = nd.rung !== 'NONE';

		// ===== LEVER B: profile-aware smooth birth agreement (Step 4) =====
		const profile = (isSchedule(person, ctx.targetSource) || isSchedule(mention, ctx.candidateSource)) ? 'SCHEDULE_INVOLVED' : 'CENSUS_CENSUS';
		const prof = PROFILES[profile] || PROFILES.CENSUS_CENSUS;
		const bp = range(person.birth_year), bm = range(mention.birth_year);
		let bAvailable = false, B = 0, gap = null;
		if (bp && bm) {
			bAvailable = true;
			gap = (bm[0] > bp[1]) ? bm[0] - bp[1] : (bp[0] > bm[1]) ? bp[0] - bm[1] : 0;
			if (gap > prof.knockout) return ko('BIRTH_GAP_' + gap + '(' + profile + ')');
			B = Math.exp(-(gap * gap) / (2 * prof.sigma * prof.sigma));
		}

		// ===== LEVER C: household / family continuity (Step 5) =====
		let C = { score: 0, count: 0, matched: [], fired: false }, cAvailable = false;
		if (ctx.personKin && ctx.personKin.length && ctx.candidateHousehold && this.scoreHousehold) {
			cAvailable = true;
			C = this.scoreHousehold(ctx.personKin, ctx.candidateHousehold, ctx.householdOpts);
		}
		const Cnorm = Math.min(1, C.score / 2);

		// ===== STEP 6: redistributing weighted combination =====
		let wA = aAvailable ? W0.name : 0;
		let wB = bAvailable ? W0.birth : 0;
		let wC = cAvailable ? W0.household : 0;
		const wSum = (wA + wB + wC) || 1;
		wA /= wSum; wB /= wSum; wC /= wSum;

		const rawScore = wA * A + wB * B + wC * Cnorm;
		// Step 6.3: additive-then-clamp saturates once corroboration>0 — prefer a
		// calibration feature / logit nudge when Step 5.3 is specced. Stubbed at 0.
		const score = Math.max(0, Math.min(1, rawScore + corroboration));

		const fired = [];
		if (aAvailable && nd.rung !== 'SURNAME_ONLY' && A >= 0.4) fired.push('name');
		if (bAvailable && B >= 0.4) fired.push('birth');
		if (C.fired) fired.push('family');
		const tier = fired.length >= 3 ? 'STRONG' : fired.length === 2 ? 'SUPPORTED' : fired.length === 1 ? 'PROVISIONAL' : 'WEAK';

		const out = {
			score, tier, firedLevers: fired, reason: null,
			weights: { name: +wA.toFixed(3), birth: +wB.toFixed(3), household: +wC.toFixed(3) },
			why: {
				name: +A.toFixed(3), birth: +B.toFixed(3), family: +Cnorm.toFixed(3),
				rung: nd.rung, surnameKind: nd.surnameKind, needsCorroboration: !!nd.needsCorroboration,
				birthGap: gap, birthProfile: profile, familyCount: C.count,
				familyMatches: C.matched.map((m) => { const p = m.candidate, yr = (range(p.birth_year) || [''])[0]; return (p.full_name || `${p.first_name || ''} ${p.last_name || ''}`).trim() + (yr ? `-${yr}` : ''); }),
				corroboration, available: { name: aAvailable, birth: bAvailable, household: cAvailable },
			},
		};
		if (this._calib && this.probability) { try { out.probability = this.probability([A, B, Cnorm]); } catch (e) { /* feature mismatch */ } }
		return out;
	}

	// --- name-only calibration (1-D Platt scaling of MatchName scores) ------
	// A NAME-ONLY probability is intentionally weak (perfect names are common among
	// non-matches); use as a per-lever diagnostic. Fit on BLOCKED pairs, re-fit per pass.
	fitNameCalibration(rows, opts = {}) {
		const lr = opts.lr != null ? opts.lr : 0.5;
		const epochs = opts.epochs != null ? opts.epochs : 4000;
		const lambda = opts.lambda != null ? opts.lambda : 1e-4;
		const xs = [], ys = [];
		for (const r of (rows || [])) { const s = Number(r.score); if (!Number.isFinite(s)) continue; xs.push(s); ys.push(r.label ? 1 : 0); }
		const n = xs.length;
		if (n < 2) throw new Error('fitNameCalibration: need >=2 labeled rows');
		const mean = xs.reduce((a, v) => a + v, 0) / n;
		const sd = Math.sqrt(xs.reduce((a, v) => a + (v - mean) ** 2, 0) / n) || 1;
		let w = 0, b = 0;
		const sig = (t) => 1 / (1 + Math.exp(-t));
		for (let e = 0; e < epochs; e++) {
			let gw = 0, gb = 0;
			for (let i = 0; i < n; i++) { const z = (xs[i] - mean) / sd; const err = sig(b + w * z) - ys[i]; gb += err; gw += err * z; }
			b -= lr * (gb / n); w -= lr * (gw / n + lambda * w);
		}
		let ll = 0;
		for (let i = 0; i < n; i++) { const p = Math.min(1 - 1e-12, Math.max(1e-12, sig(b + w * ((xs[i] - mean) / sd)))); ll += -(ys[i] * Math.log(p) + (1 - ys[i]) * Math.log(1 - p)); }
		const A = w / sd, B = b - w * mean / sd;
		this._nameCalib = { w, b, mean, sd, n, positives: ys.reduce((a, v) => a + v, 0), logloss: ll / n, A, B };
		return this._nameCalib;
	}

	// P(same person) from a MatchName() score, after fitNameCalibration().
	nameProbability(score) {
		if (!this._nameCalib) return null;
		const c = this._nameCalib;
		return 1 / (1 + Math.exp(-(c.b + c.w * ((Number(score) - c.mean) / c.sd))));
	}
}

// Export for both browser global and Node.
if (typeof window !== 'undefined') window.Match = Match;
if (typeof module !== 'undefined' && module.exports) module.exports = { Match };
