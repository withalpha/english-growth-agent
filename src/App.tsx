import { useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  Library,
  Mic,
  RotateCcw,
  Send,
  Sparkles,
  Target,
  Volume2,
} from "lucide-react";
import { areaLabels, dailyThemes, vocabularyCards } from "./data";
import { generateDailyReport, requestAiFeedback, requestAiReply, requestTts } from "./ai";
import { getCurrentUser, getTodayKey, loadState, loadStateFromCloud, makeDailyReport, makeKnowledgeEntry, makeReviewItem, saveState, saveStateToCloud } from "./storage";
import type { AppState, ChatMessage, ReviewItem, SkillArea } from "./types";

type Tab = "today" | "diagnosis" | "review" | "knowledge" | "reports";
type DailyTheme = (typeof dailyThemes)[number];
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

const getDayIndex = () => Math.floor(new Date(getTodayKey()).getTime() / 86400000);

const getTodayTheme = () => dailyThemes[getDayIndex() % dailyThemes.length];

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
  useEffect(() => {
    let cancelled = false;
    Promise.all([getCurrentUser(), loadStateFromCloud()]).then(([user, cloudState]) => {
      if (cancelled) return;
      setCurrentUser(user);
      if (cloudState) {
        // 云端有数据：以云端为准并更新本地缓存
        setState(cloudState);
        saveState(cloudState);
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
    updateState((current) => {
      const today = getTodayKey();
      const streakDays = current.lastStudyDate === today ? current.streakDays : current.streakDays + 1;
      const otherReports = current.dailyReports.filter((item) => item.date !== today);
      return { ...current, lastStudyDate: today, streakDays, dailyReports: [makeDailyReport(report), ...otherReports] };
    });
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
          <div style={{ padding: "10px 16px", borderRadius: 8, background: "#1a2e1e", border: "1px solid #3a4e3c" }}>
            <span style={{ color: "#b8c8b6", fontSize: 12, display: "block" }}>当前用户</span>
            <strong style={{ display: "block", fontSize: 13, marginTop: 4, color: "#e8f0e5", wordBreak: "break-all" }}>
              {currentUser.email}
            </strong>
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
}: {
  state: AppState;
  addReviewItems: (items: Parameters<typeof makeReviewItem>[0][]) => void;
  addKnowledge: (entry: Parameters<typeof makeKnowledgeEntry>[0]) => void;
  completeStudy: () => Promise<void>;
  updateProgress: (progress: AppState["progress"] | ((current: AppState["progress"]) => AppState["progress"])) => void;
}) {
  const [reporting, setReporting] = useState(false);
  const theme = getTodayTheme();
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
  const pathStatuses: PathStatus[] = [
    todayProgress.vocabulary.completed ? "completed" : "current",
    todayProgress.vocabulary.completed ? (todayProgress.speaking.completed ? "completed" : "current") : "locked",
    todayProgress.speaking.completed ? (todayProgress.writing.completed ? "completed" : "current") : "locked",
    reviewUnlocked ? "current" : "locked",
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
        // Fallback: Web Speech API for local file usage
        const utterance = new SpeechSynthesisUtterance(card.word);
        utterance.lang = "en-US";
        utterance.rate = 0.85;
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
    // Fallback: Web Speech API (works locally)
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(word);
      utterance.lang = "en-US";
      utterance.rate = 0.85;
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
    addKnowledge({
      area: "vocabulary",
      title: card.word,
      content: `${card.word} = ${card.meaning}`,
      correction: correct ? "本题回答正确。" : `用户选择了 ${option}，正确答案是 ${correctAnswer}。`,
      example: card.example,
    });
    if (!correct) {
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
                disabled={progress.index >= DAILY_VOCABULARY_TARGET - 1}
              >
                继续
              </button>
            )}
            {canUnlockSpeaking && !progress.completed && (
              <button
                className="primary vocab-continue-btn"
                onClick={() => updateProgress({ ...progress, completed: true })}
              >
                <CheckCircle2 size={18} /> 进入口语陪练
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

  // ── TTS helpers ──
  const speakText = (text: string) => {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    utterance.rate = 0.9;
    window.speechSynthesis.speak(utterance);
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
    addKnowledge({
      area: "speaking",
      title: scenario.title,
      content: userText || "本轮暂无用户英语回答。",
      correction: result.corrections.join(" "),
      example: "I usually relax at home because it helps me recharge.",
    });
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
      {progress.feedback && <p className="feedback">{progress.feedback}</p>}
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
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    utterance.rate = 0.9;
    window.speechSynthesis.speak(utterance);
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
      addKnowledge({
        area: "writing",
        title: lesson.grammar,
        content: `中文：${currentPrompt.zh}\n正确答案：${currentPrompt.answer}`,
        correction: "拼词正确。",
        example: currentPrompt.answer,
      });
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
    updateProgress({ ...progress, checked: correct, feedback });
    addKnowledge({
      area: "writing",
      title: lesson.grammar,
      content: `中文：${currentPrompt.zh}\n你的答案：${progress.answer}`,
      correction: result.corrections.join(" ") || "已通过。",
      example: currentPrompt.answer,
    });
    if (!correct) {
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
  const dueItems = useMemo(
    () =>
      [...state.reviewItems]
        .filter((item) => item.status !== "mastered")
        .sort((a, b) => b.errorCount + (5 - b.confidence) - (a.errorCount + (5 - a.confidence))),
    [state.reviewItems],
  );

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

  return (
    <section className="panel">
      <div className="section-title">
        <h2>集中复习总结</h2>
        <span>{dueItems.length} 个待巩固项</span>
      </div>
      <p className="muted">如果你仍然不熟悉，点“仍需巩固”，它会继续出现在下次集中复习里，直到你连续掌握。</p>
      <div className="review-list">
        {dueItems.map((item) => (
          <ReviewCard item={item} key={item.id} mark={mark} />
        ))}
        {dueItems.length === 0 && <div className="empty">今天没有高优先级复习项。Great work!</div>}
      </div>
    </section>
  );
}

function ReviewCard({ item, mark }: { item: ReviewItem; mark: (id: string, mastered: boolean) => void }) {
  const [showAnswer, setShowAnswer] = useState(false);
  return (
    <article className="review-card">
      <span className="tag">{areaLabels[item.area]}</span>
      <h3>{item.title}</h3>
      <p>{item.prompt}</p>
      {showAnswer && (
        <div className="answer">
          <strong>{item.answer}</strong>
          <span>{item.note}</span>
        </div>
      )}
      <div className="meta-row">
        <span>错误 {item.errorCount} 次</span>
        <span>掌握度 {item.confidence}/5</span>
        <span>连续掌握 {item.streak}/3</span>
      </div>
      <div className="actions">
        <button onClick={() => setShowAnswer(!showAnswer)}>{showAnswer ? "隐藏答案" : "查看答案"}</button>
        <button onClick={() => mark(item.id, false)}>仍需巩固</button>
        <button className="primary" onClick={() => mark(item.id, true)}>
          已掌握
        </button>
      </div>
    </article>
  );
}

function KnowledgeView({ state }: { state: AppState }) {
  const [filter, setFilter] = useState<"all" | SkillArea>("all");
  const entries = filter === "all" ? state.knowledge : state.knowledge.filter((entry) => entry.area === filter);
  return (
    <section className="panel">
      <div className="section-title">
        <h2>自动知识库</h2>
        <span>{state.knowledge.length} 条记录</span>
      </div>
      <div className="segmented">
        {(["all", "vocabulary", "speaking", "writing"] as const).map((item) => (
          <button className={filter === item ? "active" : ""} onClick={() => setFilter(item)} key={item}>
            {item === "all" ? "全部" : areaLabels[item]}
          </button>
        ))}
      </div>
      <div className="knowledge-list">
        {entries.map((entry) => (
          <article className="knowledge-entry" key={entry.id}>
            <span className="tag">{areaLabels[entry.area]}</span>
            <h3>{entry.title}</h3>
            <p>{entry.content}</p>
            {entry.correction && <p className="correction">{entry.correction}</p>}
            {entry.example && <p className="example">{entry.example}</p>}
          </article>
        ))}
        {entries.length === 0 && <div className="empty">完成练习后，这里会自动沉淀你的词汇、错句和语法点。</div>}
      </div>
    </section>
  );
}

function ReportsView({ state }: { state: AppState }) {
  const latestReport = state.dailyReports[0];
  return (
    <section className="panel">
      <div className="section-title">
        <h2>我的学习报告</h2>
        <span>{state.dailyReports.length} 份报告</span>
      </div>
      {!latestReport && <div className="empty">完成今日学习后，Agent 会在这里生成你的专属学习报告。</div>}
      {latestReport && (
        <div className="result-box">
          <strong>当前学习状态</strong>
          <p>{latestReport.summary}</p>
          <p>{latestReport.encouragement}</p>
        </div>
      )}
      <div className="knowledge-list">
        {state.dailyReports.map((report) => (
          <article className="knowledge-entry" key={report.id}>
            <span className="tag">{report.date}</span>
            <h3>今日学习总结</h3>
            <p>{report.summary}</p>
            <h3>掌握较好</h3>
            {report.strengths.map((item) => (
              <p className="example" key={item}>
                {item}
              </p>
            ))}
            <h3>仍需提升</h3>
            {report.weaknesses.map((item) => (
              <p className="correction" key={item}>
                {item}
              </p>
            ))}
            <h3>之后计划</h3>
            {report.nextPlan.map((item) => (
              <span className="pill" key={item}>
                {item}
              </span>
            ))}
            <p className="feedback">{report.encouragement}</p>
          </article>
        ))}
      </div>
    </section>
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
