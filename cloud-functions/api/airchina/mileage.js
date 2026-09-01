const OFFICIAL_URL = 'https://ffp.airchina.com.cn/apigateway/user/jsonp/mileageCumulateCalculation';
const GRADES = new Set(['Normal', 'Junior', 'Silver', 'Gold', 'Platinum', 'LifetimePlatinum']);
const A3_CA = { rules: [
  { subClassName: 'F/A/P', rate: '200%', factor: 2, minimumMiles: 1200 },
  { subClassName: 'J', rate: '200%', factor: 2, minimumMiles: 1000 },
  { subClassName: 'C/D', rate: '150%', factor: 1.5, minimumMiles: 1000 },
  { subClassName: 'Z/R', rate: '125%', factor: 1.25, minimumMiles: 1000 },
  { subClassName: 'G', rate: '100%', factor: 1, minimumMiles: 500 },
  { subClassName: 'E', rate: '90%', factor: 0.9, minimumMiles: 500 },
  { subClassName: 'Y/B', rate: '100%', factor: 1, minimumMiles: 500 },
  { subClassName: 'M/U/H/Q/V', rate: '75%', factor: 0.75, minimumMiles: 500 },
  { subClassName: 'W/S/T', rate: '50%', factor: 0.5, minimumMiles: 500 },
  { subClassName: 'L/K', rate: '25%', factor: 0.25, minimumMiles: 500 },
] };

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

function cleanSegment(segment = {}) {
  return {
    flightDate: String(segment.flightDate || ''),
    flightNo: String(segment.flightNo || '').toUpperCase().replace(/\s+/g, ''),
    origin: String(segment.origin || '').toUpperCase().replace(/\s+/g, ''),
    destination: String(segment.destination || '').toUpperCase().replace(/\s+/g, ''),
    cabin: String(segment.cabin || '').toUpperCase().replace(/\s+/g, ''),
  };
}

function validateSegment(segment, index) {
  const prefix = `第 ${index + 1} 段`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(segment.flightDate)) return `${prefix}日期无效`;
  if (!/^[A-Z0-9]{2}\d{1,4}[A-Z]?$/.test(segment.flightNo)) return `${prefix}航班号无效`;
  if (!/^[A-Z]{3}$/.test(segment.origin) || !/^[A-Z]{3}$/.test(segment.destination)) return `${prefix}机场三字码无效`;
  if (segment.origin === segment.destination) return `${prefix}起点与终点不能相同`;
  if (!/^[A-Z]$/.test(segment.cabin)) return `${prefix}舱位代码无效`;
  return '';
}

async function fetchOfficialTiers(segment, memberGrade, index, flightNo = segment.flightNo) {
  const payload = {
    org: segment.origin,
    des: segment.destination,
    flightDate: segment.flightDate,
    flightNo,
    memberGrade,
  };
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
  if (!upstream.ok) throw new Error(`第 ${index + 1} 段：国航接口返回 ${upstream.status}`);
  const official = await upstream.json();
  if (!official.success || !Array.isArray(official.body)) throw new Error(`第 ${index + 1} 段：${official.message || '国航未返回累计数据'}`);
  const tiers = official.body.map(item => ({
    subClassName: String(item.subClassName || ''),
    rate: String(item.gradingMilageRate || ''),
    availableMileage: Number(item.availableMileage) || 0,
    gradingMileage: Number(item.gradingMileage) || 0,
    gradingSegments: Number(item.gradingSeq) || 0,
  }));
  return tiers;
}

async function queryOfficial(segment, memberGrade, index) {
  const tiers = await fetchOfficialTiers(segment, memberGrade, index);
  const row = tiers.find(item => item.subClassName.split('/').includes(segment.cabin));
  if (!row) {
    const error = new Error(`第 ${index + 1} 段：国航未返回 ${segment.cabin} 舱累计规则`);
    error.statusCode = 422;
    throw error;
  }
  return {
    ...segment,
    cabinGroup: row.subClassName,
    rate: row.rate,
    availableMileage: row.availableMileage,
    gradingMileage: row.gradingMileage,
    gradingSegments: row.gradingSegments,
    tiers,
    genericRule: /^[A-Z]{2}0$/.test(segment.flightNo),
  };
}

async function queryA3(segment, index) {
  if (segment.flightNo.slice(0, 2) !== 'CA') {
    const error = new Error(`第 ${index + 1} 段：A3 当前先支持累计国航 CA`);
    error.statusCode = 422;
    throw error;
  }
  const rule = A3_CA.rules.find(item => item.subClassName.split('/').includes(segment.cabin));
  if (!rule) {
    const error = new Error(`第 ${index + 1} 段：A3 不累计 ${segment.cabin} 舱`);
    error.statusCode = 422;
    throw error;
  }
  const tiers = await fetchOfficialTiers(segment, 'Normal', index, 'CA0');
  const reference = tiers.find(item => item.subClassName.split('/').includes('F') && item.subClassName.split('/').includes('J')) || tiers[0];
  // ponytail: derive route distance from CA0's official baseline; use airport coordinates if that endpoint changes.
  const distance = Math.round(Number(reference?.availableMileage || 0) / Number(reference?.gradingSegments || 0));
  if (!distance) throw new Error(`第 ${index + 1} 段：无法取得国航航段距离`);
  return { ...segment, targetProgram: 'A3', cabinGroup: rule.subClassName, rate: rule.rate, availableMileage: Math.max(Math.round(distance * rule.factor), rule.minimumMiles), gradingMileage: 0, gradingSegments: 0, distanceMiles: distance, tiers: A3_CA.rules.map(item => ({ ...item, availableMileage: 0, gradingMileage: 0, gradingSegments: 0 })), genericRule: false };
}

export default async function onRequest({ request }) {
  if (request.method === 'OPTIONS') return reply(204);
  if (request.method !== 'POST') return reply(405, { success: false, message: '仅支持 POST 请求' });
  try {
    const input = await request.json();
    const targetProgram = String(input?.targetProgram || 'CA').toUpperCase();
    const memberGrade = String(input?.memberGrade || 'Normal');
    const segments = Array.isArray(input?.segments) ? input.segments.map(cleanSegment) : [];
    if (!['CA', 'A3'].includes(targetProgram)) return reply(400, { success: false, message: '暂不支持该常旅客计划' });
    if (!GRADES.has(memberGrade)) return reply(400, { success: false, message: '会员卡等无效' });
    if (!segments.length || segments.length > 20) return reply(400, { success: false, message: '请输入 1–20 个航段' });
    for (let index = 0; index < segments.length; index += 1) {
      const message = validateSegment(segments[index], index);
      if (message) return reply(400, { success: false, message });
    }
    const calculated = [];
    for (let index = 0; index < segments.length; index += 1) calculated.push(targetProgram === 'A3' ? await queryA3(segments[index], index) : await queryOfficial(segments[index], memberGrade, index));
    const totals = calculated.reduce((sum, item) => ({
      availableMileage: sum.availableMileage + item.availableMileage,
      gradingMileage: sum.gradingMileage + item.gradingMileage,
      gradingSegments: sum.gradingSegments + item.gradingSegments,
    }), { availableMileage: 0, gradingMileage: 0, gradingSegments: 0 });
    return reply(200, { success: true, source: targetProgram === 'A3' ? 'Aegean Miles+Bonus' : 'Air China PhoenixMiles', targetProgram, memberGrade, segments: calculated, totals });
  } catch (error) {
    const message = error?.name === 'TimeoutError' ? '国航官方接口查询超时，请稍后重试' : error.message || '国航官方接口暂时不可用';
    return reply(error?.statusCode || 502, { success: false, message });
  }
}
