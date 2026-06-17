type Env = {
  OPENAI_API_KEY?: string;
  OPENAI_BASE_URL?: string;
  OPENAI_MODEL?: string;
};

const getChatCompletionsUrl = (env: Env) => {
  const baseUrl = (env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
  return `${baseUrl}/chat/completions`;
};

/**
 * POST /api/ai/generate-theme
 * 根据已完成的主题和已学词汇，让 AI 生成一个全新的每日学习主题。
 * Body: { completedTitles: string[], usedWords: string[] }
 */
export async function onRequestPost(context: { request: Request; env: Env }) {
  const { request, env } = context;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const apiKey = String(env.OPENAI_API_KEY ?? "").trim();

  if (!apiKey) {
    return Response.json({ error: "Missing API key" }, { status: 503 });
  }

  const completedTitles = Array.isArray(body.completedTitles)
    ? (body.completedTitles as string[]).join("、")
    : "";

  // 只取前80个词避免 prompt 过长
  const usedWords = Array.isArray(body.usedWords)
    ? (body.usedWords as string[]).slice(0, 80).join(", ")
    : "";

  const prompt = `请为中国成人英语学习者（A1-A2水平）生成一个全新的每日英语学习主题。

要求：
1. 主题必须与以下已学主题完全不同，选择一个全新的生活场景：${completedTitles || "无"}
2. 词汇单词不能重复以下已学单词：${usedWords || "无"}
3. 所有内容要实用、贴近日常生活、句子简单自然

请严格按照以下 JSON 格式返回，不要有任何额外文字：
{
  "id": "英文短横线ID，如 food-culture 或 gym-fitness",
  "title": "主题标题，格式：XX场景：XX内容（中文）",
  "domain": "领域标签，2-4个汉字",
  "description": "一句话说明学什么，不超过20字（中文）",
  "vocabulary": [
    {"word": "英文单词", "meaning": "中文意思", "example": "完整英文例句，简单自然。", "prompt": "例句对应中文翻译。"}
  ],
  "speaking": {
    "title": "口语话题名称（中文）",
    "opener": "AI用英文开场，引导用户开口说话的一句问题",
    "goal": "口语练习目标（中文，20字以内）"
  },
  "writingLesson": {
    "grammar": "语法要点名称（中文）",
    "tip": "简明使用说明（中文，30字以内）",
    "examples": ["英文例句1。", "英文例句2。"],
    "prompts": [
      {"zh": "中文练习题", "answer": "对应英文标准答案。"}
    ]
  }
}

强制要求：
- vocabulary 必须恰好包含 20 个单词
- writingLesson.prompts 必须恰好包含 5 道练习题
- writingLesson.examples 必须恰好包含 2 个例句
- 英文内容要简单，避免复杂词汇和长句`;

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
          {
            role: "system",
            content:
              "你是专业的英语学习内容设计师。请严格按照 JSON 格式输出，不要添加任何说明性文字。确保词汇数量和练习题数量完全符合要求。",
          },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0.85,
      }),
    });

    if (!response.ok) {
      return Response.json({ error: "AI request failed" }, { status: 502 });
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = data.choices?.[0]?.message?.content ?? "{}";

    let theme: Record<string, unknown>;
    try {
      theme = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return Response.json({ error: "AI returned invalid JSON" }, { status: 422 });
    }

    // 基本结构校验
    if (
      !theme.id ||
      !theme.vocabulary ||
      !theme.speaking ||
      !theme.writingLesson ||
      !Array.isArray(theme.vocabulary) ||
      (theme.vocabulary as unknown[]).length < 15
    ) {
      return Response.json({ error: "Incomplete theme structure" }, { status: 422 });
    }

    return Response.json(theme);
  } catch {
    return Response.json({ error: "Theme generation failed" }, { status: 502 });
  }
}
