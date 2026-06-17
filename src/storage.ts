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

/**
 * 如果存储的进度是上一天（或更早）且上一次已全部完成，则重置今日进度，开始新一天。
 * 如果上一次未完成，则保留进度（允许用户跨天继续）。
 */
const applyDayResetIfNeeded = (state: AppState): AppState => {
  const today = todayKey();
  const progressDate = state.progress.today.date;
  const vocCompleted = state.progress.today.vocabulary.completed;
  const speakCompleted = state.progress.today.speaking.completed;
  const writeCompleted = state.progress.today.writing.completed;

  if (progressDate !== today && vocCompleted && speakCompleted && writeCompleted) {
    // 新的一天且昨天已完成 → 重置今日进度
    const theme = getDefaultTheme();
    return {
      ...state,
      progress: {
        ...state.progress,
        today: {
          date: today,
          themeId: theme.id,
          vocabulary: { index: 0, selected: "", feedback: "", answered: false, completed: false },
          speaking: {
            messages: [{ role: "agent" as const, text: theme.speaking.opener }],
            input: "",
            feedback: "",
            completed: false,
          },
          writing: { index: 0, answer: "", feedback: "", checked: false, completed: false },
        },
      },
    };
  }
  return state;
};

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

    const loaded: AppState = {
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
    // 在读取时就应用新的一天重置，避免 React 层面的竞态条件
    return applyDayResetIfNeeded(loaded);
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

// ── 云端存储（Cloudflare KV，按用户隔离）──

/** 防抖计时器，避免频繁写入 */
let _cloudSaveTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * 实时同步状态到云端（带 1.5 秒防抖）。
 * 本地开发或用户未登录时静默失败，不影响使用。
 */
export const saveStateToCloud = (state: AppState): void => {
  if (_cloudSaveTimer) clearTimeout(_cloudSaveTimer);
  _cloudSaveTimer = setTimeout(async () => {
    try {
      await fetch("/api/user/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(state),
      });
    } catch {
      // 云端不可达时静默失败，localStorage 是备份
    }
  }, 1500);
};

/**
 * 从云端加载用户状态。
 * 返回 null 表示云端无数据或未认证，调用方应降级到 localStorage。
 */
export const loadStateFromCloud = async (): Promise<AppState | null> => {
  try {
    const response = await fetch("/api/user/state");
    if (!response.ok) return null;
    const data: unknown = await response.json();
    if (!data || typeof data !== "object") return null;
    // 用 loadState 相同的 merge 逻辑来规范化云端数据
    const raw = data as Record<string, unknown>;
    const defaults = defaultState();
    const parsedToday = (raw.progress as Record<string, unknown>)?.today ?? {};
    const parsedVocabulary = (parsedToday as Record<string, unknown>).vocabulary ?? {};
    const parsedSpeaking = (parsedToday as Record<string, unknown>).speaking ?? {};
    const parsedWriting = (parsedToday as Record<string, unknown>).writing ?? {};
    const cloudLoaded = {
      ...defaults,
      ...raw,
      diagnosis: { ...defaults.diagnosis, ...(raw.diagnosis as object) },
      reviewItems: Array.isArray(raw.reviewItems) ? (raw.reviewItems as ReviewItem[]) : defaults.reviewItems,
      knowledge: Array.isArray(raw.knowledge) ? (raw.knowledge as KnowledgeEntry[]) : defaults.knowledge,
      dailyReports: Array.isArray(raw.dailyReports) ? (raw.dailyReports as DailyReport[]) : defaults.dailyReports,
      progress: {
        diagnosis: { ...defaults.progress.diagnosis, ...((raw.progress as Record<string, unknown>)?.diagnosis as object) },
        today: {
          ...defaults.progress.today,
          ...(parsedToday as object),
          vocabulary: {
            ...defaults.progress.today.vocabulary,
            ...(parsedVocabulary as object),
            completed: inferVocabularyCompleted(parsedVocabulary),
          },
          speaking: {
            ...defaults.progress.today.speaking,
            ...(parsedSpeaking as object),
            completed: inferSpeakingCompleted(parsedSpeaking),
          },
          writing: {
            ...defaults.progress.today.writing,
            ...(parsedWriting as object),
            completed: inferWritingCompleted(parsedWriting),
          },
        },
      },
      streakDays: Number((raw.streakDays as number | undefined) ?? defaults.streakDays),
      lastStudyDate: raw.lastStudyDate as string | undefined,
    } as AppState;
    return applyDayResetIfNeeded(cloudLoaded);
  } catch {
    return null;
  }
};

/**
 * 获取当前登录用户信息。
 * 未登录或本地开发时返回 { email: null, name: null, authenticated: false }。
 */
export const getCurrentUser = async (): Promise<{
  email: string | null;
  name: string | null;
  authenticated: boolean;
}> => {
  try {
    const response = await fetch("/api/user/me");
    if (!response.ok) return { email: null, name: null, authenticated: false };
    const data = await response.json() as { email: string | null; name: string | null; authenticated: boolean };
    return data;
  } catch {
    return { email: null, name: null, authenticated: false };
  }
};
