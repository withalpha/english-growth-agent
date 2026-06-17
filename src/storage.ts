import { dailyThemes, starterReviewItems } from "./data";
import type { AppState, DailyReport, KnowledgeEntry, ReviewItem } from "./types";

const STORAGE_KEY = "english-growth-agent-state";

const now = () => new Date().toISOString();

const createId = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const todayKey = () => new Date().toISOString().slice(0, 10);

const getDefaultTheme = () => dailyThemes[Math.floor(new Date(todayKey()).getTime() / 86400000) % dailyThemes.length];

const inferVocabularyCompleted = (value: unknown) => {
  const progress = value as { index?: number; answered?: boolean; completed?: boolean } | undefined;
  if (typeof progress?.completed === "boolean") return progress.completed;
  return (progress?.index ?? 0) >= 19 && progress?.answered === true;
};

const inferSpeakingCompleted = (value: unknown) => {
  const progress = value as { messages?: { role?: string }[]; feedback?: string; completed?: boolean } | undefined;
  if (typeof progress?.completed === "boolean") return progress.completed;
  const userMessages = Array.isArray(progress?.messages)
    ? progress.messages.filter((message) => message?.role === "user").length
    : 0;
  return userMessages >= 5 && Boolean(progress?.feedback?.trim());
};

const inferWritingCompleted = (value: unknown) => {
  const progress = value as { index?: number; checked?: boolean; completed?: boolean } | undefined;
  if (typeof progress?.completed === "boolean") return progress.completed;
  return (progress?.index ?? 0) >= 4 && progress?.checked === true;
};

const withReviewMeta = (
  item: Omit<ReviewItem, "id" | "createdAt" | "updatedAt" | "nextReviewAt">,
): ReviewItem => ({
  ...item,
  id: createId(),
  createdAt: now(),
  updatedAt: now(),
  nextReviewAt: now(),
});

export const defaultState = (): AppState => ({
  diagnosis: {
    completed: false,
    vocabularyLevel: "未诊断",
    speakingLevel: "未诊断",
    writingLevel: "未诊断",
    summary: "完成首次诊断后，Agent 会生成你的英语能力画像。",
    plan: [],
  },
  reviewItems: starterReviewItems.map(withReviewMeta),
  knowledge: [],
  dailyReports: [],
  progress: {
    diagnosis: {
      vocabIndex: 0,
      vocabCorrect: 0,
      vocabSelected: "",
      vocabAnswered: false,
      vocabFeedback: "",
      speakingIndex: 0,
      speakingAnswer: "",
      speakingAnswers: [],
    },
    today: {
      date: todayKey(),
      themeId: getDefaultTheme().id,
      vocabulary: {
        index: 0,
        selected: "",
        feedback: "",
        answered: false,
        completed: false,
      },
      speaking: {
        messages: [{ role: "agent", text: getDefaultTheme().speaking.opener }],
        input: "",
        feedback: "",
        completed: false,
      },
      writing: {
        index: 0,
        answer: "",
        feedback: "",
        checked: false,
        completed: false,
      },
    },
  },
  streakDays: 0,
});

export const loadState = (): AppState => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const defaults = defaultState();
    const parsed = JSON.parse(raw);
    const parsedToday = parsed.progress?.today ?? {};
    const parsedVocabulary = parsedToday.vocabulary ?? {};
    const parsedSpeaking = parsedToday.speaking ?? {};
    const parsedWriting = parsedToday.writing ?? {};

    return {
      ...defaults,
      diagnosis: { ...defaults.diagnosis, ...parsed.diagnosis },
      reviewItems: Array.isArray(parsed.reviewItems) ? parsed.reviewItems : defaults.reviewItems,
      knowledge: Array.isArray(parsed.knowledge) ? parsed.knowledge : defaults.knowledge,
      dailyReports: Array.isArray(parsed.dailyReports) ? parsed.dailyReports : defaults.dailyReports,
      progress: {
        diagnosis: { ...defaults.progress.diagnosis, ...parsed.progress?.diagnosis },
        today: {
          ...defaults.progress.today,
          ...parsedToday,
          vocabulary: {
            ...defaults.progress.today.vocabulary,
            ...parsedVocabulary,
            completed: inferVocabularyCompleted(parsedVocabulary),
          },
          speaking: {
            ...defaults.progress.today.speaking,
            ...parsedSpeaking,
            completed: inferSpeakingCompleted(parsedSpeaking),
          },
          writing: {
            ...defaults.progress.today.writing,
            ...parsedWriting,
            completed: inferWritingCompleted(parsedWriting),
          },
        },
      },
      streakDays: Number(parsed.streakDays ?? defaults.streakDays),
      lastStudyDate: parsed.lastStudyDate,
    };
  } catch {
    return defaultState();
  }
};

export const saveState = (state: AppState) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
};

export const makeReviewItem = (
  item: Omit<ReviewItem, "id" | "createdAt" | "updatedAt" | "nextReviewAt" | "status" | "streak">,
): ReviewItem => ({
  ...item,
  id: createId(),
  status: "learning",
  streak: 0,
  createdAt: now(),
  updatedAt: now(),
  nextReviewAt: now(),
});

export const makeKnowledgeEntry = (
  entry: Omit<KnowledgeEntry, "id" | "createdAt">,
): KnowledgeEntry => ({
  ...entry,
  id: createId(),
  createdAt: now(),
});

export const makeDailyReport = (report: Omit<DailyReport, "id">): DailyReport => ({
  ...report,
  id: createId(),
});

export const getTodayKey = todayKey;
