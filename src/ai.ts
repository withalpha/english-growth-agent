import type { AiFeedback, AppState, ChatMessage, DailyReport, SkillArea } from "./types";

const fallbackByArea: Record<SkillArea, AiFeedback> = {
  vocabulary: {
    score: 78,
    summary: "你已经能理解核心意思，下一步要把单词放进自己的句子里反复使用。",
    corrections: ["把新词放进完整句子，不要只背中文意思。", "遇到不熟悉的词，先用简单英文解释它。"],
    reviewItems: [
      {
        area: "vocabulary",
        title: "用新词造句",
        prompt: "用 today 学到的一个单词写一句日常英文。",
        answer: "I am available this afternoon.",
        note: "词汇掌握的关键是能在真实场景中说出来。",
        errorCount: 1,
        confidence: 2,
      },
    ],
  },
  speaking: {
    score: 74,
    summary: "你的表达能被理解，但句子可以更完整、更自然。练习时尽量回答原因或补充一个细节。",
    corrections: ["不要只回答 yes/no。", "可以用 I usually..., I prefer..., because... 让表达更自然。"],
    reviewItems: [
      {
        area: "speaking",
        title: "补充原因",
        prompt: "回答 Do you like coffee? 时，请补充一个原因。",
        answer: "Yes, I like coffee because it helps me feel awake.",
        note: "口语流畅度来自短句 + 原因 + 细节。",
        errorCount: 1,
        confidence: 2,
      },
    ],
  },
  writing: {
    score: 72,
    summary: "你能写出基本意思，接下来重点关注动词形式、冠词和介词。",
    corrections: ["want 后面接 to + 动词原形。", "说每天的习惯时，用一般现在时。"],
    reviewItems: [
      {
        area: "writing",
        title: "want to 用法",
        prompt: "翻译：我想每天练习英语。",
        answer: "I want to practice English every day.",
        note: "want to practice 是固定高频结构。",
        errorCount: 1,
        confidence: 2,
      },
    ],
  },
};

export async function requestAiFeedback(area: SkillArea, userInput: string, context: string): Promise<AiFeedback> {
  try {
    const response = await fetch("/api/ai/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ area, userInput, context }),
    });

    if (response.ok) {
      const data = await response.json();
      return {
        score: Number(data.score ?? fallbackByArea[area].score),
        summary: String(data.summary ?? fallbackByArea[area].summary),
        corrections: Array.isArray(data.corrections) ? data.corrections.map(String) : fallbackByArea[area].corrections,
        reviewItems: Array.isArray(data.reviewItems) ? data.reviewItems : fallbackByArea[area].reviewItems,
      };
    }
  } catch {
    // Cloud AI is optional. Local fallback keeps practice usable.
  }

  return fallbackByArea[area];
}

export async function requestAiReply(messages: ChatMessage[], scenario: string) {
  try {
    const response = await fetch("/api/ai/reply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, scenario }),
    });

    if (response.ok) {
      const data = await response.json();
      return String(data.reply ?? "Please say it in a complete English sentence.");
    }
  } catch {
    // Cloud AI is optional. Local fallback keeps practice usable.
  }

  const userMessages = messages.filter((message) => message.role === "user");
  const lastUser = userMessages.length ? userMessages[userMessages.length - 1].text : "";

  if (!lastUser.trim()) return "我们先从简单句开始。Please answer in one or two English sentences.";
  return "很好，我明白你的意思。Can you add one reason? For example: because it is relaxing.";
}

export async function generateDailyReport(state: AppState): Promise<Omit<DailyReport, "id">> {
  const today = new Date().toISOString().slice(0, 10);
  const learningItems = state.reviewItems.filter((item) => item.status !== "mastered");
  const masteredItems = state.reviewItems.filter((item) => item.status === "mastered");
  const weakAreas = [...learningItems]
    .sort((a, b) => b.errorCount + (5 - b.confidence) - (a.errorCount + (5 - a.confidence)))
    .slice(0, 3);

  const fallback: Omit<DailyReport, "id"> = {
    date: today,
    summary: `今天你完成了词汇、口语、写作和集中复习。当前仍有 ${learningItems.length} 个内容需要继续巩固，已经掌握 ${masteredItems.length} 个复习项。`,
    strengths: masteredItems.length
      ? masteredItems.slice(0, 3).map((item) => `你对“${item.title}”的掌握更稳定了。`)
      : ["你能坚持完成每日练习，这是提升英语最重要的基础。"],
    weaknesses: weakAreas.length
      ? weakAreas.map((item) => `“${item.title}”还需要复习：${item.note}`)
      : ["目前没有明显高频薄弱项，下一步可以增加表达自然度训练。"],
    encouragement: "今天的小步练习很有价值。Keep going, small steps make real progress.",
    nextPlan: [
      "明天继续完成 20 个词汇的使用练习。",
      "口语继续练 5 句话，重点说完整句和原因。",
      "写作继续做 5 句中文翻译成英文，并复习今天的错句。",
    ],
  };

  try {
    const response = await fetch("/api/ai/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state }),
    });

    if (response.ok) {
      const data = await response.json();
      return {
        date: today,
        summary: String(data.summary ?? fallback.summary),
        strengths: Array.isArray(data.strengths) ? data.strengths.map(String) : fallback.strengths,
        weaknesses: Array.isArray(data.weaknesses) ? data.weaknesses.map(String) : fallback.weaknesses,
        encouragement: String(data.encouragement ?? fallback.encouragement),
        nextPlan: Array.isArray(data.nextPlan) ? data.nextPlan.map(String) : fallback.nextPlan,
      };
    }
  } catch {
    // Cloud AI is optional. Local fallback keeps reports usable.
  }

  return fallback;
}
