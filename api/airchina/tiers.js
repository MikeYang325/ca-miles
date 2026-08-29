const OFFICIAL_URL = 'https://ffp.airchina.com.cn/apigateway/user/jsonp/mileageCumulateCalculation';
const GRADES = new Set(['Normal', 'Junior', 'Silver', 'Gold', 'Platinum', 'LifetimePlatinum']);

module.exports = async function handler(request, response) {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Headers', 'content-type');
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (request.method === 'OPTIONS') return response.status(204).end();
  if (request.method !== 'POST') return response.status(405).json({ success: false, message: '仅支持 POST 请求' });
  try {
    const input = typeof request.body === 'string' ? JSON.parse(request.body) : request.body || {};
    const payload = {
      org: String(input.origin || '').toUpperCase().replace(/\s+/g, ''),
      des: String(input.destination || '').toUpperCase().replace(/\s+/g, ''),
      flightDate: String(input.flightDate || ''),
      flightNo: String(input.flightNo || '').toUpperCase().replace(/\s+/g, ''),
      memberGrade: String(input.memberGrade || 'Normal'),
    };
    if (!/^[A-Z]{3}$/.test(payload.org) || !/^[A-Z]{3}$/.test(payload.des) || payload.org === payload.des) return response.status(400).json({ success: false, message: '机场三字码无效' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.flightDate)) return response.status(400).json({ success: false, message: '日期无效' });
    if (!/^(CA|ZH|NX|SC|KY)\d{1,4}[A-Z]?$/.test(payload.flightNo)) return response.status(400).json({ success: false, message: '航班号无效' });
    if (!GRADES.has(payload.memberGrade)) return response.status(400).json({ success: false, message: '会员卡等无效' });
    const upstream = await fetch(OFFICIAL_URL, {
      method: 'POST',
      headers: { Accept: '*/*', 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', Origin: 'https://ffp.airchina.com.cn', Referer: 'https://ffp.airchina.com.cn/plan/mileage_accumulate_calculator.html', 'X-Requested-With': 'XMLHttpRequest' },
      body: new URLSearchParams({ data: JSON.stringify(payload) }),
      signal: AbortSignal.timeout(15000),
    });
    if (!upstream.ok) throw new Error(`国航接口返回 ${upstream.status}`);
    const official = await upstream.json();
    if (!official.success || !Array.isArray(official.body)) return response.status(422).json({ success: false, message: official.message || '国航未返回累计数据' });
    const tiers = official.body.map(item => ({ subClassName: String(item.subClassName || ''), rate: String(item.gradingMilageRate || ''), availableMileage: Number(item.availableMileage) || 0, gradingMileage: Number(item.gradingMileage) || 0, gradingSegments: Number(item.gradingSeq) || 0 }));
    return response.status(200).json({ success: true, source: 'Air China PhoenixMiles', tiers });
  } catch (error) {
    const message = error?.name === 'TimeoutError' ? '国航官方接口查询超时，请稍后重试' : error.message || '国航官方接口暂时不可用';
    return response.status(502).json({ success: false, message });
  }
};
