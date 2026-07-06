const fs = require('fs');
const path = require('path');
const { CensusLinker } = require('./censuslinker.js');

// Parse arguments
const args = process.argv.slice(2);
if (args.includes('--self-test')) {
  console.log('Running self test...');
  const testRes = CensusLinker.selfTest();
  console.log(JSON.stringify(testRes, null, 2));
  process.exit(testRes.passed ? 0 : 1);
}

const mentionsPath = path.join(__dirname, '..', 'DATA', 'mentions.csv');
const assertionsPath = path.join(__dirname, '..', 'DATA', 'assertions.csv');
const outputPath = path.join(__dirname, '..', 'result.csv');

console.log(`Loading mentions from: ${mentionsPath}`);
const mentionsText = fs.readFileSync(mentionsPath, 'utf8');
console.log(`Parsing mentions...`);
const mentions = parseCsv(mentionsText);
console.log(`Loaded ${mentions.length} mentions.`);

console.log(`Loading assertions from: ${assertionsPath}`);
const assertionsText = fs.readFileSync(assertionsPath, 'utf8');
console.log(`Parsing assertions...`);
const assertions = parseCsv(assertionsText);
console.log(`Loaded ${assertions.length} assertions.`);

console.log('Running CensusLinker...');
const startTime = Date.now();
const linker = new CensusLinker(mentions, assertions, { logger: console.log });
const results = linker.run();
const duration = ((Date.now() - startTime) / 1000).toFixed(2);
console.log(`Linkage complete in ${duration} seconds.`);
console.log(`Found ${results.sameAsAssertions.length} isSameAs assertions.`);
console.log('Stats:', JSON.stringify(results.stats, null, 2));

console.log(`Writing results to ${outputPath}`);
const csvHeader = 'assertion_id,subject_id,predicate,object_id,start_year,end_year,who,confidence\n';
const csvLines = results.sameAsAssertions.map(a => formatCsvRow([
  a.assertion_id,
  a.subject_id,
  a.predicate,
  a.object_id,
  a.start_year,
  a.end_year,
  '70-80',
  a.confidence
]));
fs.writeFileSync(outputPath, csvHeader + csvLines.join('\n') + '\n', 'utf8');
console.log('Done.');

function parseCsv(text) {
  const records = [];
  let headers = [];
  const len = text.length;
  let i = 0;

  function nextRow() {
    const row = [];
    while (i < len) {
      if (text[i] === '\r' || text[i] === '\n') {
        if (text[i] === '\r' && i + 1 < len && text[i + 1] === '\n') i++;
        i++;
        break;
      }
      let field = '';
      if (text[i] === '"') {
        i++; // skip opening quote
        while (i < len) {
          if (text[i] === '"') {
            if (i + 1 < len && text[i + 1] === '"') {
              field += '"';
              i += 2;
            } else {
              i++; // skip closing quote
              break;
            }
          } else {
            field += text[i];
            i++;
          }
        }
      } else {
        const start = i;
        while (i < len && text[i] !== ',' && text[i] !== '\r' && text[i] !== '\n') {
          i++;
        }
        field = text.substring(start, i);
      }
      row.push(field);
      if (i < len && text[i] === ',') {
        i++;
        if (i < len && (text[i] === '\r' || text[i] === '\n')) {
          row.push('');
        }
      }
    }
    return row.length > 0 ? row : null;
  }

  const first = nextRow();
  if (!first) return [];
  headers = first.map(h => h.trim());

  while (i < len) {
    const row = nextRow();
    if (!row) continue;
    if (row.length === 1 && row[0] === '') continue;
    const obj = {};
    for (let j = 0; j < headers.length; j++) {
      obj[headers[j]] = row[j] !== undefined ? row[j] : '';
    }
    records.push(obj);
  }
  return records;
}

function formatCsvRow(fields) {
  return fields.map(f => {
    if (f === null || f === undefined) return '';
    const s = String(f);
    if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }).join(',');
}
