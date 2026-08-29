export async function runLegacy(legacyHandler, request) {
  let result;
  const headers = new Headers();
  let statusCode = 200;
  let body;

  const response = {
    setHeader(name, value) {
      headers.set(name, String(value));
      return this;
    },
    status(code) {
      statusCode = code;
      return this;
    },
    json(value) {
      headers.set('Content-Type', 'application/json; charset=utf-8');
      body = JSON.stringify(value);
      result = new Response(body, { status: statusCode, headers });
      return result;
    },
    end(value = null) {
      result = new Response(value, { status: statusCode, headers });
      return result;
    },
  };

  let parsedBody;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const text = await request.text();
    if (text) {
      try { parsedBody = JSON.parse(text); }
      catch { parsedBody = text; }
    }
  }

  const legacyRequest = {
    method: request.method,
    headers: Object.fromEntries(request.headers.entries()),
    body: parsedBody,
    url: request.url,
  };

  const returned = await legacyHandler(legacyRequest, response);
  return returned instanceof Response ? returned : result || new Response(null, { status: statusCode, headers });
}
