const OFFICIAL_AIRPORTS_URL = 'https://ffp.airchina.com.cn/resources/airport_code_me_me_mc_2_v3.js';
const SUPPLEMENTAL_AIRPORTS = [
  { name: '萨格勒布机场', pinyin: 'Zagreb', code: 'ZAG', initials: 'sglb', city: '萨格勒布' },
];

function reply(status, body = null) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Cache-Control': 's-maxage=21600, stale-while-revalidate=86400',
  };
  if (body === null) return new Response(null, { status, headers });
  headers['Content-Type'] = 'application/json; charset=utf-8';
  return new Response(JSON.stringify(body), { status, headers });
}

function parseAirports(source) {
  const match = source.match(/airportcodes\s*=\s*\[([\s\S]*?)\]\s*;?\s*$/);
  if (!match) throw new Error('国航机场数据格式异常');
  const records = [];
  const pattern = /'((?:\\.|[^'])*)'/g;
  let item;
  while ((item = pattern.exec(match[1]))) records.push(item[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\'));
  const airports = records.map(record => {
    const [name, pinyin, rawCode, initials, city] = record.split('|');
    return { name, pinyin, code: String(rawCode || '').toUpperCase(), initials, city };
  }).filter(item => item.name && /^[A-Z]{3}$/.test(item.code));
  if (!airports.length) throw new Error('国航未返回机场数据');
  const knownCodes = new Set(airports.map(item => item.code));
  airports.push(...SUPPLEMENTAL_AIRPORTS.filter(item => !knownCodes.has(item.code)));
  return airports;
}

export default async function onRequest({ request }) {
  if (request.method === 'OPTIONS') return reply(204);
  if (request.method !== 'GET') return reply(405, { success: false, message: '仅支持 GET 请求' });
  try {
    const upstream = await fetch(OFFICIAL_AIRPORTS_URL, {
      headers: {
        Accept: '*/*',
        Referer: 'https://ffp.airchina.com.cn/plan/mileage_accumulate_calculator.html',
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!upstream.ok) throw new Error(`国航机场接口返回 ${upstream.status}`);
    return reply(200, { success: true, source: 'Air China', airports: parseAirports(await upstream.text()) });
  } catch (error) {
    const message = error?.name === 'TimeoutError' ? '国航机场数据查询超时，请稍后重试' : error.message || '国航机场数据暂时不可用';
    return reply(502, { success: false, message });
  }
}
