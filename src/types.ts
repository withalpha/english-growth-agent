export type SkillArea = "vocabulary" | "speaking" | "writing";
export type Mastery = "new" | "learning" | "review" | "mastered";

export interface ReviewItem {
  id: string;
  area: SkillArea;
  title: string;
  prompt: string;
  answer: string;
  note: string;
  errorCount: number;
  confidence: number;
  streak: number;
  status: Mastery;
  createdAt: string;
  updatedAt: string;
  nextReviewAt: string;
}

export interface KnowledgeEntry {
  id: string;
  area: SkillArea;
  title: string;
  content: string;
  correction?: string;
  example?: string;
  createdAt: string;
}

export interface DiagnosisResult {
  completed: boolean;
  completedAt?: string;
  vocabularyLevel: string;
  speakingLevel: string;
  writingLevel: string;
  summary: string;
  strengths?: string[];
  weaknesses?: string[];
  plan: string[];
}

export interface DailyReport {
  id: string;
  date: string;
  summary: string;
  strengths: string[];
  weaknesses: string[];
  encouragement: string;
  nextPlan: string[];
}

export interface DiagnosisProgress {
  vocabIndex: number;
  vocabCorrect: number;
  vocabSelected: string;
  vocabAnswered: boolean;
  vocabFeedback: string;
  speakingIndex: number;
  speakingAnswer: string;
  speakingAnswers: string[];
}

export interface TodayProgress {
  date: string;
  themeId: string;
  vocabulary: {
    index: number;
    selected: string;
    feedback: string;
    answered: boolean;
    completed: boolean;
  };
  speaking: {
    messages: ChatMessage[];
    input: string;
    feedback: string;
    completed: boolean;
  };
  writing: {
    index: number;
    answer: string;
    feedback: string;
    checked: boolean;
    completed: boolean;
  };
}

export interface LearningProgress {
  diagnosis: DiagnosisProgress;
  today: TodayProgress;
}

export interface AppState {
  diagnosis: DiagnosisResult;
  reviewItems: ReviewItem[];
  knowledge: KnowledgeEntry[];
  dailyReports: DailyReport[];
  progress: LearningProgress;
  streakDays: number;
  lastStudyDate?: string;
}

export interface ChatMessage {
  role: "agent" | "user";
  text: string;
}

export interface AiFeedback {
  score: number;
  summary: string;
  corrections: string[];
  reviewItems: Omit<ReviewItem, "id" | "createdAt" | "updatedAt" | "nextReviewAt" | "status" | "streak">[];
}
