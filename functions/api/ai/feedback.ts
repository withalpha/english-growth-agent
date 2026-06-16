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
  const area = String((body as any).area ?? "vocabulary");
  const userInput = String((body as any).userInput ?? "");
  const contextText = String((body as any).context ?? "");

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
              `练习类型：${area}\n上下文：${contextText}\n用户回答：${userInput}\n` +
              "请返回 JSON：score, summary, corrections, reviewItems。reviewItems 每项包含 area,title,prompt,answer,note,errorCount,confidence。",
          },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      return Response.json({ error: "AI gateway request failed" }, { status: 502 });
    }

    const data: any = await response.json();
    return Response.json(parseJsonContent(data.choices?.[0]?.message?.content));
  } catch {
    return Response.json({ error: "AI feedback unavailable" }, { status: 502 });
  }
}
