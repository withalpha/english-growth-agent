export async function onRequestPost(context: any) {
  const { request, env } = context;
  const body = await request.json();
  const apiKey = String(body.apiKey ?? env.OPENAI_API_KEY ?? "").trim();
  const area = String(body.area ?? "vocabulary");
  const userInput = String(body.userInput ?? "");
  const contextText = String(body.context ?? "");

  if (!apiKey) {
    return Response.json({ error: "Missing OpenAI API key" }, { status: 400 });
  }

  const systemPrompt =
    "你是一个亲和、耐心的英语学习教练。你只能使用中文和英语。中文用于解释和鼓励，英语用于例句、对话、正确表达和练习。不要输出其他语言。反馈要简洁、具体、温和。";

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
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

  const data = await response.json();
  return Response.json(JSON.parse(data.choices?.[0]?.message?.content ?? "{}"));
}
