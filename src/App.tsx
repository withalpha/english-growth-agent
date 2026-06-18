import { useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  Library,
  LogOut,
  Mic,
  RotateCcw,
  Send,
  Sparkles,
  Target,
  Volume2,
} from "lucide-react";
import { areaLabels, dailyThemes, vocabularyCards } from "./data";
import { generateDailyReport, requestAiFeedback, requestAiReply, requestGenerateTheme, requestTts } from "./ai";
import { clearLocalState, defaultState, getCurrentUser, getStoredUserEmail, getTodayKey, loadState, loadStateFromCloud, makeDailyReport, makeKnowledgeEntry, makeReviewItem, markStateOwner, saveState, saveStateToCloud } from "./storage";
import type { AppState, ChatMessage, DailyTheme, ReviewItem, SkillArea } from "./types";

type Tab = "today" | "diagnosis" | "review" | "knowledge" | "reports";
// DailyTheme 接口已从 types.ts 导入
type PathStatus = "completed" | "current" | "locked";

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const normalize = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const hasOnlyChineseEnglish = (text: string) =>
  /^[\u4e00-\u9fa5a-zA-Z0-9\s.,!?'"():;\-\/]*$/.test(text);

// 用主题ID作为种子确定性地选择3道"拼词"题（剩余2道为"写作"题）
const seededShuffle = (arr: number[], seed: number): number[] => {
  const result = [...arr];
  let s = Math.abs(seed);
  for (let i = result.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const j = s % (i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
};

const getArrangeIndices = (themeId: string): Set<number> => {
  const seed = themeId.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return new Set(seededShuffle([0, 1, 2, 3, 4], seed).slice(0, 3));
};

const shuffleArray = <T,>(arr: T[]): T[] => {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
};

const DAILY_VOCABULARY_TARGET = 20;
const DAILY_SPEAKING_TARGET = 5;
const DAILY_WRITING_TARGET = 5;

const todayPlan = [
  { title: "词汇互动", target: "20 个单词", description: "学习单词含义、例句和真实使用方法" },
  { title: "口语陪练", target: "5 句话", description: "围绕今日主题做简短对话，并拿到即时评价" },
  { title: "写作练习", target: "5 句话", description: "根据中文写英文，巩固语法和自然表达" },
  { title: "集中复习总结", target: "复习薄弱项", description: "复盘错词、错句和高频问题，继续滚动巩固" },
];

/** 选取最接近 BBC RP 的英式语音（en-GB） */
const getUkVoice = (): SpeechSynthesisVoice | null => {
  if (!window.speechSynthesis) return null;
  const voices = window.speechSynthesis.getVoices();
  return (
    voices.find((v) => v.lang === "en-GB" && v.name.toLowerCase().includes("google")) ??
    voices.find((v) => v.lang === "en-GB" && !v.name.toLowerCase().includes("india")) ??
    voices.find((v) => v.lang === "en-GB") ??
    null
  );
};

/**
 * 用英式发音朗读文本。
 * 优先调用 TTS API（fable 声线，BBC RP），失败后降级到浏览器 en-GB 语音。
 * 适用于 AI 对话气泡、复习卡片、知识库等场景。
 */
const speakBritish = async (text: string): Promise<void> => {
  const audio = await requestTts(text);
  if (audio) {
    audio.play().catch(() => {});
    return;
  }
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utt = new SpeechSynthesisUtterance(text);
  utt.lang = "en-GB";
  utt.rate = 0.9;
  const ukVoice = getUkVoice();
  if (ukVoice) utt.voice = ukVoice;
  window.speechSynthesis.speak(utt);
};


/**
 * 智能混合语言朗读：中文段用普通话（zh-CN），英文段用 TTS fable + en-GB。
 * 适用于 AI 诊断反馈、集中复习口语、知识库 AI 对话等混合中英文场景。
 */
const speakMixed = async (text: string): Promise<void> => {
  if (!text.trim()) return;
  if (window.speechSynthesis) window.speechSynthesis.cancel();

  // 按中文/英文边界分段
  const rawParts =
    text.match(
      /[\u4e00-\u9fff\u3400-\u4dbf\uff00-\uffef\u3000-\u303f，。！？、：；""''（）【】…—·]+|[^\u4e00-\u9fff\u3400-\u4dbf\uff00-\uffef\u3000-\u303f，。！？、：；""''（）【】…—·]+/g,
    ) ?? [text];

  // 合并相邻同语言段，减少切换次数
  const segments: Array<{ lang: "zh" | "en"; text: string }> = [];
  for (const part of rawParts) {
    const t = part.trim();
    if (!t) continue;
    const lang = /[\u4e00-\u9fff]/.test(t) ? "zh" : "en";
    if (segments.length > 0 && segments[segments.length - 1].lang === lang) {
      segments[segments.length - 1].text += " " + t;
    } else {
      segments.push({ lang, text: t });
    }
  }

  for (const seg of segments) {
    if (seg.lang === "zh") {
      // 中文段：Web Speech API，zh-CN 普通话
      await new Promise<void>((resolve) => {
        if (!window.speechSynthesis) { resolve(); return; }
        const utt = new SpeechSynthesisUtterance(seg.text);
        utt.lang = "zh-CN";
        utt.rate = 0.9;
        const voices = window.speechSynthesis.getVoices();
        const zhVoice =
          voices.find((v) => v.lang === "zh-CN" && v.name.toLowerCase().includes("google")) ??
          voices.find((v) => v.lang === "zh-CN") ??
          null;
        if (zhVoice) utt.voice = zhVoice;
        utt.onend = () => resolve();
        utt.onerror = () => resolve();
        window.speechSynthesis.speak(utt);
      });
    } else {
      // 英文段：TTS API（fable/BBC RP），失败降级 en-GB
      const audio = await requestTts(seg.text);
      if (audio) {
        await new Promise<void>((resolve) => {
          audio.onended = () => resolve();
          audio.onerror = () => resolve();
          audio.play().catch(() => resolve());
        });
      } else if (window.speechSynthesis) {
        await new Promise<void>((resolve) => {
          const utt = new SpeechSynthesisUtterance(seg.text);
          utt.lang = "en-GB";
          utt.rate = 0.9;
          const ukVoice = getUkVoice();
          if (ukVoice) utt.voice = ukVoice;
          utt.onend = () => resolve();
          utt.onerror = () => resolve();
          window.speechSynthesis.speak(utt);
        });
      }
    }
  }
};

/** 从名称或邮箱提取最多2个字母的缩写作为头像文字 */
const getInitials = (nameOrEmail: string): string => {
  const base = nameOrEmail.split("@")[0];
  const parts = base.split(/[.\-_\s]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return base.slice(0, 2).toUpperCase();
};

/** 根据邮箱字符串哈希生成一致的头像背景色 */
const getAvatarColor = (email: string): string => {
  const palette = [
    "#2f8a43", "#1a6e8a", "#7a3f9e", "#8a5a1a",
    "#1a7a6e", "#8a1a4a", "#3f7a1a", "#1a4a8a",
  ];
  let h = 0;
  for (let i = 0; i < email.length; i++) h = email.charCodeAt(i) + ((h << 5) - h);
  return palette[Math.abs(h) % palette.length];
};

const getDayIndex = () => Math.floor(new Date(getTodayKey()).getTime() / 86400000);

const getTodayTheme = () => dailyThemes[getDayIndex() % dailyThemes.length];

/**
 * 根据用户已完成的主题历史，选择今日主题。
 * 优先使用 nextThemeId（完成前一天时预选的），
 * 否则选一个用户还没完成过的主题（预定义 + AI 生成），
 * 如果全部完成过则触发 AI 生成新主题（由 completeStudy 处理）。
 */
const getThemeForToday = (state: AppState): DailyTheme => {
  const allThemes: DailyTheme[] = [...dailyThemes, ...(state.generatedThemes ?? [])];
  // 优先使用预选的下一主题
  if (state.nextThemeId) {
    const preset = allThemes.find((t) => t.id === state.nextThemeId);
    if (preset) return preset;
  }
  // 找一个还没做过的主题
  const done = new Set(state.completedThemeIds ?? []);
  const fresh = allThemes.find((t) => !done.has(t.id));
  if (fresh) return fresh;
  // 全部完成过了 → 先用第一个预定义主题兜底（completeStudy 会异步生成新主题）
  return dailyThemes[0];
};

/**
 * 从所有可用主题（预定义 + AI 生成）中选出下一个未完成的主题 ID。
 * 若全部用完则返回 null（表示需要 AI 生成新主题）。
 */
const pickNextThemeId = (
  currentThemeId: string,
  completedThemeIds: string[],
  generatedThemes: DailyTheme[],
): string | null => {
  const allThemes: DailyTheme[] = [...dailyThemes, ...generatedThemes];
  const done = new Set([...completedThemeIds, currentThemeId]);
  const next = allThemes.find((t) => !done.has(t.id));
  return next?.id ?? null; // null 表示需要 AI 生成新主题
};

const resetTodayProgressForTheme = (theme: DailyTheme) => ({
  date: getTodayKey(),
  themeId: theme.id,
  vocabulary: { index: 0, selected: "", feedback: "", answered: false, completed: false },
  speaking: { messages: [{ role: "agent" as const, text: theme.speaking.opener }], input: "", feedback: "", completed: false },
  writing: { index: 0, answer: "", feedback: "", checked: false, completed: false },
});

const diagnosisSpeakingPrompts = [
  "Please introduce yourself in one sentence.",
  "What do you usually do after work? Answer in one sentence.",
  "Why do you want to learn English? Answer in one sentence.",
];

export function App() {
  const [state, setState] = useState<AppState>(() => loadState());
  const [activeTab, setActiveTab] = useState<Tab>("today");
  const [currentUser, setCurrentUser] = useState<{
    email: string | null;
    name: string | null;
    authenticated: boolean;
  }>({ email: null, name: null, authenticated: false });

  // 启动时：加载用户信息 + 从云端同步最新状态（云端为权威数据源）
  // 同时检测是否切换了账号，若切换则清空本地旧账号数据，防止数据污染
  useEffect(() => {
    let cancelled = false;
    Promise.all([getCurrentUser(), loadStateFromCloud()]).then(([user, cloudState]) => {
      if (cancelled) return;
      setCurrentUser(user);

      if (user.authenticated && user.email) {
        const storedEmail = getStoredUserEmail();
        const isSameUser = storedEmail === user.email;

        if (!isSameUser) {
          // 不同账号登录了同一浏览器 → 清空本地旧数据，防止数据污染
          clearLocalState();
        }

        // 将当前用户邮箱写入 localStorage，供下次加载时校验
        markStateOwner(user.email);

        if (cloudState) {
          // 云端有此用户的数据，直接应用（内部已处理日期重置）
          setState(cloudState);
          saveState(cloudState);
        } else if (!isSameUser) {
          // 新用户且云端无数据 → 从零开始，不继承前一个用户的本地数据
          const fresh = defaultState();
          setState(fresh);
          saveState(fresh);
        }
        // 同一用户且云端无数据 → 继续使用本地 localStorage（正常情况）
      }
    });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 每次状态变化：同步到 localStorage + 云端（云端有 1.5 秒防抖）
  useEffect(() => {
    saveState(state);
    saveStateToCloud(state);
  }, [state]);

  const updateState = (next: AppState | ((current: AppState) => AppState)) => {
    setState((current) => (typeof next === "function" ? next(current) : next));
  };

  const addReviewItems = (items: Parameters<typeof makeReviewItem>[0][]) => {
    updateState((current) => ({
      ...current,
      reviewItems: [...items.map(makeReviewItem), ...current.reviewItems],
    }));
  };

  const addKnowledge = (entry: Parameters<typeof makeKnowledgeEntry>[0]) => {
    updateState((current) => ({
      ...current,
      knowledge: [makeKnowledgeEntry(entry), ...current.knowledge],
    }));
  };

  const updateProgress = (progress: AppState["progress"] | ((current: AppState["progress"]) => AppState["progress"])) => {
    updateState((current) => ({
      ...current,
      progress: typeof progress === "function" ? progress(current.progress) : progress,
    }));
  };

  const completeStudy = async () => {
    const report = await generateDailyReport(state);
    const currentThemeId = state.progress.today.themeId;
    const updatedCompleted = [...(state.completedThemeIds ?? []), currentThemeId];
    const nextId = pickNextThemeId(currentThemeId, state.completedThemeIds ?? [], state.generatedThemes ?? []);

    if (nextId !== null) {
      // 还有未使用的主题，直接预选
      updateState((current) => {
        const today = getTodayKey();
        const streakDays = current.lastStudyDate === today ? current.streakDays : current.streakDays + 1;
        const otherReports = current.dailyReports.filter((item) => item.date !== today);
        return {
          ...current,
          lastStudyDate: today,
          streakDays,
          dailyReports: [makeDailyReport(report), ...otherReports],
          completedThemeIds: updatedCompleted.slice(-50),
          nextThemeId: nextId,
        };
      });
    } else {
      // 所有主题已用完 → 调用 AI 生成全新主题
      const allThemes: DailyTheme[] = [...dailyThemes, ...(state.generatedThemes ?? [])];
      const completedTitles = allThemes.map((t) => t.title);
      const usedWords = allThemes.flatMap((t) => t.vocabulary.map((v) => v.word));
      const newTheme = await requestGenerateTheme(completedTitles, usedWords);

      updateState((current) => {
        const today = getTodayKey();
        const streakDays = current.lastStudyDate === today ? current.streakDays : current.streakDays + 1;
        const otherReports = current.dailyReports.filter((item) => item.date !== today);
        const newGeneratedThemes = newTheme
          ? [...(current.generatedThemes ?? []), newTheme]
          : (current.generatedThemes ?? []);
        return {
          ...current,
          lastStudyDate: today,
          streakDays,
          dailyReports: [makeDailyReport(report), ...otherReports],
          completedThemeIds: updatedCompleted.slice(-50),
          // 使用新生成的主题，若生成失败则从第一个主题重新开始
          nextThemeId: newTheme?.id ?? dailyThemes[0].id,
          generatedThemes: newGeneratedThemes,
        };
      });
    }
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">EN</div>
          <div>
            <strong>英语成长 Agent</strong>
            <span>20 分钟日常英语训练</span>
          </div>
        </div>
        <nav>
          <button className={activeTab === "today" ? "active" : ""} onClick={() => setActiveTab("today")}>
            <Target size={18} /> 今日学习
          </button>
          <button className={activeTab === "diagnosis" ? "active" : ""} onClick={() => setActiveTab("diagnosis")}>
            <ClipboardCheck size={18} /> 首次诊断
            {state.diagnosis.completed && (
              <span style={{ marginLeft: "auto", fontSize: 10, background: "#67c85d", color: "#102413", borderRadius: 999, padding: "2px 7px", fontWeight: 700, flexShrink: 0 }}>
                ✓ 已完成
              </span>
            )}
          </button>
          <button className={activeTab === "review" ? "active" : ""} onClick={() => setActiveTab("review")}>
            <RotateCcw size={18} /> 集中复习
          </button>
          <button className={activeTab === "knowledge" ? "active" : ""} onClick={() => setActiveTab("knowledge")}>
            <Library size={18} /> 知识库
          </button>
          <button className={activeTab === "reports" ? "active" : ""} onClick={() => setActiveTab("reports")}>
            <FileText size={18} /> 我的报告
          </button>
        </nav>
        {currentUser.authenticated && (
          <div
            style={{
              padding: "14px 14px 12px",
              borderRadius: 14,
              background: "linear-gradient(145deg, #1e3524, #263c2a)",
              border: "1px solid #3d5440",
              boxShadow: "0 4px 16px rgba(0,0,0,0.25)",
            }}
          >
            {/* 头像 + 信息 */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 11 }}>
              {/* 头像圆圈 */}
              <div
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: "50%",
                  background: getAvatarColor(currentUser.email ?? ""),
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 13,
                  fontWeight: 800,
                  color: "#fff",
                  flexShrink: 0,
                  boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
                  letterSpacing: "0.5px",
                }}
              >
                {getInitials(currentUser.name ?? currentUser.email ?? "?")}
              </div>
              {/* 名称 + 邮箱 */}
              <div style={{ minWidth: 0, flex: 1 }}>
                <strong
                  style={{
                    display: "block",
                    fontSize: 13,
                    color: "#e8f5e5",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    lineHeight: 1.3,
                  }}
                >
                  {currentUser.name ?? currentUser.email?.split("@")[0] ?? "用户"}
                </strong>
                <span
                  style={{
                    display: "block",
                    fontSize: 10,
                    color: "#7aad85",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    marginTop: 2,
                    lineHeight: 1.3,
                  }}
                >
                  {currentUser.email}
                </span>
              </div>
              {/* 在线绿点 */}
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: "#67c85d",
                  flexShrink: 0,
                  boxShadow: "0 0 6px rgba(103,200,93,0.6)",
                }}
              />
            </div>
            {/* 退出登录按钮 */}
            <button
              onClick={() => { window.location.href = "/cdn-cgi/access/logout"; }}
              style={{
                width: "100%",
                minHeight: "unset",
                height: 28,
                fontSize: 12,
                background: "rgba(255,255,255,0.04)",
                border: "1px solid #4a6050",
                color: "#8aba94",
                borderRadius: 8,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 5,
                transition: "background 160ms ease, border-color 160ms ease, color 160ms ease",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = "rgba(207,93,59,0.15)";
                (e.currentTarget as HTMLButtonElement).style.borderColor = "#cf5d3b";
                (e.currentTarget as HTMLButtonElement).style.color = "#e87a60";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.04)";
                (e.currentTarget as HTMLButtonElement).style.borderColor = "#4a6050";
                (e.currentTarget as HTMLButtonElement).style.color = "#8aba94";
              }}
            >
              <LogOut size={11} />
              退出登录
            </button>
          </div>
        )}
        <div className="side-stat">
          <span>连续学习</span>
          <strong>{state.streakDays} 天</strong>
        </div>
      </aside>

      <main className="main">
        <Header state={state} />
        {activeTab === "today" && (
          <TodayView
            state={state}
            addReviewItems={addReviewItems}
            addKnowledge={addKnowledge}
            completeStudy={completeStudy}
            updateProgress={updateProgress}
            updateState={updateState}
            onNavigateToReports={() => setActiveTab("reports")}
          />
        )}
        {activeTab === "diagnosis" && (
          <DiagnosisView state={state} updateState={updateState} updateProgress={updateProgress} addReviewItems={addReviewItems} />
        )}
        {activeTab === "review" && <ReviewView state={state} updateState={updateState} />}
        {activeTab === "knowledge" && <KnowledgeView state={state} />}
        {activeTab === "reports" && <ReportsView state={state} />}
      </main>
    </div>
  );
}

function Header({ state }: { state: AppState }) {
  return (
    <header className="hero">
      <div>
        <span className="eyebrow">Daily English Coach</span>
        <h1>每天 20 分钟，把英语用起来</h1>
        <p>{state.diagnosis.completed ? state.diagnosis.summary : "先做一次完整诊断，再进入适合你的轻量训练节奏。"}</p>
      </div>
      <div className="hero-panel">
        <Sparkles size={20} />
        <strong>AI 云端模式</strong>
        <span>线上通过 Cloudflare Secret 调用模型，不在浏览器保存密钥；不可用时自动切回离线练习。</span>
      </div>
    </header>
  );
}

function TodayView({
  state,
  addReviewItems,
  addKnowledge,
  completeStudy,
  updateProgress,
  updateState,
  onNavigateToReports,
}: {
  state: AppState;
  addReviewItems: (items: Parameters<typeof makeReviewItem>[0][]) => void;
  addKnowledge: (entry: Parameters<typeof makeKnowledgeEntry>[0]) => void;
  completeStudy: () => Promise<void>;
  updateProgress: (progress: AppState["progress"] | ((current: AppState["progress"]) => AppState["progress"])) => void;
  updateState: (next: AppState | ((current: AppState) => AppState)) => void;
  onNavigateToReports: () => void;
}) {
  const [reporting, setReporting] = useState(false);
  const theme = getThemeForToday(state);
  // 上一次全部完成且日期变了才重置，否则继续昨天的进度
  const prevAllCompleted =
    state.progress.today.vocabulary.completed &&
    state.progress.today.speaking.completed &&
    state.progress.today.writing.completed;
  const dateChanged = state.progress.today.date !== getTodayKey();
  const todayProgress =
    dateChanged && prevAllCompleted
      ? resetTodayProgressForTheme(theme)
      : state.progress.today;
  const speakingUnlocked = todayProgress.vocabulary.completed;
  const writingUnlocked = todayProgress.speaking.completed;
  const reviewUnlocked = todayProgress.writing.completed;
  // 完成视图需同时满足：
  // 1. 报告是今天生成的
  // 2. 今日进度确实是今天的
  // 3. 三个模块都真正完成了（防止 KV 状态不一致时误显示完成视图）
  const reviewCompleted =
    state.lastStudyDate === getTodayKey() &&
    todayProgress.date === getTodayKey() &&
    todayProgress.vocabulary.completed &&
    todayProgress.speaking.completed &&
    todayProgress.writing.completed;
  const pathStatuses: PathStatus[] = [
    todayProgress.vocabulary.completed ? "completed" : "current",
    todayProgress.vocabulary.completed ? (todayProgress.speaking.completed ? "completed" : "current") : "locked",
    todayProgress.speaking.completed ? (todayProgress.writing.completed ? "completed" : "current") : "locked",
    reviewCompleted ? "completed" : reviewUnlocked ? "current" : "locked",
  ];

  // 只有上一次学习「全部完成」（词汇+口语+写作均 completed）且日期已变，才开始新一天。
  // 未完成的情况下即使日期变了，也继续昨天的进度，不重置。
  useEffect(() => {
    const prevAllCompleted =
      state.progress.today.vocabulary.completed &&
      state.progress.today.speaking.completed &&
      state.progress.today.writing.completed;
    const dateChanged = state.progress.today.date !== getTodayKey();
    if (dateChanged && prevAllCompleted) {
      updateProgress((progress) => ({ ...progress, today: resetTodayProgressForTheme(theme) }));
    }
  }, [
    state.progress.today.date,
    state.progress.today.vocabulary.completed,
    state.progress.today.speaking.completed,
    state.progress.today.writing.completed,
    theme,
    updateProgress,
  ]);

  const handleComplete = async () => {
    setReporting(true);
    await completeStudy();
    setReporting(false);
  };

  // 强制重置今日进度，切换到下一个未完成的主题（用于状态不一致时的紧急逃生）
  const forceNewDay = () => {
    const currentThemeId = state.progress.today.themeId;
    const allThemes: DailyTheme[] = [...dailyThemes, ...(state.generatedThemes ?? [])];
    const nextId = pickNextThemeId(currentThemeId, state.completedThemeIds ?? [], state.generatedThemes ?? []);
    const nextTheme = (nextId ? allThemes.find((t) => t.id === nextId) : null) ?? dailyThemes[0];
    updateState((current) => ({
      ...current,
      lastStudyDate: undefined,
      nextThemeId: undefined,
      progress: {
        ...current.progress,
        today: resetTodayProgressForTheme(nextTheme),
      },
    }));
  };

  // 今日全部完成（包括报告已生成）→ 展示只读总结，不允许重复练习
  if (reviewCompleted) {
    const currentThemeIndex = dailyThemes.findIndex((t) => t.id === theme.id);
    const nextTheme = dailyThemes[(currentThemeIndex + 1) % dailyThemes.length];
    return (
      <div className="lesson-flow">
        <section className="theme-stage">
          <div>
            <span className="eyebrow">Today's Theme</span>
            <h2>{theme.title}</h2>
            <p>{theme.description}</p>
          </div>
          <div className="theme-badge">{theme.domain}</div>
        </section>
        <section className="panel wide">
          <div className="section-title">
            <h2>今日学习路径</h2>
            <span>今天已全部完成 ✅</span>
          </div>
          <div className="lesson-path">
            {todayPlan.map((item) => (
              <div className="path-node completed" key={item.title}>
                <div className="node-dot" />
                <em className="node-status">已完成</em>
                <strong>{item.title}</strong>
                <span>{item.target}</span>
                <p>{item.description}</p>
              </div>
            ))}
          </div>
        </section>
        <section className="panel wide">
          <div className="section-title">
            <h2>🎉 今日学习全部完成！</h2>
            <span>明天再来继续</span>
          </div>
          <p className="muted">
            你完成了今天全部的词汇互动、口语陪练、写作练习和集中复习，学习报告已生成保存。
          </p>
          <div
            style={{
              marginTop: 16,
              padding: 16,
              background: "linear-gradient(135deg,#eef8ec,#f3fbf2)",
              borderRadius: 12,
              border: "1px solid #b8dcb7",
            }}
          >
            <span style={{ fontSize: 12, color: "#667461", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px" }}>
              明日学习主题（AI 根据今日学习成果安排）
            </span>
            <strong style={{ display: "block", marginTop: 8, fontSize: 18, color: "#172018" }}>
              {nextTheme.title}
            </strong>
            <p style={{ margin: "6px 0 0", color: "#667461", fontSize: 14, lineHeight: 1.6 }}>
              {nextTheme.description}
            </p>
          </div>
          <div className="actions">
            <button className="primary" onClick={onNavigateToReports}>
              <FileText size={18} /> 查看今日学习报告
            </button>
            <button onClick={forceNewDay} style={{ color: "#667461", fontSize: 13 }}>
              🔄 开始新的学习
            </button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="lesson-flow">
      <section className="theme-stage">
        <div>
          <span className="eyebrow">Today's Theme</span>
          <h2>{theme.title}</h2>
          <p>{theme.description}</p>
        </div>
        <div className="theme-badge">{theme.domain}</div>
      </section>
      <section className="panel wide">
        <div className="section-title">
          <h2>今日学习路径</h2>
          <span>{state.lastStudyDate === getTodayKey() ? "今天已完成" : "按顺序完成：词汇 -> 口语 -> 写作"}</span>
        </div>
        <div className="lesson-path">
          {todayPlan.map((item, index) => (
            <div className={`path-node ${pathStatuses[index]}`} key={item.title}>
              <div className="node-dot" />
              <em className="node-status">
                {pathStatuses[index] === "completed" ? "已完成" : pathStatuses[index] === "current" ? "进行中" : "未解锁"}
              </em>
              <strong>{item.title}</strong>
              <span>{item.target}</span>
              <p>{item.description}</p>
            </div>
          ))}
        </div>
      </section>
      {/* 每次只显示当前激活的单个模块 */}
      {!todayProgress.vocabulary.completed && (
        <VocabularyPractice
          theme={theme}
          progress={todayProgress.vocabulary}
          updateProgress={(next) => updateProgress((current) => ({ ...current, today: { ...todayProgress, vocabulary: next } }))}
          addReviewItems={addReviewItems}
          addKnowledge={addKnowledge}
        />
      )}
      {todayProgress.vocabulary.completed && !todayProgress.speaking.completed && (
        <SpeakingPractice
          theme={theme}
          progress={todayProgress.speaking}
          updateProgress={(next) => updateProgress((current) => ({ ...current, today: { ...todayProgress, speaking: next } }))}
          addReviewItems={addReviewItems}
          addKnowledge={addKnowledge}
        />
      )}
      {todayProgress.speaking.completed && !todayProgress.writing.completed && (
        <WritingPractice
          theme={theme}
          progress={todayProgress.writing}
          updateProgress={(next) => updateProgress((current) => ({ ...current, today: { ...todayProgress, writing: next } }))}
          addReviewItems={addReviewItems}
          addKnowledge={addKnowledge}
        />
      )}
      {todayProgress.writing.completed && (
        <section className="panel wide">
          <div className="section-title">
            <h2>完成今日学习</h2>
            <span>轻量打卡</span>
          </div>
          <p className="muted">完成练习后点这里，Agent 会评价今天的学习情况，生成学习报告，并根据薄弱点调整之后的计划。</p>
          <button className="primary full" onClick={handleComplete} disabled={reporting}>
            <CheckCircle2 size={18} /> {reporting ? "正在生成今日报告..." : "我完成了今天的学习"}
          </button>
        </section>
      )}
    </div>
  );
}

function DiagnosisView({
  state,
  updateState,
  updateProgress,
  addReviewItems,
}: {
  state: AppState;
  updateState: (next: AppState | ((current: AppState) => AppState)) => void;
  updateProgress: (progress: AppState["progress"] | ((current: AppState["progress"]) => AppState["progress"])) => void;
  addReviewItems: (items: Parameters<typeof makeReviewItem>[0][]) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [speakingNotice, setSpeakingNotice] = useState("");
  const diagnosisProgress = state.progress.diagnosis;
  const setDiagnosisProgress = (next: Partial<typeof diagnosisProgress>) => {
    updateProgress((progress) => ({ ...progress, diagnosis: { ...progress.diagnosis, ...next } }));
  };
  const diagnosisCards = vocabularyCards.slice(0, DAILY_VOCABULARY_TARGET);
  const diagnosisCard = diagnosisCards[diagnosisProgress.vocabIndex % diagnosisCards.length];
  const diagnosisQuestionType = diagnosisProgress.vocabIndex % 2 === 0 ? "cn-to-en" : "en-to-cn";
  const diagnosisCorrectAnswer = diagnosisQuestionType === "cn-to-en" ? diagnosisCard.word : diagnosisCard.meaning;
  const diagnosisOptions = useMemo(() => {
    const pool = diagnosisCards
      .filter((item) => item.word !== diagnosisCard.word)
      .slice(diagnosisProgress.vocabIndex + 1)
      .concat(diagnosisCards.filter((item) => item.word !== diagnosisCard.word));
    const wrong = pool.slice(0, 3).map((item) => (diagnosisQuestionType === "cn-to-en" ? item.word : item.meaning));
    return [diagnosisCorrectAnswer, ...wrong].sort((a, b) => a.localeCompare(b));
  }, [diagnosisCard.meaning, diagnosisCard.word, diagnosisCards, diagnosisCorrectAnswer, diagnosisQuestionType, diagnosisProgress.vocabIndex]);

  if (state.diagnosis.completed) {
    return (
      <section className="panel">
        <div className="section-title">
          <h2>英文入门水平报告</h2>
          <span>首次诊断已完成，不可重复使用</span>
        </div>
        <div className="result-box">
          <strong>入门时能力画像</strong>
          <p>完成时间：{state.diagnosis.completedAt ? new Date(state.diagnosis.completedAt).toLocaleString() : "已完成"}</p>
          <p>词汇：{state.diagnosis.vocabularyLevel}</p>
          <p>口语：{state.diagnosis.speakingLevel}</p>
          <p>写作：{state.diagnosis.writingLevel}</p>
          <p>{state.diagnosis.summary}</p>
        </div>
        <div className="review-list">
          {state.diagnosis.plan.map((item) => (
            <div className="plan-step" key={item}>
              <strong>{item}</strong>
            </div>
          ))}
        </div>
      </section>
    );
  }

  const finishDiagnosis = async () => {
    setLoading(true);
    const vocabScore = Math.round((diagnosisProgress.vocabCorrect / DAILY_VOCABULARY_TARGET) * 100);
    const speakingWordCount = diagnosisProgress.speakingAnswers.join(" ").split(/\s+/).filter(Boolean).length;
    const vocabLevel = vocabScore >= 85 ? "A2+ 日常词汇较熟" : vocabScore >= 60 ? "A2 日常词汇可继续扩展" : "A1+ 需要强化高频词";
    const speakingLevel = speakingWordCount >= 24 ? "A2 能用短句表达日常想法" : speakingWordCount >= 12 ? "A1+ 能进行基础短句表达" : "A1 需要完整句训练";
    const writingLevel = "未单独检测，后续通过每日写作练习动态评估";

    const feedback = await requestAiFeedback(
      "speaking",
      `Vocabulary score: ${vocabScore}/100\nSpeaking answers:\n${diagnosisProgress.speakingAnswers.join("\n")}`,
      "首次诊断：根据20道词汇选择题和3道口语短答分析用户英语入门水平，并制定学习计划。",
    );

    updateState((current) => ({
      ...current,
      diagnosis: {
        completed: true,
        completedAt: new Date().toISOString(),
        vocabularyLevel: vocabLevel,
        speakingLevel,
        writingLevel,
        summary: feedback.summary,
        strengths: [`词汇诊断正确率 ${vocabScore}%`, "已经完成口语短答输入，具备开始日常表达训练的基础。"],
        weaknesses: feedback.corrections,
        plan: [
          "第 1-2 周：高频生活词汇 + 完整句回答。",
          "第 3-4 周：常见场景口语 + want to, usually, because 等句型。",
          "第 5-6 周：集中复习薄弱词句，写作从短句到小段落。",
          "第 7-8 周：模拟真实日常对话，提升自然度和准确度。",
        ],
      },
    }));
    addReviewItems(feedback.reviewItems);
    setLoading(false);
  };

  const chooseDiagnosisVocab = (option: string) => {
    if (diagnosisProgress.vocabAnswered) return;
    const correct = option === diagnosisCorrectAnswer;
    setDiagnosisProgress({
      vocabSelected: option,
      vocabAnswered: true,
      vocabFeedback: correct ? "答对了。" : `需要巩固。正确答案是：${diagnosisCorrectAnswer}`,
      vocabCorrect: diagnosisProgress.vocabCorrect + (correct ? 1 : 0),
    });
  };

  const nextDiagnosisVocab = () => {
    if (diagnosisProgress.vocabIndex < DAILY_VOCABULARY_TARGET - 1) {
      setDiagnosisProgress({
        vocabIndex: diagnosisProgress.vocabIndex + 1,
        vocabSelected: "",
        vocabAnswered: false,
        vocabFeedback: "",
      });
    }
  };

  const saveSpeakingAnswer = () => {
    if (!diagnosisProgress.speakingAnswer.trim()) return;
    if (!hasOnlyChineseEnglish(diagnosisProgress.speakingAnswer)) {
      setSpeakingNotice("请只使用中文或英语继续。Please use Chinese or English only.");
      return;
    }
    setSpeakingNotice("");
    setDiagnosisProgress({
      speakingAnswers: [...diagnosisProgress.speakingAnswers, diagnosisProgress.speakingAnswer],
      speakingAnswer: "",
      speakingIndex:
        diagnosisProgress.speakingIndex < diagnosisSpeakingPrompts.length - 1
          ? diagnosisProgress.speakingIndex + 1
          : diagnosisProgress.speakingIndex,
    });
  };

  return (
    <section className="panel">
      <div className="section-title">
        <h2>首次诊断</h2>
        <span>20 道词汇选择 + 3 道口语短答</span>
      </div>
      <div className="diagnosis-grid two-col">
        <div className="result-box">
          <strong>词汇熟悉度 {diagnosisProgress.vocabIndex + 1}/{DAILY_VOCABULARY_TARGET}</strong>
          <p className="muted">{diagnosisQuestionType === "cn-to-en" ? "根据中文意思选择英文单词" : "根据英文单词选择中文意思"}</p>
          <div className="word-card">
            <strong>{diagnosisQuestionType === "cn-to-en" ? diagnosisCard.meaning : diagnosisCard.word}</strong>
          </div>
          <div className="choice-grid">
            {diagnosisOptions.map((option) => (
              <button
                className={
                  diagnosisProgress.vocabAnswered && option === diagnosisCorrectAnswer
                    ? "choice correct"
                    : diagnosisProgress.vocabAnswered && option === diagnosisProgress.vocabSelected
                      ? "choice wrong"
                      : "choice"
                }
                onClick={() => chooseDiagnosisVocab(option)}
                key={option}
              >
                {option}
              </button>
            ))}
          </div>
          {diagnosisProgress.vocabFeedback && <p className="feedback">{diagnosisProgress.vocabFeedback}</p>}
          <button
            className="primary full"
            onClick={nextDiagnosisVocab}
            disabled={!diagnosisProgress.vocabAnswered || diagnosisProgress.vocabIndex >= DAILY_VOCABULARY_TARGET - 1}
          >
            下一题
          </button>
        </div>
        <div className="result-box">
          <strong>口语表达 {Math.min(diagnosisProgress.speakingIndex + 1, diagnosisSpeakingPrompts.length)}/{diagnosisSpeakingPrompts.length}</strong>
          <p className="muted">{diagnosisSpeakingPrompts[diagnosisProgress.speakingIndex]}</p>
          <textarea
            value={diagnosisProgress.speakingAnswer}
            onChange={(event) => setDiagnosisProgress({ speakingAnswer: event.target.value })}
            placeholder="One English sentence..."
          />
          <button className="primary full" onClick={saveSpeakingAnswer} disabled={diagnosisProgress.speakingAnswers.length >= diagnosisSpeakingPrompts.length}>
            保存本题回答
          </button>
          {speakingNotice && <p className="feedback">{speakingNotice}</p>}
          {diagnosisProgress.speakingAnswers.map((answer, idx) => (
            <p className="example" key={`${answer}-${idx}`}>
              {idx + 1}. {answer}
            </p>
          ))}
        </div>
      </div>
      <div className="report-bars">
        <div>
          <span>词汇正确率</span>
          <div className="bar">
            <i style={{ width: `${Math.round((diagnosisProgress.vocabCorrect / DAILY_VOCABULARY_TARGET) * 100)}%` }} />
          </div>
        </div>
        <div>
          <span>口语完成度</span>
          <div className="bar">
            <i style={{ width: `${Math.round((diagnosisProgress.speakingAnswers.length / diagnosisSpeakingPrompts.length) * 100)}%` }} />
          </div>
        </div>
      </div>
      <button
        className="primary"
        onClick={finishDiagnosis}
        disabled={
          loading ||
          diagnosisProgress.vocabIndex < DAILY_VOCABULARY_TARGET - 1 ||
          !diagnosisProgress.vocabAnswered ||
          diagnosisProgress.speakingAnswers.length < diagnosisSpeakingPrompts.length
        }
      >
        <ClipboardCheck size={18} /> {loading ? "正在生成诊断..." : "生成可视化报告和学习计划"}
      </button>
    </section>
  );
}

function VocabularyPractice({
  theme,
  progress,
  updateProgress,
  addReviewItems,
  addKnowledge,
}: {
  theme: DailyTheme;
  progress: AppState["progress"]["today"]["vocabulary"];
  updateProgress: (progress: AppState["progress"]["today"]["vocabulary"]) => void;
  addReviewItems: (items: Parameters<typeof makeReviewItem>[0][]) => void;
  addKnowledge: (entry: Parameters<typeof makeKnowledgeEntry>[0]) => void;
}) {
  const cards = theme.vocabulary;
  const card = cards[progress.index % cards.length];
  const questionType = progress.index % 2 === 0 ? "en-to-cn" : "cn-to-en";
  const learnedCount = Math.min(progress.index + 1, DAILY_VOCABULARY_TARGET);
  const correctAnswer = questionType === "en-to-cn" ? card.meaning : card.word;
  const canUnlockSpeaking = progress.index >= DAILY_VOCABULARY_TARGET - 1 && progress.answered;
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);

  // 控制"继续"按钮：AI 反馈到达后解锁，最多等待 10 秒
  const [canContinue, setCanContinue] = useState(false);

  // 换题时重置
  useEffect(() => {
    setCanContinue(false);
  }, [progress.index]);

  // AI 反馈到达 → 立即解锁；超过 10 秒还没到 → 强制解锁
  useEffect(() => {
    if (!progress.answered) return;
    if (progress.feedback) {
      setCanContinue(true);
      return;
    }
    const timer = setTimeout(() => setCanContinue(true), 10000);
    return () => clearTimeout(timer);
  }, [progress.answered, progress.feedback]);

  const options = useMemo(() => {
    const pool = cards
      .filter((item) => item.word !== card.word)
      .slice(progress.index + 1)
      .concat(cards.filter((item) => item.word !== card.word));
    const wrong = pool.slice(0, 3).map((item) => (questionType === "en-to-cn" ? item.meaning : item.word));
    return [correctAnswer, ...wrong].sort((a, b) => a.localeCompare(b));
  }, [card.meaning, card.word, cards, correctAnswer, progress.index, questionType]);

  // Auto-load and play TTS when card changes
  useEffect(() => {
    let cancelled = false;
    const prev = audioRef.current;
    if (prev) {
      prev.pause();
      if (prev.src.startsWith("blob:")) URL.revokeObjectURL(prev.src);
      audioRef.current = null;
    }
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    setIsSpeaking(false);

    requestTts(card.word).then((audio) => {
      if (cancelled) return;
      if (audio) {
        audioRef.current = audio;
        setIsSpeaking(true);
        audio.addEventListener("ended", () => setIsSpeaking(false), { once: true });
        audio.addEventListener("error", () => setIsSpeaking(false), { once: true });
        audio.play().catch(() => {
          // Autoplay blocked — user can still click the speaker button
          setIsSpeaking(false);
        });
      } else if (!cancelled && window.speechSynthesis) {
        // Fallback: Web Speech API with British English (en-GB / BBC RP)
        const utterance = new SpeechSynthesisUtterance(card.word);
        utterance.lang = "en-GB";
        utterance.rate = 0.85;
        const ukVoice = getUkVoice();
        if (ukVoice) utterance.voice = ukVoice;
        setIsSpeaking(true);
        utterance.onend = () => setIsSpeaking(false);
        utterance.onerror = () => setIsSpeaking(false);
        window.speechSynthesis.speak(utterance);
      }
    });

    return () => {
      cancelled = true;
      const current = audioRef.current;
      if (current) {
        current.pause();
        if (current.src.startsWith("blob:")) URL.revokeObjectURL(current.src);
        audioRef.current = null;
      }
      if (window.speechSynthesis) window.speechSynthesis.cancel();
    };
  }, [card.word]);

  // Speak word via TTS API or fall back to Web Speech API
  const speakWord = async (word: string): Promise<boolean> => {
    // Try existing loaded audio first
    if (audioRef.current) {
      const audio = audioRef.current;
      setIsSpeaking(true);
      audio.addEventListener("ended", () => setIsSpeaking(false), { once: true });
      audio.addEventListener("error", () => setIsSpeaking(false), { once: true });
      audio.currentTime = 0;
      await audio.play().catch(() => setIsSpeaking(false));
      return true;
    }
    // Try TTS API
    const audio = await requestTts(word);
    if (audio) {
      audioRef.current = audio;
      setIsSpeaking(true);
      audio.addEventListener("ended", () => setIsSpeaking(false), { once: true });
      audio.addEventListener("error", () => setIsSpeaking(false), { once: true });
      await audio.play().catch(() => setIsSpeaking(false));
      return true;
    }
    // Fallback: Web Speech API with British English (en-GB / BBC RP)
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(word);
      utterance.lang = "en-GB";
      utterance.rate = 0.85;
      const ukVoice = getUkVoice();
      if (ukVoice) utterance.voice = ukVoice;
      setIsSpeaking(true);
      utterance.onend = () => setIsSpeaking(false);
      utterance.onerror = () => setIsSpeaking(false);
      window.speechSynthesis.speak(utterance);
      return true;
    }
    return false;
  };

  const playWord = async () => {
    if (isSpeaking) return;
    await speakWord(card.word);
  };

  const choose = async (option: string) => {
    if (progress.answered) return;
    const correct = option === correctAnswer;
    updateProgress({ ...progress, selected: option, answered: true });
    const result = await requestAiFeedback(
      "vocabulary",
      `题目：${questionType === "en-to-cn" ? card.word : card.meaning}\n用户选择：${option}\n正确答案：${correctAnswer}`,
      "词汇单选题即时反馈。",
    );
    const nextFeedback = correct
      ? `答对了。${card.word} 的意思是 ${card.meaning}。${card.example}`
      : `这题需要巩固。正确答案是 ${correctAnswer}。${result.summary}`;
    updateProgress({ ...progress, selected: option, answered: true, feedback: nextFeedback });
    // 只有答错时才记录到知识库（知识库只收录错误和需要巩固的内容）
    if (!correct) {
      addKnowledge({
        area: "vocabulary",
        title: card.word,
        content: `${card.word} = ${card.meaning}`,
        correction: `用户选择了 ${option}，正确答案是 ${correctAnswer}。`,
        example: card.example,
      });
      addReviewItems([
        {
          area: "vocabulary",
          title: card.word,
          prompt: questionType === "en-to-cn" ? `选择 ${card.word} 的中文意思。` : `选择 ${card.meaning} 对应的英文单词。`,
          answer: card.example,
          note: `${card.word} = ${card.meaning}`,
          errorCount: 1,
          confidence: 2,
        },
      ]);
    }
  };

  const nextQuestion = () => {
    if (progress.index < DAILY_VOCABULARY_TARGET - 1) {
      updateProgress({ ...progress, index: progress.index + 1, selected: "", feedback: "", answered: false });
      return;
    }
    updateProgress({ ...progress, selected: "", feedback: "", answered: false });
  };

  const progressPct = (learnedCount / DAILY_VOCABULARY_TARGET) * 100;
  const isCorrect = progress.answered && progress.selected === correctAnswer;

  return (
    <section className="panel" style={{ overflow: "hidden" }}>
      {/* Duolingo-style orange progress bar */}
      <div className="vocab-progress-bar">
        <div className="vocab-progress-fill" style={{ width: `${progressPct}%` }} />
      </div>

      <div className="section-title" style={{ marginTop: 14 }}>
        <h2>词汇互动</h2>
        <span>
          {theme.domain}主题 {learnedCount}/{DAILY_VOCABULARY_TARGET} 题
        </span>
      </div>

      {/* Stacked word card */}
      <div className="vocab-card-stack">
        <div className="vocab-card-inner">
          <p className="vocab-question-hint">
            {questionType === "en-to-cn" ? "这个英文单词是什么意思？" : "哪个英文单词对应这个中文？"}
          </p>
          <div className="vocab-word-row">
            <span className="vocab-word-text">
              {questionType === "en-to-cn" ? card.word : card.meaning}
            </span>
            <button
              className={`vocab-speaker-btn${isSpeaking ? " speaking" : ""}`}
              onClick={playWord}
              title="朗读单词"
            >
              <Volume2 size={20} />
            </button>
          </div>
        </div>
      </div>

      {/* Full-width staggered options */}
      <div className="vocab-options">
        {options.map((option, idx) => {
          let cls = "vocab-option";
          if (progress.answered) {
            if (option === correctAnswer) cls += " show-correct";
            else if (option === progress.selected) cls += " wrong";
          }
          return (
            <button
              key={option}
              className={cls}
              style={{ animationDelay: `${idx * 70}ms` }}
              onClick={() => choose(option)}
              disabled={progress.answered}
            >
              {option}
            </button>
          );
        })}
      </div>

      {/* Result bar – slides in after answering */}
      {progress.answered && (
        <div className={`vocab-result-bar ${isCorrect ? "correct-bar" : "wrong-bar"}`}>
          <div className="vocab-result-content">
            <span className="vocab-result-icon">{isCorrect ? "✅" : "❌"}</span>
            <div>
              <strong>{isCorrect ? "太棒了！" : "再接再厉！"}</strong>
              {progress.feedback && <p className="vocab-result-detail">{progress.feedback}</p>}
            </div>
          </div>
          <div className="vocab-result-actions">
            {!canUnlockSpeaking && (
              <button
                className="primary vocab-continue-btn"
                onClick={nextQuestion}
                disabled={!canContinue || progress.index >= DAILY_VOCABULARY_TARGET - 1}
              >
                {canContinue ? "继续" : "AI 分析中…"}
              </button>
            )}
            {canUnlockSpeaking && !progress.completed && (
              <button
                className="primary vocab-continue-btn"
                onClick={() => updateProgress({ ...progress, completed: true })}
                disabled={!canContinue}
              >
                <CheckCircle2 size={18} /> {canContinue ? "进入口语陪练" : "AI 分析中…"}
              </button>
            )}
            {progress.completed && <span className="pill">词汇互动已完成</span>}
          </div>
        </div>
      )}
    </section>
  );
}

function SpeakingPractice({
  theme,
  progress,
  updateProgress,
  addReviewItems,
  addKnowledge,
}: {
  theme: DailyTheme;
  progress: AppState["progress"]["today"]["speaking"];
  updateProgress: (progress: AppState["progress"]["today"]["speaking"]) => void;
  addReviewItems: (items: Parameters<typeof makeReviewItem>[0][]) => void;
  addKnowledge: (entry: Parameters<typeof makeKnowledgeEntry>[0]) => void;
}) {
  const scenario = theme.speaking;
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<InstanceType<SpeechRecognitionConstructor> | null>(null);
  const [interimText, setInterimText] = useState("");
  const userTurns = progress.messages.filter((message) => message.role === "user").length;
  const canUnlockWriting = userTurns >= DAILY_SPEAKING_TARGET && Boolean(progress.feedback.trim());

  // ── TTS helpers：中文普通话 + 英文 BBC RP（fable/en-GB）──
  const speakText = (text: string) => {
    // 混合语言朗读：中文段用普通话，英文段用 TTS fable + en-GB
    speakMixed(text).catch(() => {});
  };

  const chatBoxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (chatBoxRef.current) {
      chatBoxRef.current.scrollTop = chatBoxRef.current.scrollHeight;
    }
  }, [progress.messages.length]);

  const agentMessages = progress.messages.filter((m) => m.role === "agent");
  const agentMsgCountRef = useRef(agentMessages.length);
  useEffect(() => {
    if (agentMessages.length > 0 && agentMessages.length !== agentMsgCountRef.current) {
      agentMsgCountRef.current = agentMessages.length;
      speakText(agentMessages[agentMessages.length - 1].text);
    }
  }, [progress.messages.length]);

  // 首次进入时朗读 opener
  useEffect(() => {
    if (agentMessages.length === 1) {
      speakText(agentMessages[0].text);
      agentMsgCountRef.current = 1;
    }
  }, []);

  const resetScenario = () => {
    updateProgress({ ...progress, messages: [{ role: "agent", text: scenario.opener }], input: "", feedback: "" });
  };

  const send = async () => {
    if (!progress.input.trim()) return;
    if (!hasOnlyChineseEnglish(progress.input)) {
      updateProgress({ ...progress, feedback: "请只使用中文或英语继续。" });
      return;
    }
    const nextMessages: ChatMessage[] = [...progress.messages, { role: "user", text: progress.input }];
    updateProgress({ ...progress, messages: nextMessages, input: "" });
    const turnCount = nextMessages.filter((message) => message.role === "user").length;
    const reply =
      turnCount >= DAILY_SPEAKING_TARGET
        ? "This topic is complete. You did it."
        : await requestAiReply(nextMessages, `${scenario.title}。请主动引导用户，最多 5 句内结束本话题。`);
    updateProgress({ ...progress, messages: [...nextMessages, { role: "agent", text: reply }], input: "" });
    if (turnCount >= DAILY_SPEAKING_TARGET) {
      await finish(nextMessages);
    }
  };

  const finish = async (sourceMessages = progress.messages) => {
    const userText = sourceMessages
      .filter((message) => message.role === "user")
      .map((message) => message.text)
      .join("\n");
    const result = await requestAiFeedback("speaking", userText, scenario.goal);
    updateProgress({ ...progress, messages: sourceMessages, input: "", feedback: `${result.score}分：${result.summary} ${result.corrections.join(" ")}` });
    addReviewItems(result.reviewItems);
    // 只有口语有改进建议时才记录到知识库
    if (result.corrections.length > 0) {
      addKnowledge({
        area: "speaking",
        title: scenario.title,
        content: userText || "本轮暂无用户英语回答。",
        correction: result.corrections.join(" "),
        example: "I usually relax at home because it helps me recharge.",
      });
    }
  };

  const nextTopic = () => {
    updateProgress({ ...progress, messages: [{ role: "agent", text: scenario.opener }], input: "", feedback: "" });
  };

  const startSpeech = () => {
    // 如果正在录音，点击麦克风则停止
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
      setListening(false);
      setInterimText("");
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      updateProgress({ ...progress, feedback: "当前浏览器不支持语音识别，请使用文字输入。" });
      return;
    }

    const recognition = new SpeechRecognition();
    recognitionRef.current = recognition;
    recognition.lang = "en-US";
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => setListening(true);

    recognition.onend = () => {
      recognitionRef.current = null;
      setListening(false);
      setInterimText("");
    };

    recognition.onresult = (event) => {
      let finalTranscript = "";
      let interimTranscript = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalTranscript += result[0].transcript;
        } else {
          interimTranscript += result[0].transcript;
        }
      }
      if (finalTranscript) {
        // 有最终结果：更新 progress.input，清除 interim，停止录音
        updateProgress({ ...progress, input: finalTranscript });
        setInterimText("");
        recognition.stop();
      } else {
        // 仅显示实时转录，不更新 state（避免 stale closure）
        setInterimText(interimTranscript);
      }
    };

    recognition.onerror = () => {
      recognitionRef.current = null;
      setListening(false);
      setInterimText("");
    };

    recognition.start();
  };

  return (
    <section className="panel">
      <div className="section-title">
        <h2>口语陪练</h2>
        <span>
          {scenario.title}：{Math.min(userTurns, DAILY_SPEAKING_TARGET)}/{DAILY_SPEAKING_TARGET} 句
        </span>
      </div>
      <div className="tip-box">
        <strong>本段对话主题：{scenario.title}</strong>
        <p>{scenario.goal}</p>
        <p>Agent 会引导你练习，单个话题最多 5 句，然后给你评价和巩固建议。</p>
      </div>
      <div className="chat-box" ref={chatBoxRef}>
        {progress.messages.map((message, idx) => (
          <div className={`bubble ${message.role}`} key={`${message.role}-${idx}`}>
            {message.role === "agent" ? (
              <span className="bubble-agent-content">
                <span className="bubble-agent-text">{message.text}</span>
                <button
                  className="bubble-speaker-btn"
                  onClick={() => speakText(message.text)}
                  title="朗读"
                >
                  <Volume2 size={14} />
                </button>
              </span>
            ) : (
              message.text
            )}
          </div>
        ))}
      </div>
      <div className="input-row">
        <button className={listening ? "active icon" : "icon"} onClick={startSpeech} title="语音输入">
          <Mic size={18} />
        </button>
        <input
          value={interimText || progress.input}
          onChange={(event) => {
            setInterimText("");
            updateProgress({ ...progress, input: event.target.value });
          }}
          placeholder="Type or speak in English..."
          style={{ fontSize: 16 }}
        />
        <button className="icon primary" onClick={send} title="发送">
          <Send size={18} />
        </button>
      </div>
      <div className="actions">
        <button onClick={resetScenario}>重新开始本话题</button>
        <button onClick={nextTopic}>重新练习</button>
        <button onClick={() => finish()}>结束并评价</button>
        {canUnlockWriting && !progress.completed && (
          <button className="primary" onClick={() => updateProgress({ ...progress, completed: true })}>
            <CheckCircle2 size={18} /> 进入写作练习
          </button>
        )}
        {progress.completed && <span className="pill">口语陪练已完成</span>}
      </div>
      {progress.feedback && (
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginTop: 14 }}>
          <p className="feedback" style={{ flex: 1, margin: 0 }}>{progress.feedback}</p>
          <button
            className="bubble-speaker-btn"
            onClick={() => speakMixed(progress.feedback).catch(() => {})}
            title="朗读评价"
            style={{ flexShrink: 0, marginTop: 2 }}
          >
            <Volume2 size={14} />
          </button>
        </div>
      )}
    </section>
  );
}

function WritingPractice({
  theme,
  progress,
  updateProgress,
  addReviewItems,
  addKnowledge,
}: {
  theme: DailyTheme;
  progress: AppState["progress"]["today"]["writing"];
  updateProgress: (progress: AppState["progress"]["today"]["writing"]) => void;
  addReviewItems: (items: Parameters<typeof makeReviewItem>[0][]) => void;
  addKnowledge: (entry: Parameters<typeof makeKnowledgeEntry>[0]) => void;
}) {
  const lesson = theme.writingLesson;
  const practicedCount = Math.min(progress.index + 1, DAILY_WRITING_TARGET);
  const canFinishWriting = progress.index >= DAILY_WRITING_TARGET - 1 && progress.checked;
  const currentPrompt = lesson.prompts[progress.index % lesson.prompts.length];

  // 3道拼词题 + 2道写作题（由主题ID确定性决定）
  const arrangeIndices = useMemo(() => getArrangeIndices(theme.id), [theme.id]);
  const isArrangeMode = arrangeIndices.has(progress.index);

  // 去掉标点后的单词数组（用于拼词）
  const answerTokens = useMemo(() => {
    return currentPrompt.answer.replace(/[.!?,;:]/g, "").split(/\s+/).filter(Boolean);
  }, [currentPrompt.answer]);

  // 加上索引后缀避免重复词冲突："I|0", "want|1"
  const indexedTokens = useMemo(
    () => answerTokens.map((w, i) => `${w}|${i}`),
    [answerTokens],
  );

  // 拼词模式本地状态
  const [arrangeSelected, setArrangeSelected] = useState<string[]>([]);
  const [arrangeAvailable, setArrangeAvailable] = useState<string[]>([]);
  const [wrongAttempts, setWrongAttempts] = useState(0);
  const [showHint, setShowHint] = useState(false);

  // 切题时重置拼词状态
  useEffect(() => {
    if (isArrangeMode) {
      setArrangeAvailable(shuffleArray([...indexedTokens]));
      setArrangeSelected([]);
      setWrongAttempts(0);
      setShowHint(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress.index]);

  const speakText = (text: string) => {
    speakBritish(text).catch(() => {});
  };

  const tokenLabel = (t: string) => t.split("|")[0];

  // --- 拼词模式操作 ---
  const selectToken = (token: string) => {
    setArrangeAvailable((prev) => {
      const idx = prev.indexOf(token);
      if (idx === -1) return prev;
      return [...prev.slice(0, idx), ...prev.slice(idx + 1)];
    });
    setArrangeSelected((prev) => [...prev, token]);
  };

  const deselectToken = (token: string, pos: number) => {
    setArrangeSelected((prev) => [...prev.slice(0, pos), ...prev.slice(pos + 1)]);
    setArrangeAvailable((prev) => [...prev, token]);
  };

  const clearArrange = () => {
    setArrangeAvailable((prev) => [...prev, ...arrangeSelected]);
    setArrangeSelected([]);
    updateProgress({ ...progress, feedback: "" });
  };

  const checkArrange = () => {
    if (arrangeSelected.length === 0) return;
    const assembled = arrangeSelected.map(tokenLabel).join(" ");
    const expected = normalize(currentPrompt.answer.replace(/[.!?,;:]/g, ""));
    const actual = normalize(assembled);

    if (actual === expected) {
      updateProgress({ ...progress, answer: assembled, feedback: currentPrompt.answer, checked: true });
      speakText(currentPrompt.answer);
      // 拼词正确：不记录到知识库（只记录需要巩固的错误内容）
    } else {
      const newWrong = wrongAttempts + 1;
      setWrongAttempts(newWrong);
      updateProgress({
        ...progress,
        feedback: `顺序还不对，再试试！${newWrong >= 2 ? '（可点「查看提示」）' : ''}`,
      });
    }
  };

  // --- 写作模式操作 ---
  const checkWrite = async () => {
    if (!progress.answer.trim()) return;
    updateProgress({ ...progress, feedback: "AI 正在检查..." });
    const result = await requestAiFeedback(
      "writing",
      progress.answer,
      `中文原文：${currentPrompt.zh}\n参考译文：${currentPrompt.answer}\n请判断用户的英文答案意思是否与中文一致，语法是否正确。如果有错误，明确指出哪里错了以及如何修改。`,
    );
    const correct = result.score >= 70;
    const feedback = correct
      ? `✅ 很好！${result.summary}${result.corrections.length ? " " + result.corrections.join(" ") : ""}`
      : `❌ 需要调整。${result.summary} ${result.corrections.join(" ")}`;
    // 无论 AI 评分高低，都解锁"下一句"按钮，让用户可以继续学习
    updateProgress({ ...progress, checked: true, feedback });
    // 只有写作不达标时才记录错误到知识库
    if (!correct) {
      addKnowledge({
        area: "writing",
        title: lesson.grammar,
        content: `中文：${currentPrompt.zh}\n你的答案：${progress.answer}`,
        correction: result.corrections.join(" "),
        example: currentPrompt.answer,
      });
      addReviewItems([
        {
          area: "writing",
          title: lesson.grammar,
          prompt: currentPrompt.zh,
          answer: currentPrompt.answer,
          note: lesson.tip,
          errorCount: 1,
          confidence: 2,
        },
      ]);
    }
  };

  const nextWritingQuestion = () => {
    if (progress.index < DAILY_WRITING_TARGET - 1) {
      updateProgress({ ...progress, index: progress.index + 1, answer: "", feedback: "", checked: false });
    } else {
      updateProgress({ ...progress, answer: "", feedback: "", checked: false });
    }
  };

  const hintText =
    wrongAttempts >= 1
      ? `提示：前 ${Math.min(2, answerTokens.length)} 个词是「${answerTokens.slice(0, Math.min(2, answerTokens.length)).join(" ")}」`
      : "";

  return (
    <section className="panel" style={{ overflow: "hidden" }}>
      {/* 进度条 */}
      <div className="vocab-progress-bar">
        <div
          className="vocab-progress-fill"
          style={{
            width: `${(practicedCount / DAILY_WRITING_TARGET) * 100}%`,
            background: "linear-gradient(90deg,#58cc02,#2f8a43)",
          }}
        />
      </div>

      <div className="section-title" style={{ marginTop: 14 }}>
        <h2>写作练习</h2>
        <span>
          今日 {practicedCount}/{DAILY_WRITING_TARGET} 句 · {isArrangeMode ? "🧩 拼词" : "✏️ 写作"}
        </span>
      </div>

      {/* 语法提示 */}
      <div className="tip-box" style={{ marginBottom: 16 }}>
        <strong>今日语法：{lesson.grammar}</strong>
        <p>{lesson.tip}</p>
      </div>

      {/* 中文题目卡片 */}
      <div className="writing-zh-card">
        <span className="writing-zh-label">翻译成英文</span>
        <p className="writing-zh-text">{currentPrompt.zh}</p>
      </div>

      {isArrangeMode ? (
        <>
          {/* 答案区域 */}
          <div className="writing-answer-area">
            {arrangeSelected.length === 0 && (
              <span className="writing-answer-placeholder">点击下方单词，拼出这个句子 ↓</span>
            )}
            {arrangeSelected.map((token, idx) => (
              <button
                key={`sel-${token}-${idx}`}
                className="writing-word-chip selected"
                onClick={() => !progress.checked && deselectToken(token, idx)}
                disabled={progress.checked}
              >
                {tokenLabel(token)}
              </button>
            ))}
          </div>

          <div className="writing-answer-divider" />

          {/* 词库 */}
          <div className="writing-word-bank">
            {arrangeAvailable.map((token, idx) => (
              <button
                key={`avail-${token}-${idx}`}
                className="writing-word-chip"
                onClick={() => !progress.checked && selectToken(token)}
                disabled={progress.checked}
              >
                {tokenLabel(token)}
              </button>
            ))}
            {arrangeAvailable.length === 0 && !progress.checked && (
              <span style={{ color: "#8fa98d", fontSize: 13 }}>所有单词已选，可以检查答案了</span>
            )}
          </div>

          {/* 提示 */}
          {wrongAttempts >= 1 && !progress.checked && (
            <div className="writing-hint-box">
              <button className="writing-hint-btn" onClick={() => setShowHint(!showHint)}>
                {showHint ? "隐藏提示" : "💡 查看提示"}
              </button>
              {showHint && <p className="writing-hint-text">{hintText}</p>}
            </div>
          )}

          {/* 错误反馈 */}
          {progress.feedback && !progress.checked && (
            <p className="feedback" style={{ borderLeftColor: "#cf5d3b", background: "#fff2ec" }}>
              {progress.feedback}
            </p>
          )}

          {/* 正确结果栏 */}
          {progress.checked && (
            <div className="vocab-result-bar correct-bar">
              <div className="vocab-result-content">
                <span className="vocab-result-icon">✅</span>
                <div>
                  <strong>太棒了！句子拼写正确！</strong>
                  <p className="vocab-result-detail">{currentPrompt.answer}</p>
                </div>
              </div>
              <div className="vocab-result-actions">
                {!canFinishWriting && (
                  <button className="primary vocab-continue-btn" onClick={nextWritingQuestion}>
                    继续
                  </button>
                )}
                {canFinishWriting && !progress.completed && (
                  <button className="primary vocab-continue-btn" onClick={() => updateProgress({ ...progress, completed: true })}>
                    <CheckCircle2 size={18} /> 完成今日练习
                  </button>
                )}
                {progress.completed && <span className="pill">写作练习已完成</span>}
              </div>
            </div>
          )}

          {/* 操作按钮 */}
          {!progress.checked && (
            <div className="actions">
              <button onClick={clearArrange} disabled={arrangeSelected.length === 0}>
                清空重排
              </button>
              <button className="primary" onClick={checkArrange} disabled={arrangeSelected.length === 0}>
                <CheckCircle2 size={18} /> 检查答案
              </button>
            </div>
          )}
        </>
      ) : (
        <>
          {/* 自由写作模式 */}
          <textarea
            value={progress.answer}
            onChange={(event) =>
              updateProgress({ ...progress, answer: event.target.value, checked: false })
            }
            placeholder="Write your English sentence here..."
            style={{ fontSize: 16 }}
          />

          {progress.feedback && (
            <p
              className="feedback"
              style={
                progress.checked
                  ? {}
                  : { borderLeftColor: "#cf5d3b", background: "#fff2ec" }
              }
            >
              {progress.feedback}
            </p>
          )}

          <div className="actions">
            <button
              onClick={nextWritingQuestion}
              disabled={!progress.checked || progress.index >= DAILY_WRITING_TARGET - 1}
            >
              下一句
            </button>
            <button className="primary" onClick={checkWrite} disabled={!progress.answer.trim()}>
              <BookOpen size={18} /> AI 检查写作
            </button>
            {canFinishWriting && !progress.completed && (
              <button className="primary" onClick={() => updateProgress({ ...progress, completed: true })}>
                <CheckCircle2 size={18} /> 完成今日练习
              </button>
            )}
            {progress.completed && <span className="pill">写作练习已完成</span>}
          </div>
        </>
      )}
    </section>
  );
}

function ReviewView({
  state,
  updateState,
}: {
  state: AppState;
  updateState: (next: AppState | ((current: AppState) => AppState)) => void;
}) {
  const [activeArea, setActiveArea] = useState<SkillArea>("vocabulary");

  const mark = (id: string, mastered: boolean) => {
    updateState((current) => ({
      ...current,
      reviewItems: current.reviewItems.map((item) => {
        if (item.id !== id) return item;
        const streak = mastered ? item.streak + 1 : 0;
        return {
          ...item,
          streak,
          confidence: clamp(item.confidence + (mastered ? 1 : -1), 1, 5),
          errorCount: item.errorCount + (mastered ? 0 : 1),
          status: streak >= 3 ? "mastered" : mastered ? "review" : "learning",
          updatedAt: new Date().toISOString(),
          nextReviewAt: mastered ? new Date(Date.now() + 2 * 86400000).toISOString() : new Date().toISOString(),
        };
      }),
    }));
  };

  const dueItems = useMemo(
    () => [...state.reviewItems].filter((item) => item.status !== "mastered"),
    [state.reviewItems],
  );

  const areaItems: Record<SkillArea, ReviewItem[]> = {
    vocabulary: dueItems.filter((item) => item.area === "vocabulary"),
    speaking: dueItems.filter((item) => item.area === "speaking"),
    writing: dueItems.filter((item) => item.area === "writing"),
  };

  const currentItems = areaItems[activeArea];

  return (
    <section className="panel">
      <div className="section-title">
        <h2>集中复习</h2>
        <span>{dueItems.length} 个待巩固项</span>
      </div>
      <p className="muted">
        按科目分类复习薄弱项。词汇和写作支持“开始练习”模式，口语可朗读参考答案。连续掌握 3 次自动归档。
      </p>

      {/* 科目分类标签 */}
      <div className="segmented">
        {(["vocabulary", "speaking", "writing"] as SkillArea[]).map((area) => (
          <button key={area} className={activeArea === area ? "active" : ""} onClick={() => setActiveArea(area)}>
            {areaLabels[area]}
            {areaItems[area].length > 0 && (
              <span
                style={{
                  marginLeft: 6,
                  fontSize: 11,
                  background: "#2f8a43",
                  color: "#fff",
                  borderRadius: 999,
                  padding: "1px 6px",
                  fontWeight: 700,
                }}
              >
                {areaItems[area].length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* 当前科目的复习列表 */}
      <div className="review-list">
        {currentItems.map((item) => (
          <ReviewCard key={item.id} item={item} mark={mark} />
        ))}
        {currentItems.length === 0 && (
          <div className="empty">{areaLabels[activeArea]}暂无待巩固项，继续加油！Great work!</div>
        )}
      </div>
    </section>
  );
}

// ─── 词汇复习练习（MCQ 选择题，与今日词汇互动同款）───
function VocabReviewPractice({
  item,
  mark,
  onClose,
}: {
  item: ReviewItem;
  mark: (id: string, mastered: boolean) => void;
  onClose: () => void;
}) {
  const parseNote = (note: string): { word: string; meaning: string } => {
    const eqIdx = note.indexOf(" = ");
    if (eqIdx === -1) return { word: item.title, meaning: note };
    return { word: note.slice(0, eqIdx).trim(), meaning: note.slice(eqIdx + 3).trim() };
  };
  const { word, meaning } = parseNote(item.note);
  const questionType: "en-to-cn" | "cn-to-en" = item.prompt.includes("中文意思") ? "en-to-cn" : "cn-to-en";
  const correctAnswer = questionType === "en-to-cn" ? meaning : word;

  const options = useMemo(() => {
    const pool = vocabularyCards.filter((c) => c.word !== word);
    const distractors = shuffleArray([...pool])
      .slice(0, 3)
      .map((c) => (questionType === "en-to-cn" ? c.meaning : c.word));
    return shuffleArray([correctAnswer, ...distractors]);
  }, [correctAnswer, questionType, word]);

  const [selected, setSelected] = useState("");
  const [answered, setAnswered] = useState(false);
  const isCorrect = answered && selected === correctAnswer;

  const speakWord = () => {
    speakBritish(word).catch(() => {});
  };

  const choose = (option: string) => {
    if (answered) return;
    setSelected(option);
    setAnswered(true);
    mark(item.id, option === correctAnswer);
  };

  return (
    <article className="review-card" style={{ border: "2px solid #73a66f", background: "#f8faf6", overflow: "hidden" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <span className="tag">{areaLabels[item.area]}</span>
        <button style={{ minHeight: "unset", padding: "4px 10px", fontSize: 12 }} onClick={onClose}>
          ✕ 关闭
        </button>
      </div>
      <p className="muted" style={{ marginBottom: 8 }}>
        {questionType === "en-to-cn" ? "这个英文单词是什么意思？" : "哪个英文单词对应这个中文？"}
      </p>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
        <h3 style={{ fontSize: 26, margin: 0, fontWeight: 800 }}>
          {questionType === "en-to-cn" ? word : meaning}
        </h3>
        {questionType === "en-to-cn" && (
          <button className="vocab-speaker-btn" onClick={speakWord} title="朗读" style={{ flexShrink: 0 }}>
            <Volume2 size={16} />
          </button>
        )}
      </div>
      <div className="vocab-options">
        {options.map((option, idx) => {
          let cls = "vocab-option";
          if (answered) {
            if (option === correctAnswer) cls += " show-correct";
            else if (option === selected) cls += " wrong";
          }
          return (
            <button
              key={option}
              className={cls}
              style={{ animationDelay: `${idx * 60}ms` }}
              onClick={() => choose(option)}
              disabled={answered}
            >
              {option}
            </button>
          );
        })}
      </div>
      {answered && (
        <div className={`vocab-result-bar ${isCorrect ? "correct-bar" : "wrong-bar"}`}>
          <div className="vocab-result-content">
            <span className="vocab-result-icon">{isCorrect ? "✅" : "❌"}</span>
            <div>
              <strong>{isCorrect ? "太棒了！" : "继续加油！"}</strong>
              <p className="vocab-result-detail">{item.note}</p>
            </div>
          </div>
          <div className="vocab-result-actions">
            <button className="primary vocab-continue-btn" onClick={onClose}>继续</button>
          </div>
        </div>
      )}
    </article>
  );
}

// ─── 写作复习练习（自由书写 + AI 检查，与今日写作练习同款）───
function WritingReviewPractice({
  item,
  mark,
  onClose,
}: {
  item: ReviewItem;
  mark: (id: string, mastered: boolean) => void;
  onClose: () => void;
}) {
  const [answer, setAnswer] = useState("");
  const [feedback, setFeedback] = useState("");
  const [checked, setChecked] = useState(false);

  const checkAnswer = async () => {
    if (!answer.trim()) return;
    setFeedback("AI 正在检查...");
    const result = await requestAiFeedback(
      "writing",
      answer,
      `中文参考：${item.prompt}\n正确参考答案：${item.answer}\n语法要点：${item.note}`,
    );
    const correct = result.score >= 70;
    setFeedback(
      correct
        ? `✅ 很好！${result.summary}${result.corrections.length ? " " + result.corrections.join(" ") : ""}`
        : `❌ 需要调整。${result.summary} ${result.corrections.join(" ")}`,
    );
    setChecked(true);
    mark(item.id, correct);
  };

  return (
    <article className="review-card" style={{ border: "2px solid #73a66f", background: "#f8faf6" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <span className="tag">{areaLabels[item.area]}</span>
        <button style={{ minHeight: "unset", padding: "4px 10px", fontSize: 12 }} onClick={onClose}>
          ✕ 关闭
        </button>
      </div>
      <div className="writing-zh-card">
        <span className="writing-zh-label">翻译成英文</span>
        <p className="writing-zh-text">{item.prompt}</p>
      </div>
      <textarea
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        placeholder="Write your English sentence here..."
        style={{ fontSize: 16, marginTop: 12 }}
        disabled={checked}
      />
      {feedback && (
        <p
          className="feedback"
          style={checked && feedback.startsWith("✅") ? {} : { borderLeftColor: "#cf5d3b", background: "#fff2ec" }}
        >
          {feedback}
        </p>
      )}
      {!checked && (
        <details style={{ marginTop: 10 }}>
          <summary style={{ cursor: "pointer", color: "#667461", fontSize: 13 }}>查看参考答案</summary>
          <p className="example" style={{ marginTop: 6 }}>{item.answer}</p>
        </details>
      )}
      <div className="actions">
        <button onClick={onClose} disabled={!checked}>完成</button>
        <button className="primary" onClick={checkAnswer} disabled={!answer.trim() || checked}>
          <BookOpen size={18} /> AI 检查
        </button>
      </div>
    </article>
  );
}

function ReviewCard({ item, mark }: { item: ReviewItem; mark: (id: string, mastered: boolean) => void }) {
  const [practiceMode, setPracticeMode] = useState(false);

  if (practiceMode && item.area === "vocabulary") {
    return <VocabReviewPractice item={item} mark={mark} onClose={() => setPracticeMode(false)} />;
  }
  if (practiceMode && item.area === "writing") {
    return <WritingReviewPractice item={item} mark={mark} onClose={() => setPracticeMode(false)} />;
  }

  const speakAnswer = () => {
    // 口语类条目可能含中英混合说明，用 speakMixed 智能分语种朗读
    speakMixed(item.answer).catch(() => {});
  };

  return (
    <article className="review-card">
      <span className="tag">{areaLabels[item.area]}</span>
      <h3>{item.title}</h3>
      <p>{item.prompt}</p>
      <div className="answer">
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
          <strong style={{ flex: 1 }}>{item.answer}</strong>
          <button className="bubble-speaker-btn" onClick={speakAnswer} title="朗读参考答案" style={{ flexShrink: 0, marginTop: 2 }}>
            <Volume2 size={14} />
          </button>
        </div>
        <span>{item.note}</span>
      </div>
      <div className="meta-row">
        <span>错误 {item.errorCount} 次</span>
        <span>掌握度 {item.confidence}/5</span>
        <span>连续掌握 {item.streak}/3</span>
      </div>
      <div className="actions">
        {(item.area === "vocabulary" || item.area === "writing") && (
          <button className="primary" onClick={() => setPracticeMode(true)}>
            🎯 开始练习
          </button>
        )}
        <button onClick={() => mark(item.id, false)}>仍需巩固</button>
        <button className={item.area === "speaking" ? "primary" : ""} onClick={() => mark(item.id, true)}>
          已掌握
        </button>
      </div>
    </article>
  );
}

function KnowledgeView({ state }: { state: AppState }) {
  const [filter, setFilter] = useState<"all" | SkillArea>("all");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    { role: "agent", text: "你好！我是英语学习助手 🎓 关于知识库里的错题，或者任何英语单词、语法、口语问题，都可以直接问我。" },
  ]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const chatBoxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (chatBoxRef.current) chatBoxRef.current.scrollTop = chatBoxRef.current.scrollHeight;
  }, [chatMessages.length]);

  // 只展示记录了错误的条目（过滤掉正确回答的内容）
  const correctSignals = ["本题回答正确。", "已通过。", "拼词正确。"];
  const errorEntries = useMemo(
    () =>
      state.knowledge.filter(
        (entry) =>
          entry.correction &&
          entry.correction.trim().length > 0 &&
          !correctSignals.includes(entry.correction),
      ),
    [state.knowledge],
  );

  const areaErrorCounts: Record<string, number> = {
    vocabulary: errorEntries.filter((e) => e.area === "vocabulary").length,
    speaking: errorEntries.filter((e) => e.area === "speaking").length,
    writing: errorEntries.filter((e) => e.area === "writing").length,
  };

  const entries = filter === "all" ? errorEntries : errorEntries.filter((e) => e.area === filter);

  const sendChat = async () => {
    if (!chatInput.trim() || chatLoading) return;
    const userMsg: ChatMessage = { role: "user", text: chatInput };
    const nextMessages = [...chatMessages, userMsg];
    setChatMessages(nextMessages);
    setChatInput("");
    setChatLoading(true);
    try {
      const reply = await requestAiReply(
        nextMessages,
        "你是专业的英语学习助手，帮助中国用户解答英语单词、语法、口语和写作方面的疑问。用中文解释，必要时用英文举例。回答要简洁实用。",
      );
      setChatMessages((prev) => [...prev, { role: "agent", text: reply }]);
    } catch {
      setChatMessages((prev) => [...prev, { role: "agent", text: "网络暂时不可用，请稍后再试。" }]);
    } finally {
      setChatLoading(false);
    }
  };

  return (
    <div style={{ display: "grid", gap: 18 }}>
      {/* 错题知识库 */}
      <section className="panel">
        <div className="section-title">
          <h2>错题知识库</h2>
          <span>{errorEntries.length} 条错误记录</span>
        </div>
        <p className="muted">根据词汇、口语、写作中的错误，由 AI 自动归纳的需要巩固的知识点。</p>
        <div className="segmented">
          {(["all", "vocabulary", "speaking", "writing"] as const).map((item) => (
            <button key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>
              {item === "all" ? "全部" : areaLabels[item]}
              {item !== "all" && areaErrorCounts[item] > 0 && (
                <span style={{ marginLeft: 5, fontSize: 11, background: "#cf5d3b", color: "#fff", borderRadius: 999, padding: "1px 6px", fontWeight: 700 }}>
                  {areaErrorCounts[item]}
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="knowledge-list">
          {entries.map((entry) => (
            <article className="knowledge-entry" key={entry.id} style={{ borderLeft: "3px solid #cf5d3b" }}>
              <span className="tag">{areaLabels[entry.area]}</span>
              <h3>{entry.title}</h3>
              <p>{entry.content}</p>
              {entry.correction && (
                <p className="correction" style={{ marginTop: 8 }}>
                  💡 {entry.correction}
                </p>
              )}
              {entry.example && (
                <p className="example" style={{ marginTop: 6 }}>
                  ✅ {entry.example}
                </p>
              )}
            </article>
          ))}
          {entries.length === 0 && (
            <div className="empty">
              {errorEntries.length === 0
                ? "暂无错题记录。完成今日学习后，答错的内容会自动汇总在这里。"
                : `${areaLabels[filter as SkillArea]}暂无错题记录，继续加油！`}
            </div>
          )}
        </div>
      </section>

      {/* AI 问答助手 */}
      <section className="panel">
        <div className="section-title">
          <h2>💬 AI 学习助手</h2>
          <span>随时解答英语疑问</span>
        </div>
        <div className="chat-box" ref={chatBoxRef} style={{ height: 280 }}>
          {chatMessages.map((msg, idx) => (
            <div key={idx} className={`bubble ${msg.role}`}>
              {msg.role === "agent" ? (
                <span className="bubble-agent-content">
                  <span className="bubble-agent-text">{msg.text}</span>
                  <button
                    className="bubble-speaker-btn"
                    onClick={() => speakMixed(msg.text).catch(() => {})}
                    title="朗读（普通话 + 英式发音）"
                  >
                    <Volume2 size={14} />
                  </button>
                </span>
              ) : (
                msg.text
              )}
            </div>
          ))}
          {chatLoading && (
            <div className="bubble agent" style={{ fontStyle: "italic", color: "#667461" }}>
              AI 正在思考...
            </div>
          )}
        </div>
        <div className="input-row" style={{ marginTop: 10 }}>
          <input
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); } }}
            placeholder="问我任何英语问题..."
            style={{ fontSize: 16 }}
          />
          <button className="icon primary" onClick={sendChat} disabled={!chatInput.trim() || chatLoading} title="发送">
            <Send size={18} />
          </button>
        </div>
      </section>
    </div>
  );
}

function ReportsView({ state }: { state: AppState }) {
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth()); // 0-indexed
  const [selectedDate, setSelectedDate] = useState<string | null>(
    state.dailyReports[0]?.date ?? null,
  );

  // date → report 的快速查找
  const reportDateMap = useMemo(() => {
    const map = new Map<string, (typeof state.dailyReports)[0]>();
    for (const report of state.dailyReports) {
      map.set(report.date, report);
    }
    return map;
  }, [state.dailyReports]);

  const selectedReport = selectedDate ? (reportDateMap.get(selectedDate) ?? null) : null;

  // 当月日历格子（null = 空白占位）
  const calendarDays = useMemo(() => {
    const firstDay = new Date(viewYear, viewMonth, 1);
    const lastDay = new Date(viewYear, viewMonth + 1, 0);
    const startDow = firstDay.getDay(); // 0=周日
    const days: (number | null)[] = [];
    for (let i = 0; i < startDow; i++) days.push(null);
    for (let d = 1; d <= lastDay.getDate(); d++) days.push(d);
    while (days.length % 7 !== 0) days.push(null);
    return days;
  }, [viewYear, viewMonth]);

  const todayStr = today.toISOString().slice(0, 10);
  const monthNames = ["1月","2月","3月","4月","5月","6月","7月","8月","9月","10月","11月","12月"];
  const weekDays = ["日","一","二","三","四","五","六"];

  const prevMonth = () => {
    if (viewMonth === 0) { setViewYear((y) => y - 1); setViewMonth(11); }
    else setViewMonth((m) => m - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewYear((y) => y + 1); setViewMonth(0); }
    else setViewMonth((m) => m + 1);
  };
  const isCurrentMonth = viewYear === today.getFullYear() && viewMonth === today.getMonth();

  const formatDate = (dateStr: string): string => {
    if (dateStr === todayStr) return "今天";
    const yest = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    if (dateStr === yest) return "昨天";
    const d = new Date(dateStr + "T00:00:00");
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  };

  return (
    <div style={{ display: "grid", gap: 18 }}>
      {/* 日历面板 */}
      <section className="panel">
        <div className="section-title">
          <h2>我的学习报告</h2>
          <span>{state.dailyReports.length} 份</span>
        </div>

        {/* 月份导航 */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
          <button onClick={prevMonth} style={{ minHeight: "unset", padding: "6px 16px", fontSize: 15 }}>‹</button>
          <strong style={{ fontSize: 17, color: "#172018" }}>
            {viewYear}年 {monthNames[viewMonth]}
          </strong>
          <button onClick={nextMonth} style={{ minHeight: "unset", padding: "6px 16px", fontSize: 15 }} disabled={isCurrentMonth}>›</button>
        </div>

        {/* 周标题 */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, marginBottom: 6 }}>
          {weekDays.map((d) => (
            <div key={d} style={{ textAlign: "center", fontSize: 12, color: "#667461", fontWeight: 700, padding: "2px 0" }}>
              {d}
            </div>
          ))}
        </div>

        {/* 日期格子 */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
          {calendarDays.map((day, idx) => {
            if (day === null) return <div key={`gap-${idx}`} style={{ aspectRatio: "1" }} />;
            const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
            const hasReport = reportDateMap.has(dateStr);
            const isToday = dateStr === todayStr;
            const isSelected = dateStr === selectedDate && hasReport;
            const isFuture = dateStr > todayStr;
            return (
              <button
                key={dateStr}
                onClick={() => hasReport && setSelectedDate(dateStr)}
                disabled={!hasReport || isFuture}
                style={{
                  position: "relative",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "8px 2px",
                  minHeight: "unset",
                  aspectRatio: "1",
                  borderRadius: 10,
                  fontSize: 14,
                  fontWeight: isToday || isSelected ? 700 : 400,
                  background: isSelected
                    ? "#2f8a43"
                    : isToday
                      ? "#eef8ec"
                      : hasReport
                        ? "#f3fbf2"
                        : "transparent",
                  color: isSelected ? "#fff" : isFuture ? "#ccc" : "#172018",
                  borderColor: isSelected ? "#2f8a43" : isToday ? "#b8dcb7" : hasReport ? "#c8e6c5" : "transparent",
                  cursor: hasReport ? "pointer" : "default",
                  opacity: isFuture ? 0.35 : 1,
                }}
              >
                {day}
                {hasReport && (
                  <span
                    style={{
                      display: "block",
                      width: 5,
                      height: 5,
                      borderRadius: "50%",
                      background: isSelected ? "rgba(255,255,255,0.8)" : "#2f8a43",
                      marginTop: 2,
                      flexShrink: 0,
                    }}
                  />
                )}
              </button>
            );
          })}
        </div>

        {/* 图例 */}
        <div style={{ display: "flex", gap: 16, marginTop: 16, fontSize: 12, color: "#667461", flexWrap: "wrap" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#2f8a43", display: "inline-block" }} />
            有学习报告（可点击）
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 12, height: 12, borderRadius: 4, background: "#eef8ec", border: "1px solid #b8dcb7", display: "inline-block" }} />
            今天
          </span>
        </div>

        {state.dailyReports.length === 0 && (
          <div className="empty" style={{ marginTop: 16 }}>完成今日学习后，Agent 会在这里生成你的专属学习报告。</div>
        )}
      </section>

      {/* 报告详情（点击日期后展示） */}
      {selectedReport && (
        <section className="panel">
          <div className="section-title">
            <h2>📅 {formatDate(selectedReport.date)}</h2>
            <span>{selectedReport.date}</span>
          </div>
          <div className="result-box" style={{ marginBottom: 20 }}>
            <p style={{ lineHeight: 1.7 }}>{selectedReport.summary}</p>
            <p style={{ marginTop: 10, color: "#2f8a43", fontWeight: 600 }}>{selectedReport.encouragement}</p>
          </div>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: "#255f32", margin: "0 0 10px" }}>✅ 掌握较好</h3>
          <div style={{ display: "grid", gap: 6, marginBottom: 18 }}>
            {selectedReport.strengths.map((item) => (
              <p key={item} className="example" style={{ margin: 0, padding: "8px 12px", background: "#eef8ec", borderRadius: 8 }}>
                {item}
              </p>
            ))}
          </div>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: "#9a3e24", margin: "0 0 10px" }}>📌 仍需提升</h3>
          <div style={{ display: "grid", gap: 6, marginBottom: 18 }}>
            {selectedReport.weaknesses.map((item) => (
              <p key={item} className="correction" style={{ margin: 0, padding: "8px 12px", background: "#fff2ec", borderRadius: 8 }}>
                {item}
              </p>
            ))}
          </div>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: "#172018", margin: "0 0 10px" }}>🗓 下一步计划</h3>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {selectedReport.nextPlan.map((item) => (
              <span className="pill" key={item}>{item}</span>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

declare global {
  type SpeechRecognitionConstructor = new () => {
    lang: string;
    interimResults: boolean;
    continuous: boolean;
    maxAlternatives: number;
    onstart: (() => void) | null;
    onend: (() => void) | null;
    onerror: (() => void) | null;
    onresult: ((event: {
      resultIndex: number;
      results: { length: number; [index: number]: { isFinal: boolean; [index: number]: { transcript: string } } };
    }) => void) | null;
    start: () => void;
    stop: () => void;
  };

  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}
