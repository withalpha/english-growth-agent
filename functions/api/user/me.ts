type Env = Record<string, never>;

// GET /api/user/me — 返回当前登录用户的信息
export async function onRequestGet(context: { request: Request; env: Env }) {
  const { request } = context;
  const userEmail = request.headers.get("Cf-Access-Authenticated-User-Email") ?? null;
  const userName = userEmail ? userEmail.split("@")[0] : null;

  return Response.json({
    email: userEmail,
    name: userName,
    authenticated: Boolean(userEmail),
  });
}
