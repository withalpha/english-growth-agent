type Env = {
  USER_STATE_KV: KVNamespace;
};

// GET /api/user/state — 读取当前用户的学习状态
export async function onRequestGet(context: { request: Request; env: Env }) {
  const { request, env } = context;
  const userEmail = request.headers.get("Cf-Access-Authenticated-User-Email");

  // 本地开发或未启用 Zero Trust 时，返回 null（前端会降级到 localStorage）
  if (!userEmail) {
    return Response.json(null);
  }

  try {
    const value = await env.USER_STATE_KV.get(userEmail, { type: "text" });
    if (!value) {
      return Response.json(null);
    }
    return new Response(value, {
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return Response.json(null, { status: 500 });
  }
}

// POST /api/user/state — 写入当前用户的学习状态
export async function onRequestPost(context: { request: Request; env: Env }) {
  const { request, env } = context;
  const userEmail = request.headers.get("Cf-Access-Authenticated-User-Email");

  if (!userEmail) {
    return Response.json({ ok: false, reason: "unauthenticated" }, { status: 401 });
  }

  try {
    const body = await request.text();
    // 验证是合法 JSON
    JSON.parse(body);
    // 存储时加 30 天 TTL 防止 KV 数据无限堆积，但用户每次学习都会续期
    await env.USER_STATE_KV.put(userEmail, body, {
      expirationTtl: 60 * 60 * 24 * 30, // 30 天
    });
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false, reason: "invalid_json_or_kv_error" }, { status: 400 });
  }
}
