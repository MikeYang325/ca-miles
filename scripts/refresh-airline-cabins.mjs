import { writeFile } from 'node:fs/promises';

const url = 'https://ffp.airchina.com.cn/apigateway/user/jsonp/mileageCumulateCalculation';
const airlines = 'NZ LH TG AC TP MS AI LO SQ BR OU JP UA NH O6 ET TA AV LR T0 2K OS A3 OZ CM LX SN SA TK ZH CX B7 SC TV NX CA HO KY VL AZ'.split(' ');
const referenceDate = new Date().toISOString().slice(0, 10);

async function query(code) {
  const payload = { org: 'PEK', des: 'SHA', flightDate: referenceDate, flightNo: `${code}0`, memberGrade: 'Normal' };
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: '*/*',
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      Origin: 'https://ffp.airchina.com.cn',
      Referer: 'https://ffp.airchina.com.cn/plan/mileage_accumulate_calculator.html',
      'X-Requested-With': 'XMLHttpRequest',
      'User-Agent': 'Mozilla/5.0 AppleWebKit/537.36 Chrome/151 Safari/537.36',
    },
    body: new URLSearchParams({ data: JSON.stringify(payload) }),
  });
  if (!response.ok) throw new Error(`${code}: HTTP ${response.status}`);
  const data = await response.json();
  if (!data.success && /此航班无舱位累积信息|航班号输入不正确/.test(data.message || '')) return [code, []];
  if (!data.success || !Array.isArray(data.body)) throw new Error(`${code}: ${data.message || '官网未返回舱位表'}`);
  return [code, data.body.map(item => ({ subClassName: String(item.subClassName || ''), rate: String(item.gradingMilageRate || '') })).filter(item => item.subClassName && item.rate)];
}

const result = {};
for (let index = 0; index < airlines.length; index += 5) {
  for (const [code, tiers] of await Promise.all(airlines.slice(index, index + 5).map(query))) result[code] = tiers;
}

await writeFile('airline-cabins.json', `${JSON.stringify({ source: 'Air China PhoenixMiles', referenceRoute: 'PEK-SHA', referenceDate, airlines: result }, null, 2)}\n`);
