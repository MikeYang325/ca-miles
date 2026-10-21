import { writeFile } from 'node:fs/promises';

const url = 'https://ca-miles.lovefly.club/api/airchina/tiers';
const airlines = 'NZ LH TG AC TP MS AI LO SQ BR OU JP UA NH O6 ET TA AV LR T0 2K OS A3 OZ CM LX SN SA TK ZH CX B7 SC TV NX CA HO KY VL AZ'.split(' ');
const referenceDate = new Date().toISOString().slice(0, 10);

async function query(code) {
  const payload = { origin: 'PEK', destination: 'SHA', flightDate: referenceDate, flightNo: code + '0', memberGrade: 'Normal' };
  let response;
  for (let attempt = 0; attempt < 3; attempt++) {
    response = undefined;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(20000),
      });
    } catch (error) {
      if (attempt === 2) throw error;
    }
    if (response && (response.ok || (response.status < 500 && response.status !== 429) || attempt === 2)) break;
    if (response) await response.body?.cancel();
    await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
  }
  const data = await response.json();
  if (!data.success && /此航班无舱位累积信息|航班号输入不正确/.test(data.message || '')) return [];
  if (!response.ok) throw new Error(code + ': HTTP ' + response.status);
  if (!data.success || !Array.isArray(data.tiers)) throw new Error(code + ': ' + (data.message || '官网未返回舱位表'));
  return data.tiers.map(item => ({ subClassName: String(item.subClassName || ''), rate: String(item.rate || '') })).filter(item => item.subClassName && item.rate);
}

const result = {};
for (const code of airlines) result[code] = await query(code);

await writeFile('airline-cabins.json', `${JSON.stringify({ source: 'Air China PhoenixMiles', referenceRoute: 'PEK-SHA', referenceDate, airlines: result }, null, 2)}\n`);
