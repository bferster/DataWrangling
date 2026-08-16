/**
 * generate_oracle.mjs
 * Runs the canonical `double-metaphone` npm package against a large word list
 * and prints JSON oracle data that the rigorous test suite will consume.
 */
import { doubleMetaphone } from './test_oracle/node_modules/double-metaphone/index.js';

// ─── Comprehensive word corpus ───────────────────────────────────────────────
const words = [
  // Philips original test words
  "ptah", "ceasar", "ach", "chemical", "choral",
  // Silent initial pairs
  "gnarly", "knack", "pneumatic", "wrack", "psycho",
  "aeon", "aegis",
  // B
  "bubble", "crab", "subtle",
  // C rules
  "caesar", "chianti", "michael", "chiastic", "chyme",
  "character", "charisma", "orchestra", "architect", "orchid",
  "schooner", "achtung", "bacher", "macher", "czerny",
  "wicz", "social", "ocean", "lucia", "garcia", "gracias",
  "acceleration", "accident", "soccer", "success",
  // D rules
  "edgar", "edge", "badge", "judge", "fidget",
  // F
  "offer", "phone", "graph",
  // G rules
  "ghost", "ghoul", "gnarl", "gnu", "gnome",
  "aghast", "night", "knight", "right", "daughter",
  "laugh", "though", "rough", "dough", "plough",
  "ginger", "gentle", "gem", "gym", "gyrate",
  "german", "gerbil", "goblin", "gorge", "girl",
  "aggie", "oggi", "van gogh", "luigi", "triage",
  "weight", "eight", "freight",
  // H
  "hour", "honest", "herb", "heir",
  // J
  "jose", "san jose", "javier", "julio", "jorge",
  "jean", "jacob", "jack", "james",
  // K
  "kneel", "knife", "know",
  // L
  "llano", "llama", "villa", "tequila",
  "morillo", "cabrillo", "castilla", "falla",
  // M
  "dumb", "thumb", "climb", "bomb",
  // N
  "inn", "nun", "naan",
  // P
  "phone", "phase", "pharmacy", "sphere",
  "pneumonia", "ptarmigan", "psalm", "psyche",
  // Q
  "quiche", "qua",
  // R
  "roger", "river", "ranger",
  // S rules
  "island", "isle", "sugar", "sure",
  "sham", "shame", "machine", "special",
  "station", "session", "asia", "passion",
  "school", "schedule", "schooner",
  "scissors", "schism", "scene",
  "slovak", "slav", "snob",
  // T rules
  "thomas", "thyme", "thorn",
  "motion", "nation", "action",
  "catch", "batch", "match",
  // V
  "vivid", "valve",
  // W
  "write", "wrap", "wren",
  "warsaw", "renew",
  "witzke", "berkowitz",
  // X
  "xavier", "xian", "xerox",
  // Z
  "zhivago", "zhao", "zsa",
  "pizza", "piazza", "pizazz",
  // Compound/hyphenated
  "o'brien", "mccarthy", "macdonald",
  // Slavo-Germanic
  "wozzeck", "kafka", "dvorak",
  "szczepanski", "wczasy", "krzyzowski",
  // German names
  "schmidt", "schneider", "schwartz", "strauss",
  "pfister", "pfeiffer",
  // French-origin
  "bourgeois", "fiancee", "ballet",
  // Spanish-origin
  "garcia", "rodriguez", "hernandez", "martinez",
  "jose", "juarez",
  // Italian-origin
  "ferrari", "giovanni", "gianotti",
  // Miscellaneous common names
  "smith", "jones", "williams", "brown", "davis",
  "miller", "wilson", "moore", "taylor", "anderson",
  "thomas", "jackson", "white", "harris", "martin",
  "thompson", "young", "allen", "king", "wright",
  "scott", "green", "baker", "adams", "nelson",
  "carter", "mitchell", "perez", "roberts", "turner",
  "phillips", "campbell", "parker", "evans", "edwards",
  "collins", "stewart", "sanchez", "morris", "rogers",
  "reed", "cook", "morgan", "bell", "murphy",
  "bailey", "rivera", "cooper", "cox", "howard",
  "ward", "torres", "peterson", "gray", "ramirez",
  "james", "watson", "brooks", "kelly", "sanders",
  "price", "bennett", "wood", "barnes", "ross",
  "henderson", "coleman", "jenkins", "perry", "powell",
  "long", "patterson", "hughes", "flores", "washington",
  "butler", "simmons", "foster", "gonzales", "bryant",
  "alexander", "russell", "griffin", "diaz", "hayes",
  // Edge cases
  "", "a", "b", "z",
  "ae", "gn", "kn", "pn", "wr",
  "aaaa", "zzzz",
  "pneumonoultramicroscopicsilicovolcanoconiosis",
];

const oracle = {};
for (const word of words) {
  if (word.trim() === "") continue;
  oracle[word] = doubleMetaphone(word);
}

process.stdout.write(JSON.stringify(oracle, null, 2));
