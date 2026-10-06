export async function onRequest(context: { request: Request; env: Record<string, string> }) {
  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
  });
}
