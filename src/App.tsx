import { useEffect, useMemo, useState } from "react";
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
} from "lucide-react";
import { areaLabels, dailyThemes, vocabularyCards } from "./data";
import { generateDailyReport, requestAiFeedback, requestAiReply } from "./ai";
import { getTodayKey, loadState, makeDailyReport, makeKnowledgeEntry, makeReviewItem, saveState } from "./storage";
import type { AppState, ChatMessage, ReviewItem, SkillArea } from "./types";

type Tab = "today" | "diagnosis" | "review" | "knowledge" | "reports";
type DailyTheme = (typeof dailyThemes)[number];

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const normalize = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const hasOnlyChineseEnglish = (text: string) => /^[\u4e00-\u9fa5a-zA-Z0-9\s.,!?'"():;，。！？、：；《》“”‘’+\-/]*$/.test(text);

const DAILY_VOCABULARY_TARGET = 20;
const DAILY_SPEAKING_TARGET = 5;
const DAILY_WRITING_TARGET = 5;

const todayPlan = [
  { title: "词汇互动", target: "20 个单词", description: "学习单词含义、例句和真实使用方法" },
  { title: "口语陪练", target: "5 句话", description: "跟读、改写并用完整句开口表达" },
  { title: "写作练习", target: "5 句话", description: "中文翻译成英文，检查语法和自然表达" },
  { title: "集中复习总结", target: "薄弱项复盘", description: "复盘错词、错句和语法问题，没掌握继续滚动复习" },
];

const getDayIndex = () => Math.floor(new Date(getTodayKey()).getTime() / 86400000);

const getTodayTheme = () => dailyThemes[getDayIndex() % dailyThemes.length];

const resetTodayProgressForTheme = (theme: DailyTheme) => ({
  date: getTodayKey(),
  themeId: theme.id,
  vocabulary: { index: 0, selected: "", feedback: "", answered: false },
  speaking: { messages: [{ role: "agent" as const, text: theme.speaking.opener }], input: "", feedback: "" },
  writing: { index: 0, answer: "", feedback: "", checked: false },
});

const diagnosisSpeakingPrompts = [
  "Please introduce yourself in one sentence.",
  "What do you usually do after work? Answer in one sentence.",
  "Why do you want to learn English? Answer in one sentence.",
];

export function App() {
  const [state, setState] = useState<AppState>(() => loadState());
  const [activeTab, setActiveTab] = useState<Tab>("today");

  useEffect(() => saveState(state), [state]);

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
            <span>20分钟日常交流训练</span>
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
        <span>线上由 Cloudflare Secret 调用模型，不在浏览器保存密钥；不可用时自动离线练习。</span>
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
  const todayProgress =
    state.progress.today.date === getTodayKey() && state.progress.today.themeId === theme.id
      ? state.progress.today
      : resetTodayProgressForTheme(theme);

  useEffect(() => {
    if (state.progress.today.date !== getTodayKey() || state.progress.today.themeId !== theme.id) {
      updateProgress((progress) => ({ ...progress, today: resetTodayProgressForTheme(theme) }));
    }
  }, [state.progress.today.date, state.progress.today.themeId, theme, updateProgress]);
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
          {todayPlan.map((item) => (
            <div className="path-node" key={item.title}>
              <div className="node-dot" />
              <strong>{item.title}</strong>
              <span>{item.target}</span>
              <p>{item.description}</p>
            </div>
          ))}
        </div>
      </section>
      <VocabularyPractice
        theme={theme}
        progress={todayProgress.vocabulary}
        updateProgress={(next) =>
          updateProgress((current) => ({ ...current, today: { ...todayProgress, vocabulary: next } }))
        }
        state={state}
        addReviewItems={addReviewItems}
        addKnowledge={addKnowledge}
      />
      <SpeakingPractice
        theme={theme}
        progress={todayProgress.speaking}
        updateProgress={(next) => updateProgress((current) => ({ ...current, today: { ...todayProgress, speaking: next } }))}
        state={state}
        addReviewItems={addReviewItems}
        addKnowledge={addKnowledge}
      />
      <WritingPractice
        theme={theme}
        progress={todayProgress.writing}
        updateProgress={(next) => updateProgress((current) => ({ ...current, today: { ...todayProgress, writing: next } }))}
        state={state}
        addReviewItems={addReviewItems}
        addKnowledge={addKnowledge}
      />
      <section className="panel wide">
        <div className="section-title">
          <h2>完成今日学习</h2>
          <span>轻量打卡</span>
        </div>
        <p className="muted">完成练习后点这里，Agent 会评价今天的学习情况，生成学习报告，并根据薄弱项调整之后的计划。</p>
        <button className="primary full" onClick={handleComplete} disabled={reporting}>
          <CheckCircle2 size={18} /> {reporting ? "正在生成今日报告..." : "我完成了今天的学习"}
        </button>
      </section>
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
        strengths: [`词汇诊断正确率 ${vocabScore}%。`, "已经完成口语短答输入，具备开始日常表达训练的基础。"],
        weaknesses: feedback.corrections,
        plan: [
          "第1-2周：高频生活词汇 + 完整句回答。",
          "第3-4周：常见场景口语 + want to, usually, because 等句型。",
          "第5-6周：集中复习薄弱词句，写作从短句到小段落。",
          "第7-8周：模拟真实日常对话，提升自然度和准确度。",
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
      setDiagnosisProgress({ vocabFeedback: "请只使用中文或英语继续。Please use Chinese or English only." });
      return;
    }
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
        <span>20道词汇选择 + 3道口语短答</span>
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
          <button
            className="primary full"
            onClick={saveSpeakingAnswer}
            disabled={diagnosisProgress.speakingAnswers.length >= diagnosisSpeakingPrompts.length}
          >
            保存本题回答
          </button>
          {diagnosisProgress.speakingAnswers.map((answer, idx) => (
            <p className="example" key={`${answer}-${idx}`}>{idx + 1}. {answer}</p>
          ))}
        </div>
      </div>
      <div className="report-bars">
        <div>
          <span>词汇正确率</span>
          <div className="bar"><i style={{ width: `${Math.round((diagnosisProgress.vocabCorrect / DAILY_VOCABULARY_TARGET) * 100)}%` }} /></div>
        </div>
        <div>
          <span>口语完成度</span>
          <div className="bar"><i style={{ width: `${Math.round((diagnosisProgress.speakingAnswers.length / diagnosisSpeakingPrompts.length) * 100)}%` }} /></div>
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
      {state.diagnosis.completed && (
        <div className="result-box">
          <strong>当前水平</strong>
          <p>词汇：{state.diagnosis.vocabularyLevel}</p>
          <p>口语：{state.diagnosis.speakingLevel}</p>
          <p>写作：{state.diagnosis.writingLevel}</p>
          {state.diagnosis.plan.map((item) => (
            <span className="pill" key={item}>
              {item}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

function VocabularyPractice({
  theme,
  progress,
  updateProgress,
  state,
  addReviewItems,
  addKnowledge,
}: {
  theme: DailyTheme;
  progress: AppState["progress"]["today"]["vocabulary"];
  updateProgress: (progress: AppState["progress"]["today"]["vocabulary"]) => void;
  state: AppState;
  addReviewItems: (items: Parameters<typeof makeReviewItem>[0][]) => void;
  addKnowledge: (entry: Parameters<typeof makeKnowledgeEntry>[0]) => void;
}) {
  const cards = theme.vocabulary;
  const card = cards[progress.index % cards.length];
  const questionType = progress.index % 2 === 0 ? "en-to-cn" : "cn-to-en";
  const learnedCount = Math.min(progress.index + 1, DAILY_VOCABULARY_TARGET);
  const correctAnswer = questionType === "en-to-cn" ? card.meaning : card.word;
  const options = useMemo(() => {
    const pool = cards
      .filter((item) => item.word !== card.word)
      .slice(progress.index + 1)
      .concat(cards.filter((item) => item.word !== card.word));
    const wrong = pool.slice(0, 3).map((item) => (questionType === "en-to-cn" ? item.meaning : item.word));
    return [correctAnswer, ...wrong].sort((a, b) => a.localeCompare(b));
  }, [card.meaning, card.word, cards, correctAnswer, progress.index, questionType]);

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
      ? `答对了。${card.word} 的意思是「${card.meaning}」。${card.example}`
      : `这题需要巩固。正确答案是「${correctAnswer}」。${result.summary}`;
    updateProgress({ ...progress, selected: option, answered: true, feedback: nextFeedback });
    addKnowledge({
      area: "vocabulary",
      title: card.word,
      content: `${card.word} = ${card.meaning}`,
      correction: correct ? "本题回答正确。" : `用户选择了「${option}」，正确答案是「${correctAnswer}」。`,
      example: card.example,
    });
    if (!correct) {
      addReviewItems([
        {
          area: "vocabulary",
          title: card.word,
          prompt: questionType === "en-to-cn" ? `选择 ${card.word} 的中文意思。` : `选择「${card.meaning}」对应的英文单词。`,
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
      updateProgress({ index: progress.index + 1, selected: "", feedback: "", answered: false });
      return;
    }
    updateProgress({ ...progress, selected: "", feedback: "", answered: false });
  };

  return (
    <section className="panel">
      <div className="section-title">
        <h2>词汇互动</h2>
        <span>{theme.domain}主题 {learnedCount}/{DAILY_VOCABULARY_TARGET} 题</span>
      </div>
      <div className="word-card">
        <strong>{questionType === "en-to-cn" ? card.word : card.meaning}</strong>
        <span>{questionType === "en-to-cn" ? "请选择对应的中文意思" : "请选择对应的英文单词"}</span>
      </div>
      <div className="choice-grid">
        {options.map((option) => (
          <button
            className={progress.answered && option === correctAnswer ? "choice correct" : progress.answered && option === progress.selected ? "choice wrong" : "choice"}
            onClick={() => choose(option)}
            key={option}
          >
            {option}
          </button>
        ))}
      </div>
      <div className="actions">
        <button className="primary" onClick={nextQuestion} disabled={!progress.answered || progress.index >= DAILY_VOCABULARY_TARGET - 1}>
          <CheckCircle2 size={18} /> 下一题
        </button>
      </div>
      {progress.feedback && <p className="feedback">{progress.feedback}</p>}
    </section>
  );
}

function SpeakingPractice({
  theme,
  progress,
  updateProgress,
  state,
  addReviewItems,
  addKnowledge,
}: {
  theme: DailyTheme;
  progress: AppState["progress"]["today"]["speaking"];
  updateProgress: (progress: AppState["progress"]["today"]["speaking"]) => void;
  state: AppState;
  addReviewItems: (items: Parameters<typeof makeReviewItem>[0][]) => void;
  addKnowledge: (entry: Parameters<typeof makeKnowledgeEntry>[0]) => void;
}) {
  const scenario = theme.speaking;
  const [listening, setListening] = useState(false);
  const userTurns = progress.messages.filter((message) => message.role === "user").length;

  const resetScenario = () => {
    updateProgress({ messages: [{ role: "agent", text: scenario.opener }], input: "", feedback: "" });
  };

  const send = async () => {
    if (!progress.input.trim()) return;
    if (!hasOnlyChineseEnglish(progress.input)) {
      updateProgress({ ...progress, feedback: "请只使用中文或英语继续。Please use Chinese or English only." });
      return;
    }
    const nextMessages: ChatMessage[] = [...progress.messages, { role: "user", text: progress.input }];
    updateProgress({ ...progress, messages: nextMessages, input: "" });
    const turnCount = nextMessages.filter((message) => message.role === "user").length;
    const reply =
      turnCount >= DAILY_SPEAKING_TARGET
        ? "这个小话题先到这里。You did it. 我们现在做一个简短评价。"
        : await requestAiReply(nextMessages, `${scenario.title}。请主动引导用户，最多5句内结束本话题。`);
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
      content: userText || "本轮暂无用户英文回答。",
      correction: result.corrections.join(" "),
      example: "I usually relax at home because it helps me recharge.",
    });
  };

  const nextTopic = () => {
    updateProgress({ messages: [{ role: "agent", text: scenario.opener }], input: "", feedback: "" });
  };

  const startSpeech = () => {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      updateProgress({ ...progress, feedback: "当前浏览器不支持语音识别，请使用文字输入。" });
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.onstart = () => setListening(true);
    recognition.onend = () => setListening(false);
    recognition.onresult = (event) => {
      updateProgress({ ...progress, input: event.results[0][0].transcript });
    };
    recognition.start();
  };

  return (
    <section className="panel">
      <div className="section-title">
        <h2>口语陪练</h2>
        <span>{scenario.title}：{Math.min(userTurns, DAILY_SPEAKING_TARGET)}/{DAILY_SPEAKING_TARGET} 句</span>
      </div>
      <div className="tip-box">
        <strong>本段对话主题：{scenario.title}</strong>
        <p>{scenario.goal}</p>
        <p>Agent 会引导你练习，本话题最多 5 句内结束，然后给你评价和巩固建议。</p>
      </div>
      <div className="chat-box">
        {progress.messages.map((message, idx) => (
          <div className={`bubble ${message.role}`} key={`${message.role}-${idx}`}>
            {message.text}
          </div>
        ))}
      </div>
      <div className="input-row">
        <button className={listening ? "active icon" : "icon"} onClick={startSpeech} title="语音输入">
          <Mic size={18} />
        </button>
        <input value={progress.input} onChange={(event) => updateProgress({ ...progress, input: event.target.value })} placeholder="Type or speak in English..." />
        <button className="icon primary" onClick={send} title="发送">
          <Send size={18} />
        </button>
      </div>
      <div className="actions">
        <button onClick={resetScenario}>重新开始本话题</button>
        <button onClick={nextTopic}>重新练习</button>
        <button onClick={() => finish()}>结束并评价</button>
      </div>
      {progress.feedback && <p className="feedback">{progress.feedback}</p>}
    </section>
  );
}

function WritingPractice({
  theme,
  progress,
  updateProgress,
  state,
  addReviewItems,
  addKnowledge,
}: {
  theme: DailyTheme;
  progress: AppState["progress"]["today"]["writing"];
  updateProgress: (progress: AppState["progress"]["today"]["writing"]) => void;
  state: AppState;
  addReviewItems: (items: Parameters<typeof makeReviewItem>[0][]) => void;
  addKnowledge: (entry: Parameters<typeof makeKnowledgeEntry>[0]) => void;
}) {
  const lesson = theme.writingLesson;
  const prompt = lesson.prompts[progress.index % lesson.prompts.length];
  const practicedCount = Math.min(progress.index + 1, DAILY_WRITING_TARGET);

  const check = async () => {
    if (!hasOnlyChineseEnglish(progress.answer)) {
      updateProgress({ ...progress, feedback: "请只使用中文或英语继续。Please use Chinese or English only." });
      return;
    }
    const expected = normalize(prompt.answer);
    const actual = normalize(progress.answer);
    const close = actual === expected || expected.split(" ").filter((word) => actual.includes(word)).length >= 4;
    const result = await requestAiFeedback("writing", progress.answer, `正确参考：${prompt.answer}`);
    const nextFeedback = close
      ? `写得不错。${result.summary} 参考表达：${prompt.answer}`
      : `别着急，这里我们慢慢修。参考写法是：${prompt.answer}。你可以重点检查动词结构、语序和介词。${result.corrections.join(" ")}`;
    updateProgress({ ...progress, checked: true, feedback: nextFeedback });
    addKnowledge({
      area: "writing",
      title: lesson.grammar,
      content: `中文：${prompt.zh}\n你的答案：${progress.answer}`,
      correction: `参考：${prompt.answer}`,
      example: prompt.answer,
    });
    if (!close) {
      addReviewItems([
        {
          area: "writing",
          title: lesson.grammar,
          prompt: prompt.zh,
          answer: prompt.answer,
          note: lesson.tip,
          errorCount: 1,
          confidence: 2,
        },
      ]);
    }
  };

  const nextWritingQuestion = () => {
    if (progress.index < DAILY_WRITING_TARGET - 1) {
      updateProgress({ index: progress.index + 1, answer: "", feedback: "", checked: false });
      return;
    }
    updateProgress({ ...progress, answer: "", feedback: "", checked: false });
  };

  return (
    <section className="panel">
      <div className="section-title">
        <h2>写作练习</h2>
        <span>今日 {practicedCount}/{DAILY_WRITING_TARGET} 句话</span>
      </div>
      <div className="tip-box">
        <strong>今日语法：{lesson.grammar}</strong>
        <p>{lesson.tip}</p>
        {lesson.examples.map((example) => (
          <p className="example" key={example}>{example}</p>
        ))}
      </div>
      <p className="muted">请翻译：{prompt.zh}</p>
      <textarea value={progress.answer} onChange={(event) => updateProgress({ ...progress, answer: event.target.value })} placeholder="Write your English sentence..." />
      <div className="actions">
        <button onClick={nextWritingQuestion} disabled={!progress.checked || progress.index >= DAILY_WRITING_TARGET - 1}>下一句话</button>
        <button className="primary" onClick={check}>
          <BookOpen size={18} /> 检查写作
        </button>
      </div>
      {progress.feedback && <p className="feedback">{progress.feedback}</p>}
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
      {!latestReport && (
        <div className="empty">完成今日学习后，Agent 会在这里生成你的专属学习报告。</div>
      )}
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
              <p className="example" key={item}>{item}</p>
            ))}
            <h3>仍需提升</h3>
            {report.weaknesses.map((item) => (
              <p className="correction" key={item}>{item}</p>
            ))}
            <h3>之后计划</h3>
            {report.nextPlan.map((item) => (
              <span className="pill" key={item}>{item}</span>
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
    onstart: (() => void) | null;
    onend: (() => void) | null;
    onresult: ((event: { results: { [index: number]: { [index: number]: { transcript: string } } } }) => void) | null;
    start: () => void;
  };

  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}
