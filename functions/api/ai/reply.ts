type Env = {
  OPENAI_API_KEY?: string;
  OPENAI_BASE_URL?: string;
  OPENAI_MODEL?: string;
};

const systemPrompt =
  "你是一个亲和、耐心的英语学习教练。你只能使用中文和英语。中文用于解释和鼓励，英语用于例句、对话、正确表达和练习。不要输出其他语言。反馈要简洁、具体、温和。";

const getChatCompletionsUrl = (env: Env) => {
  const baseUrl = (env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
  return `${baseUrl}/chat/completions`;
};

export async function onRequestPost(context: { request: Request; env: Env }) {
  const { request, env } = context;
  const body = await request.json().catch(() => ({}));
  const apiKey = String(env.OPENAI_API_KEY ?? "").trim();
  const messages = Array.isArray((body as Record<string, unknown>).messages)
    ? ((body as Record<string, unknown>).messages as Array<Record<string, unknown>>)
    : [];
  const scenario = String((body as Record<string, unknown>).scenario ?? "");

  if (!apiKey) {
    return Response.json({ error: "Missing OpenAI API key secret" }, { status: 503 });
  }

  try {
    const response = await fetch(getChatCompletionsUrl(env), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: env.OPENAI_MODEL ?? "gpt-4.1-mini",
        messages: [
          { role: "system", content: `${systemPrompt} 当前口语场景：${scenario}` },
          ...messages.map((message) => ({
            role: message.role === "agent" ? "assistant" : "user",
            content: String(message.text ?? ""),
          })),
        ],
      }),
    });

    if (!response.ok) {
      return Response.json({ error: "AI gateway request failed" }, { status: 502 });
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return Response.json({
      reply: String(data.choices?.[0]?.message?.content ?? "Please say it in a complete English sentence."),
    });
  } catch {
    return Response.json({ error: "AI reply unavailable" }, { status: 502 });
  }
}
