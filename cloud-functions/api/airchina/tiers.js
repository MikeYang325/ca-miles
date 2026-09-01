const OFFICIAL_URL = 'https://ffp.airchina.com.cn/apigateway/user/jsonp/mileageCumulateCalculation';
const GRADES = new Set(['Normal', 'Junior', 'Silver', 'Gold', 'Platinum', 'LifetimePlatinum']);
const A3_TIERS = [
  { subClassName: 'F/A/P', rate: '200%' }, { subClassName: 'J', rate: '200%' }, { subClassName: 'C/D', rate: '150%' },
  { subClassName: 'Z/R', rate: '125%' }, { subClassName: 'G', rate: '100%' }, { subClassName: 'E', rate: '90%' },
  { subClassName: 'Y/B', rate: '100%' }, { subClassName: 'M/U/H/Q/V', rate: '75%' }, { subClassName: 'W/S/T', rate: '50%' },
  { subClassName: 'L/K', rate: '25%' },
];

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
    const targetProgram = String(input?.targetProgram || 'CA').toUpperCase();
    const payload = {
      org: String(input?.origin || '').toUpperCase().replace(/\s+/g, ''),
      des: String(input?.destination || '').toUpperCase().replace(/\s+/g, ''),
      flightDate: String(input?.flightDate || ''),
      flightNo: String(input?.flightNo || '').toUpperCase().replace(/\s+/g, ''),
      memberGrade: String(input?.memberGrade || 'Normal'),
    };
    if (!/^[A-Z]{3}$/.test(payload.org) || !/^[A-Z]{3}$/.test(payload.des) || payload.org === payload.des) return reply(400, { success: false, message: '机场三字码无效' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.flightDate)) return reply(400, { success: false, message: '日期无效' });
    if (!/^[A-Z0-9]{2}\d{1,4}[A-Z]?$/.test(payload.flightNo)) return reply(400, { success: false, message: '航班号无效' });
    if (targetProgram === 'A3') {
      if (payload.flightNo.slice(0, 2) !== 'CA') return reply(422, { success: false, message: 'A3 当前先支持累计国航 CA' });
      return reply(200, { success: true, source: 'Aegean Miles+Bonus', targetProgram, tiers: A3_TIERS.map(item => ({ ...item, availableMileage: 0, gradingMileage: 0, gradingSegments: 0 })) });
    }
    if (targetProgram !== 'CA') return reply(400, { success: false, message: '暂不支持该常旅客计划' });
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
