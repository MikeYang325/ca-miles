import { readFile, writeFile } from 'node:fs/promises';

const source = 'https://davidmegginson.github.io/ourairports-data/airports.csv';
const parseCsv = text => {
  const rows = [], row = [], field = [];
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index], next = text[index + 1];
    if (char === '"' && quoted && next === '"') { field.push('"'); index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) { row.push(field.join('')); field.length = 0; }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(field.join('')); field.length = 0;
      if (row.some(Boolean)) rows.push(row.splice(0));
    } else field.push(char);
  }
  row.push(field.join(''));
  if (row.some(Boolean)) rows.push(row);
  return rows;
};

const official = JSON.parse(await readFile('airports.json', 'utf8'));
const rows = parseCsv(await (await fetch(source)).text());
const headers = new Map(rows.shift().map((name, index) => [name, index]));
const airports = new Map(official.map(item => [item.code, item]));
for (const row of rows) {
  const code = row[headers.get('iata_code')]?.toUpperCase();
  if (!/^[A-Z]{3}$/.test(code) || row[headers.get('scheduled_service')] !== 'yes' || airports.has(code)) continue;
  const name = row[headers.get('name')] || code;
  const city = row[headers.get('municipality')] || name;
  airports.set(code, { name, pinyin: city, code, initials: city, city });
}
const result = [...airports.values()].sort((a, b) => a.code.localeCompare(b.code));
await writeFile('airports.json', `${JSON.stringify(result, null, 2)}\n`);
console.log(`merged ${result.length} airports; EZE=${result.some(item => item.code === 'EZE')}`);
