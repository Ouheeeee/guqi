const UPSTREAM = 'https://guqi-online.ouheeeee-guqi.workers.dev';

export async function onRequest({ request }) {
  const incoming = new URL(request.url);
  const target = new URL(incoming.pathname + incoming.search, UPSTREAM);
  try {
    return await fetch(new Request(target, request));
  } catch (error) {
    console.error('API proxy failed', error);
    return new Response(JSON.stringify({ error: '联机服务暂时不可用，请稍后重试' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }
}
