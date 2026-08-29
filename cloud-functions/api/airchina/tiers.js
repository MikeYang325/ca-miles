const OFFICIAL_URL = 'https://ffp.airchina.com.cn/apigateway/user/jsonp/mileageCumulateCalculation';
const GRADES = new Set(['Normal', 'Junior', 'Silver', 'Gold', 'Platinum', 'LifetimePlatinum']);

function reply(status, body = null) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
  if (body === null) return new Response(null, { status, headers });
  headers['Content-Type'] = 'application/json; charset=utf-8';
  return new Response(JSON.stringify(body), { status, headers });
}

export default async function onRequest({ request }) {
  if (request.method === 'OPTIONS') return reply(204);
  if (request.method !== 'POST') return reply(405, { success: false, message: '仅支持 POST 请求' });
  try {
    const input = await request.json();
    const payload = {
      org: String(input?.origin || '').toUpperCase().replace(/\s+/g, ''),
      des: String(input?.destination || '').toUpperCase().replace(/\s+/g, ''),
      flightDate: String(input?.flightDate || ''),
      flightNo: String(input?.flightNo || '').toUpperCase().replace(/\s+/g, ''),
      memberGrade: String(input?.memberGrade || 'Normal'),
    };
    if (!/^[A-Z]{3}$/.test(payload.org) || !/^[A-Z]{3}$/.test(payload.des) || payload.org === payload.des) return reply(400, { success: false, message: '机场三字码无效' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.flightDate)) return reply(400, { success: false, message: '日期无效' });
    if (!/^(CA|ZH|NX|SC|KY)\d{1,4}[A-Z]?$/.test(payload.flightNo)) return reply(400, { success: false, message: '航班号无效' });
    if (!GRADES.has(payload.memberGrade)) return reply(400, { success: false, message: '会员卡等无效' });
    const upstream = await fetch(OFFICIAL_URL, {
      method: 'POST',
      headers: {
        Accept: '*/*',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        Origin: 'https://ffp.airchina.com.cn',
        Referer: 'https://ffp.airchina.com.cn/plan/mileage_accumulate_calculator.html',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: new URLSearchParams({ data: JSON.stringify(payload) }),
      signal: AbortSignal.timeout(15000),
    });
    if (!upstream.ok) throw new Error(`国航接口返回 ${upstream.status}`);
    const official = await upstream.json();
    if (!official.success || !Array.isArray(official.body)) return reply(422, { success: false, message: official.message || '国航未返回累计数据' });
    const tiers = official.body.map(item => ({
      subClassName: String(item.subClassName || ''),
      rate: String(item.gradingMilageRate || ''),
      availableMileage: Number(item.availableMileage) || 0,
      gradingMileage: Number(item.gradingMileage) || 0,
      gradingSegments: Number(item.gradingSeq) || 0,
    }));
    return reply(200, { success: true, source: 'Air China PhoenixMiles', tiers });
  } catch (error) {
    const message = error?.name === 'TimeoutError' ? '国航官方接口查询超时，请稍后重试' : error.message || '国航官方接口暂时不可用';
    return reply(502, { success: false, message });
  }
}
