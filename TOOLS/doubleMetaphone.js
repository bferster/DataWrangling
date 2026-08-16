/**
 * doubleMetaphone.js
 *
 * Double Metaphone phonetic algorithm as standard JavaScript functions.
 * Original algorithm by Lawrence Philips (1990, improved 2000).
 *
 * doubleMetaphone(word)  → colon-separated string 'primary:secondary'
 * doubleMetaphoneMatchScore(word1, word2)  → 0.0 | 0.6 | 0.8 | 1.0
 *
 * Usage:
 *   doubleMetaphone('Smith');                        // => 'SM0:XMT'
 *   doubleMetaphoneMatchScore('Smith', 'Smyth');     // => 1.0
 */

/**
 * Returns a match-confidence score between two words based on their
 * Double Metaphone codes.
 * @param {string} word1
 * @param {string} word2
 * @returns {number} 1.0 | 0.8 | 0.6 | 0.0
 */
function doubleMetaphoneMatchScore(word1, word2) {
	const [p1, s1] = doubleMetaphone(word1).split(':');
	const [p2, s2] = doubleMetaphone(word2).split(':');
	if (p1 === p2) return 1.0;        // Both primaries match → highest confidence
	if (p1 === s2 || s1 === p2) return 0.8; // Primary matches other's secondary
	if (s1 === s2) return 0.6;        // Only secondaries match → weakest
	return 0.0;                        // No match
}

const matchScore = doubleMetaphoneMatchScore;

/**
 * Encodes a word using the Double Metaphone algorithm.
 * @param {string} word
 * @returns {string} 'primary:secondary' codes
 */
function doubleMetaphone(word) {
		if (!word || typeof word !== "string") return ":";

		// Keep original (for multi-word checks like 'san jose')
		const originalUpper = word.toUpperCase();

		// Uppercase and strip non-alpha characters
		let str = word.toUpperCase().replace(/[^A-Z]/g, "");
		if (str.length === 0) return ":";

		const length = str.length;
		let primary = "";
		let secondary = "";
		let index = 0;

		// Helper: safe character access (returns "" if out of range)
		const charAt = (i) => (i >= 0 && i < str.length ? str[i] : "");

		// Helper: check if a substring at position matches any of the given strings
		const contains = (start, len, ...values) => {
			const sub = str.substring(start, start + len);
			return values.includes(sub);
		};

		// Helper: is character a vowel? (guards against out-of-range empty string)
		const isVowel = (i) => {
			const ch = charAt(i);
			return ch !== "" && "AEIOU".includes(ch);
		};

		// Helper: is character a slavo-germanic indicator present in the word?
		const isSlavoGermanic = () =>
			str.includes("W") ||
			str.includes("K") ||
			str.includes("CZ") ||
			str.includes("WITZ");

		// Helper: add codes to primary and secondary
		const add = (p, s) => {
			primary += p;
			secondary += s !== undefined ? s : p;
		};

		// Handle leading silent letters and special cases
		// Note: PS is also a silent pair (psalm, psycho) but PF is NOT (pfister keeps PF)
		if (contains(0, 2, "AE", "GN", "KN", "PN", "WR", "PS")) {
			index++;
		}

		// Initial vowel maps to "A"
		if (charAt(0) === "A" || isVowel(0)) {
			add("A");
			index++;
		}

		const slavoGermanic = isSlavoGermanic();

		while (index < length) {
			const c = charAt(index);

			switch (c) {
				case "A":
				case "E":
				case "I":
				case "O":
				case "U":
				case "Y":
					// Vowels only coded at start (already handled above); others are skipped
					if (index === 0) add("A");
					index++;
					break;

				case "X":
					// Initial X → S primary, S secondary (Xavier-class words in English).
					// Non-initial X is handled later in this same case.
					if (index === 0) {
						add("S");
						index++;
						break;
					}
					// Non-initial X handled in the dedicated X case below
					if (
						!(index === length - 1 &&
							(contains(index - 3, 3, "IAU", "EAU") ||
								contains(index - 2, 2, "AU", "OU")))
					) {
						add("KS");
					}
					index += contains(index + 1, 1, "C", "X") ? 2 : 1;
					break;


				case "B":
					add("P");
					index += charAt(index + 1) === "B" ? 2 : 1;
					break;

				case "Ç":
					add("S");
					index++;
					break;

				case "C":
					// Germanic ACH rule: previous='A', next='H', no vowel 2 back, not followed by I/E (unless BACHER/MACHER)
					if (
						charAt(index - 1) === "A" &&
						charAt(index + 1) === "H" &&
						charAt(index + 2) !== "I" &&
						!isVowel(index - 2) &&
						(charAt(index + 2) !== "E" ||
							contains(index - 2, 6, "BACHER", "MACHER"))
					) {
						add("K");
						index += 2;
						break;
					}
					// Special case for Caesar
					if (index === 0 && contains(index, 6, "CAESAR")) {
						add("S");
						index += 2;
						break;
					}
					// Italian Chianti
					if (contains(index + 1, 3, "HIA")) {
						add("K");
						index += 2;
						break;
					}
					// CH rules
					if (contains(index, 2, "CH")) {
						// Michael
						if (index > 0 && charAt(index + 2) === "A" && charAt(index + 3) === "E") {
							add("K", "X");
							index += 2;
							break;
						}
						// Greek roots: chemistry, chorus
						if (
							index === 0 &&
							(contains(index + 1, 5, "HARAC", "HARIS") ||
								contains(index + 1, 3, "HOR", "HYM", "HIA", "HEM")) &&
							!contains(0, 5, "CHORE")
						) {
							add("K");
							index += 2;
							break;
						}
						// Germanic/Greek/KH sound
						if (
							contains(0, 4, "VAN ", "VON ") ||
							contains(0, 3, "SCH") ||
							contains(index - 2, 6, "ORCHES", "ARCHIT", "ORCHID") ||
							contains(index + 2, 1, "T", "S") ||
							((contains(index - 1, 1, "A", "O", "U", "E") || index === 0) &&
								/[ BFHLMNRVW]/.test(charAt(index + 2)))
						) {
							add("K");
						} else if (index === 0) {
							add("X");
						} else if (contains(0, 2, "MC")) {
							// McHugh etc.
							add("K");
						} else {
							add("X", "K");
						}
						index += 2;
						break;
					}
					// Czerny
					if (contains(index, 2, "CZ") && !contains(index - 2, 4, "WICZ")) {
						add("S", "X");
						index += 2;
						break;
					}
					// Focaccia (C followed by CIA)
					if (contains(index + 1, 3, "CIA")) {
						add("X", "X");
						index += 3;
						break;
					}
					// Double C, but not McClellan
					if (
						contains(index, 2, "CC") &&
						!(index === 1 && charAt(0) === "M")
					) {
						if (
							contains(index + 2, 1, "I", "E", "H") &&
							!contains(index + 2, 2, "HU")
						) {
							// Accident, Accede, Succeed → KS; Bacci, Bertucci (Italian) → X
							const sub = str.substring(index - 1, index + 4);
							if (
								(index === 1 && charAt(index - 1) === "A") ||
								sub === "UCCEE" ||
								sub === "UCCES"
							) {
								add("KS");
							} else {
								add("X");
							}
							index += 3;
							break;
						} else {
							// Pierce's rule
							add("K");
							index += 2;
							break;
						}
					}
					if (contains(index, 2, "CK", "CG", "CQ")) {
						add("K");
						index += 2;
						break;
					}
					// Italian: CIE / CIO → S primary, X secondary
					if (
						charAt(index + 1) === "I" &&
						(charAt(index + 2) === "E" || charAt(index + 2) === "O")
					) {
						add("S", "X");
						index += 2;
						break;
					}
					// CI / CE / CY → S (both codes)
					if (contains(index, 2, "CI", "CE", "CY")) {
						add("S");
						index += 2;
						break;
					}
					add("K");
					// Skip two extra characters in 'Mac Caffrey', 'Mac Gregor'
					if (contains(index + 1, 2, " C", " Q", " G")) {
						index += 3;
					} else if (
						contains(index + 1, 1, "K", "Q") &&
						!contains(index + 1, 2, "CE", "CI")
					) {
						// CK / CQ – the K and Q are silent
						index += 2;
					} else {
						index++;
					}
					break;


				case "D":
					if (contains(index, 2, "DG")) {
						if (contains(index + 2, 1, "I", "E", "Y")) {
							add("J");
							index += 3;
						} else {
							add("TK");
							index += 2;
						}
						break;
					}
					if (contains(index, 2, "DT", "DD")) {
						add("T");
						index += 2;
					} else {
						add("T");
						index++;
					}
					break;

				case "F":
					add("F");
					index += charAt(index + 1) === "F" ? 2 : 1;
					break;

				case "G":
					if (charAt(index + 1) === "H") {
						if (index > 0 && !isVowel(index - 1)) {
							add("K");
							index += 2;
							break;
						}
						if (index === 0) {
							if (charAt(index + 2) === "I") {
								add("J");
							} else {
								add("K");
							}
							index += 2;
							break;
						}
						if (
							(index > 1 && contains(index - 2, 1, "B", "H", "D")) ||
							(index > 2 && contains(index - 3, 1, "B", "H", "D")) ||
							(index > 3 && contains(index - 4, 1, "B", "H"))
						) {
							index += 2;
							break;
						}
						if (
							index > 2 &&
							charAt(index - 1) === "U" &&
							contains(index - 3, 1, "C", "G", "L", "R", "T")
						) {
							add("F");
							index += 2;
							break;
						}
						if (index > 0 && charAt(index - 1) !== "I") {
							add("K");
						}
						index += 2;
						break;
					}
					if (charAt(index + 1) === "N") {
						if (index === 1 && isVowel(0) && !slavoGermanic) {
							add("KN", "N");
						} else {
							if (
								!contains(index + 2, 2, "EY") &&
								charAt(index + 1) !== "Y" &&
								!slavoGermanic
							) {
								add("N", "KN");
							} else {
								add("KN");
							}
						}
						index += 2;
						break;
					}
					if (contains(index + 1, 2, "LI") && !slavoGermanic) {
						add("KL", "L");
						index += 2;
						break;
					}
					if (
						index === 0 &&
						(charAt(index + 1) === "Y" ||
							contains(index + 1, 2, "ES", "EP", "EB", "EL", "EY", "IB", "IL", "IN", "IE", "EI", "ER"))
					) {
						add("K", "J");
						index += 2;
						break;
					}
					if (
						(contains(index + 1, 2, "ER") || charAt(index + 1) === "Y") &&
						!contains(0, 6, "DANGER", "RANGER", "MANGER") &&
						!contains(index - 1, 1, "E", "I") &&
						!contains(index - 1, 3, "RGY", "OGY")
					) {
						add("K", "J");
						index += 2;
						break;
					}
					if (contains(index + 1, 1, "E", "I", "Y") || contains(index - 1, 4, "AGGI", "OGGI")) {
						if (contains(0, 4, "VAN ", "VON ") || contains(0, 3, "SCH") || contains(index + 1, 2, "ET")) {
							add("K");
						} else {
							if (contains(index + 1, 4, "IER ")) {
								add("J");
							} else {
								add("J", "K");
							}
						}
						index += 2;
						break;
					}
					if (charAt(index + 1) === "G") {
						index += 2;
					} else {
						index++;
					}
					add("K");
					break;

				case "H":
					if (
						(index === 0 || isVowel(index - 1)) &&
						isVowel(index + 1)
					) {
						add("H");
						index += 2;
					} else {
						index++;
					}
					break;

				case "J":
					if (contains(index, 4, "JOSE") || originalUpper.startsWith("SAN ")) {
						if (
							(index === 0 && charAt(index + 4) === " ") ||
							str.length === 4 ||
							originalUpper.startsWith("SAN ")
						) {
							add("H");
						} else {
							add("J", "H");
						}
						index++;
						break;
					}
					if (index === 0 && !contains(index, 4, "JOSE")) {
						add("J", "A");
					} else {
						if (isVowel(index - 1) && !slavoGermanic && (charAt(index + 1) === "A" || charAt(index + 1) === "O")) {
							add("J", "H");
						} else {
							if (index === length - 1) {
								add("J", "");
							} else if (
								!contains(index + 1, 1, "L", "T", "K", "S", "N", "M", "B", "Z") &&
								!contains(index - 1, 1, "S", "K", "L")
							) {
								add("J");
							}
						}
					}
					index += charAt(index + 1) === "J" ? 2 : 1;
					break;

				case "K":
					add("K");
					index += charAt(index + 1) === "K" ? 2 : 1;
					break;

				case "L":
					if (charAt(index + 1) === "L") {
						if (
							(index === length - 3 &&
								contains(index - 1, 4, "ILLO", "ILLA", "ALLE")) ||
							((contains(length - 2, 2, "AS", "OS") ||
								contains(length - 1, 1, "A", "O")) &&
								contains(index - 1, 4, "ALLE"))
						) {
							add("L", "");
							index += 2;
							break;
						}
						index += 2;
					} else {
						index++;
					}
					add("L");
					break;

				case "M":
					if (
						(contains(index - 1, 3, "UMB") &&
							(index + 1 === length - 1 || contains(index + 2, 2, "ER"))) ||
						charAt(index + 1) === "M"
					) {
						index += 2;
					} else {
						index++;
					}
					add("M");
					break;

				case "N":
					add("N");
					index += charAt(index + 1) === "N" ? 2 : 1;
					break;

				case "Ñ":
					add("N");
					index++;
					break;

				case "P":
					if (charAt(index + 1) === "H") {
						add("F");
						index += 2;
					} else {
						add("P");
						index += contains(index + 1, 1, "P", "B") ? 2 : 1;
					}
					break;

				case "Q":
					add("K");
					index += charAt(index + 1) === "Q" ? 2 : 1;
					break;

				case "R":
					if (index === length - 1 && !slavoGermanic && contains(index - 2, 2, "IE") && !contains(index - 4, 2, "ME", "MA")) {
						add("", "R");
					} else {
						add("R");
					}
					index += charAt(index + 1) === "R" ? 2 : 1;
					break;

				case "S":
					if (contains(index - 1, 3, "ISL", "YSL")) {
						index++;
						break;
					}
					if (index === 0 && contains(index, 5, "SUGAR")) {
						add("X", "S");
						index++;
						break;
					}
					if (contains(index, 2, "SH")) {
						if (contains(index + 1, 4, "HEIM", "HOEK", "HOLM", "HOLZ")) {
							add("S");
						} else {
							add("X");
						}
						index += 2;
						break;
					}
					if (contains(index, 3, "SIO", "SIA")) {
						if (slavoGermanic) {
							add("S");
						} else {
							add("S", "X");
						}
						index += 3;
						break;
					}
					if (
						(index === 0 && contains(index + 1, 1, "M", "N", "L", "W")) ||
						contains(index + 1, 1, "Z")
					) {
						add("S", "X");
						index += contains(index + 1, 1, "Z") ? 2 : 1;
						break;
					}
					if (contains(index, 2, "SC")) {
						if (charAt(index + 2) === "H") {
							if (
								contains(index + 3, 2, "OO", "ER", "EN", "UY", "ED", "EM")
							) {
								add("SK");
							} else {
								if (index === 0 && !isVowel(3) && charAt(3) !== "W") {
									add("X", "S");
								} else {
									add("X");
								}
							}
							index += 3;
							break;
						}
						if (contains(index + 2, 1, "I", "E", "Y")) {
							add("S");
							index += 3;
							break;
						}
						add("SK");
						index += 3;
						break;
					}
					if (index === length - 1 && contains(index - 2, 2, "AI", "OI")) {
						add("", "S");
					} else {
						add("S");
					}
					index += contains(index + 1, 1, "S", "Z") ? 2 : 1;
					break;

				case "T":
					if (contains(index, 4, "TION")) {
						add("X");
						index += 3;
						break;
					}
					if (contains(index, 3, "TIA", "TCH")) {
						add("X");
						index += 3;
						break;
					}
					if (
						contains(index, 2, "TH") ||
						contains(index, 3, "TTH")
					) {
						if (
							contains(index + 2, 2, "OM", "AM") ||
							contains(0, 4, "VAN ", "VON ") ||
							contains(0, 3, "SCH")
						) {
							add("T");
						} else {
							add("0", "T");
						}
						index += 2;
						break;
					}
					add("T");
					index += contains(index + 1, 1, "T", "D") ? 2 : 1;
					break;

				case "V":
					add("F");
					index += charAt(index + 1) === "V" ? 2 : 1;
					break;

				case "W":
					if (contains(index, 2, "WR")) {
						add("R");
						index += 2;
						break;
					}
					if (index === 0 && (isVowel(index + 1) || contains(index, 2, "WH"))) {
						if (isVowel(index + 1)) {
							add("A", "F");
						} else {
							add("A");
						}
					}
					if (
						(index === length - 1 && isVowel(index - 1)) ||
						contains(index - 1, 5, "EWSKI", "EWSKY", "OWSKI", "OWSKY") ||
						contains(0, 3, "SCH")
					) {
						add("", "F");
						index++;
						break;
					}
					if (contains(index, 4, "WICZ", "WITZ")) {
						add("TS", "FX");
						index += 4;
						break;
					}
					index++;
					break;

				case "X":
					if (
						!(index === length - 1 &&
							(contains(index - 3, 3, "IAU", "EAU") ||
								contains(index - 2, 2, "AU", "OU")))
					) {
						add("KS");
					}
					index += contains(index + 1, 1, "C", "X") ? 2 : 1;
					break;

				case "Z":
					if (charAt(index + 1) === "H") {
						add("J");
						index += 2;
						break;
					}
					if (
						contains(index + 1, 2, "ZO", "ZI", "ZA") ||
						(slavoGermanic && index > 0 && charAt(index - 1) !== "T")
					) {
						add("S", "TS");
					} else {
						add("S");
					}
					index += charAt(index + 1) === "Z" ? 2 : 1;
					break;

				default:
					index++;
					break;
			}
		}

		// Trim trailing spaces from secondary (from Spanish LL rule)
		secondary = secondary.trimEnd();

		const sec = secondary === primary ? primary : secondary;
		return `${primary}:${sec}`;
}

const encode = doubleMetaphone;
doubleMetaphone.encode = encode;
doubleMetaphone.matchScore = doubleMetaphoneMatchScore;

// Backwards-compatibility function wrapper
function DoubleMetaphone() {
	return doubleMetaphone;
}
DoubleMetaphone.encode = doubleMetaphone;
DoubleMetaphone.matchScore = doubleMetaphoneMatchScore;

/* Universal export: ES module, CommonJS, or plain <script> global. */
const __exports = { doubleMetaphone, encode, matchScore, doubleMetaphoneMatchScore, DoubleMetaphone };
if (typeof module !== 'undefined' && module.exports) module.exports = __exports;
if (typeof globalThis !== 'undefined') {
	globalThis.doubleMetaphone = doubleMetaphone;
	globalThis.doubleMetaphoneMatchScore = doubleMetaphoneMatchScore;
	globalThis.DoubleMetaphone = DoubleMetaphone;
}

