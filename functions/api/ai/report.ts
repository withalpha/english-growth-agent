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

const parseJsonContent = (content: string) => {
  try {
    return JSON.parse(content || "{}");
  } catch {
    return {};
  }
};

export async function onRequestPost(context: { request: Request; env: Env }) {
  const { request, env } = context;
  const body = await request.json().catch(() => ({}));
  const apiKey = String(env.OPENAI_API_KEY ?? "").trim();
  const state = (body as Record<string, unknown>).state ?? {};

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
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content:
              "请根据用户今天的英语学习数据生成一份中文为主、英文例句为辅的学习报告，只使用中文和英语。返回 JSON：summary, strengths, weaknesses, encouragement, nextPlan。\n" +
              JSON.stringify({
                diagnosis: (state as Record<string, unknown>).diagnosis,
                reviewItems: ((state as Record<string, unknown>).reviewItems as unknown[] | undefined)?.slice?.(0, 20) ?? [],
                knowledge: ((state as Record<string, unknown>).knowledge as unknown[] | undefined)?.slice?.(0, 20) ?? [],
              }),
          },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      return Response.json({ error: "AI gateway request failed" }, { status: 502 });
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return Response.json(parseJsonContent(data.choices?.[0]?.message?.content ?? ""));
  } catch {
    return Response.json({ error: "AI report unavailable" }, { status: 502 });
  }
}
