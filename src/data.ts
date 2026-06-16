import type { ReviewItem, SkillArea } from "./types";

export const vocabularyCards = [
  {
    word: "appointment",
    meaning: "预约，约定",
    example: "I have a dentist appointment this afternoon.",
    prompt: "我今天下午有一个牙医预约。",
  },
  {
    word: "recommend",
    meaning: "推荐",
    example: "Can you recommend a good restaurant nearby?",
    prompt: "你能推荐附近一家好餐厅吗？",
  },
  {
    word: "available",
    meaning: "有空的，可用的",
    example: "Are you available after work?",
    prompt: "你下班后有空吗？",
  },
  {
    word: "comfortable",
    meaning: "舒服的，自在的",
    example: "I feel comfortable speaking English with you.",
    prompt: "和你说英语我觉得很自在。",
  },
  {
    word: "actually",
    meaning: "其实，实际上",
    example: "Actually, I prefer tea to coffee.",
    prompt: "其实，比起咖啡我更喜欢茶。",
  },
  {
    word: "probably",
    meaning: "很可能，大概",
    example: "I will probably stay at home tonight.",
    prompt: "我今晚可能会待在家里。",
  },
  {
    word: "usually",
    meaning: "通常",
    example: "I usually take a walk after dinner.",
    prompt: "我通常晚饭后散步。",
  },
  {
    word: "prefer",
    meaning: "更喜欢",
    example: "I prefer simple English sentences.",
    prompt: "我更喜欢简单的英文句子。",
  },
  {
    word: "improve",
    meaning: "提高，改善",
    example: "I want to improve my speaking skills.",
    prompt: "我想提高我的口语能力。",
  },
  {
    word: "practice",
    meaning: "练习",
    example: "I practice English for twenty minutes every day.",
    prompt: "我每天练习英语20分钟。",
  },
  {
    word: "confident",
    meaning: "自信的",
    example: "I feel more confident when I speak slowly.",
    prompt: "当我慢慢说时，我更自信。",
  },
  {
    word: "explain",
    meaning: "解释",
    example: "Could you explain this word again?",
    prompt: "你能再解释一下这个单词吗？",
  },
  {
    word: "understand",
    meaning: "理解",
    example: "I understand the main idea.",
    prompt: "我理解主要意思。",
  },
  {
    word: "remember",
    meaning: "记得，记住",
    example: "I remember this phrase because I use it often.",
    prompt: "我记得这个短语，因为我经常用它。",
  },
  {
    word: "forget",
    meaning: "忘记",
    example: "I sometimes forget new words.",
    prompt: "我有时候会忘记新单词。",
  },
  {
    word: "prepare",
    meaning: "准备",
    example: "I need to prepare for tomorrow's meeting.",
    prompt: "我需要为明天的会议做准备。",
  },
  {
    word: "important",
    meaning: "重要的",
    example: "Daily practice is important for learning English.",
    prompt: "每日练习对学习英语很重要。",
  },
  {
    word: "interesting",
    meaning: "有趣的",
    example: "This topic is interesting to me.",
    prompt: "这个话题对我来说很有趣。",
  },
  {
    word: "busy",
    meaning: "忙的",
    example: "I am busy today, but I can study for twenty minutes.",
    prompt: "我今天很忙，但我可以学习20分钟。",
  },
  {
    word: "relax",
    meaning: "放松",
    example: "I like to relax after work.",
    prompt: "我喜欢下班后放松。",
  },
];

export const speakingScenarios = [
  {
    title: "咖啡店点单",
    opener: "Hi! What would you like to order today?",
    goal: "用英文点饮品、说明偏好，并礼貌回应。",
  },
  {
    title: "认识新朋友",
    opener: "Nice to meet you! What do you usually do after work?",
    goal: "介绍自己的日常兴趣，并追问对方。",
  },
  {
    title: "问路",
    opener: "Sure, where are you trying to go?",
    goal: "说明目的地、听懂方向，并表达感谢。",
  },
  {
    title: "周末计划",
    opener: "What are you planning to do this weekend?",
    goal: "用英文说周末安排，并补充一个原因。",
  },
  {
    title: "学习英语",
    opener: "Why do you want to improve your English?",
    goal: "说明学习英语的原因和目标。",
  },
];

export const writingLessons = [
  {
    grammar: "want to + 动词原形",
    tip: "表达“想要做某事”时，用 want to + 动词原形。不要写 want improve，要写 want to improve。",
    examples: [
      "I want to improve my spoken English.",
      "I want to practice English every day.",
    ],
    prompts: [
      {
        zh: "我想提高我的英语口语。",
        answer: "I want to improve my spoken English.",
      },
      {
        zh: "我想每天练习英语。",
        answer: "I want to practice English every day.",
      },
      {
        zh: "我想学习更多日常单词。",
        answer: "I want to learn more daily words.",
      },
      {
        zh: "我想说得更自然。",
        answer: "I want to speak more naturally.",
      },
      {
        zh: "我想用英语和朋友聊天。",
        answer: "I want to chat with friends in English.",
      },
    ],
  },
];

export const writingPrompts = writingLessons[0].prompts.map((prompt) => ({
  grammar: writingLessons[0].grammar,
  tip: writingLessons[0].tip,
  ...prompt,
}));

export const dailyThemes = [
  {
    id: "daily-routine",
    title: "日常生活：安排一天",
    domain: "生活",
    description: "学会描述日常安排、时间、习惯和简单偏好。",
    vocabulary: vocabularyCards,
    speaking: {
      title: "聊聊你的一天",
      opener: "Today we will talk about your daily routine. What do you usually do in the morning?",
      goal: "用英文描述一天中的安排，并补充一个原因或细节。",
    },
    writingLesson: writingLessons[0],
  },
  {
    id: "work-communication",
    title: "职场沟通：会议和协作",
    domain: "职场",
    description: "练习会议、时间安排、任务沟通和礼貌请求。",
    vocabulary: [
      { word: "meeting", meaning: "会议", example: "I have a meeting at ten.", prompt: "我十点有一个会议。" },
      { word: "schedule", meaning: "日程，安排", example: "My schedule is full today.", prompt: "我今天的日程很满。" },
      { word: "deadline", meaning: "截止日期", example: "The deadline is this Friday.", prompt: "截止日期是这个星期五。" },
      { word: "project", meaning: "项目", example: "This project is important.", prompt: "这个项目很重要。" },
      { word: "update", meaning: "更新，进展", example: "Can you give me a quick update?", prompt: "你能给我一个简短进展吗？" },
      { word: "task", meaning: "任务", example: "I finished this task yesterday.", prompt: "我昨天完成了这个任务。" },
      { word: "team", meaning: "团队", example: "Our team works well together.", prompt: "我们的团队合作很好。" },
      { word: "confirm", meaning: "确认", example: "Please confirm the time.", prompt: "请确认时间。" },
      { word: "discuss", meaning: "讨论", example: "Let's discuss this tomorrow.", prompt: "我们明天讨论这个吧。" },
      { word: "prepare", meaning: "准备", example: "I need to prepare the report.", prompt: "我需要准备报告。" },
      { word: "report", meaning: "报告", example: "I sent the report this morning.", prompt: "我今天早上发了报告。" },
      { word: "client", meaning: "客户", example: "The client asked a question.", prompt: "客户问了一个问题。" },
      { word: "agree", meaning: "同意", example: "I agree with your idea.", prompt: "我同意你的想法。" },
      { word: "suggest", meaning: "建议", example: "I suggest a short meeting.", prompt: "我建议开一个短会。" },
      { word: "available", meaning: "有空的", example: "Are you available at three?", prompt: "你三点有空吗？" },
      { word: "urgent", meaning: "紧急的", example: "This task is urgent.", prompt: "这个任务很紧急。" },
      { word: "follow up", meaning: "跟进", example: "I will follow up tomorrow.", prompt: "我明天会跟进。" },
      { word: "share", meaning: "分享", example: "Could you share the file?", prompt: "你能分享这个文件吗？" },
      { word: "clear", meaning: "清楚的", example: "Your explanation is clear.", prompt: "你的解释很清楚。" },
      { word: "issue", meaning: "问题", example: "We found one small issue.", prompt: "我们发现了一个小问题。" },
    ],
    speaking: {
      title: "安排一次会议",
      opener: "Let's practice a work conversation. Are you available for a short meeting today?",
      goal: "用英文确认时间、说明安排，并礼貌回应。",
    },
    writingLesson: {
      grammar: "Could you...? 礼貌请求",
      tip: "职场沟通里常用 Could you...? 表达礼貌请求。句型是 Could you + 动词原形...?",
      examples: ["Could you send me the report?", "Could you confirm the meeting time?"],
      prompts: [
        { zh: "你能把报告发给我吗？", answer: "Could you send me the report?" },
        { zh: "你能确认会议时间吗？", answer: "Could you confirm the meeting time?" },
        { zh: "你能分享这个文件吗？", answer: "Could you share the file?" },
        { zh: "你能给我一个简短更新吗？", answer: "Could you give me a quick update?" },
        { zh: "你能明天跟进这个问题吗？", answer: "Could you follow up on this issue tomorrow?" },
      ],
    },
  },
  {
    id: "learning-growth",
    title: "学习成长：英语进步",
    domain: "学习",
    description: "围绕学习计划、练习方法、困难和进步表达自己。",
    vocabulary: [
      { word: "goal", meaning: "目标", example: "My goal is to speak clearly.", prompt: "我的目标是说得清楚。" },
      { word: "habit", meaning: "习惯", example: "Daily practice is a good habit.", prompt: "每日练习是一个好习惯。" },
      { word: "review", meaning: "复习", example: "I review new words at night.", prompt: "我晚上复习新单词。" },
      { word: "mistake", meaning: "错误", example: "Mistakes help me learn.", prompt: "错误帮助我学习。" },
      { word: "progress", meaning: "进步", example: "I can see my progress.", prompt: "我能看到我的进步。" },
      { word: "practice", meaning: "练习", example: "Practice makes speaking easier.", prompt: "练习让口语更容易。" },
      { word: "improve", meaning: "提高", example: "I want to improve my writing.", prompt: "我想提高我的写作。" },
      { word: "remember", meaning: "记住", example: "I remember words better with examples.", prompt: "通过例句我更容易记住单词。" },
      { word: "forget", meaning: "忘记", example: "I sometimes forget grammar rules.", prompt: "我有时会忘记语法规则。" },
      { word: "repeat", meaning: "重复", example: "Please repeat the sentence.", prompt: "请重复这个句子。" },
      { word: "explain", meaning: "解释", example: "Can you explain it simply?", prompt: "你能简单解释一下吗？" },
      { word: "example", meaning: "例子", example: "This example is useful.", prompt: "这个例子很有用。" },
      { word: "sentence", meaning: "句子", example: "Write one complete sentence.", prompt: "写一个完整句子。" },
      { word: "grammar", meaning: "语法", example: "This grammar point is useful.", prompt: "这个语法点很有用。" },
      { word: "fluently", meaning: "流利地", example: "I want to speak more fluently.", prompt: "我想说得更流利。" },
      { word: "clearly", meaning: "清楚地", example: "Please speak clearly.", prompt: "请说清楚一点。" },
      { word: "confident", meaning: "自信的", example: "I feel more confident now.", prompt: "我现在更自信了。" },
      { word: "method", meaning: "方法", example: "This method works for me.", prompt: "这个方法适合我。" },
      { word: "focus", meaning: "专注", example: "I focus on useful phrases.", prompt: "我专注于有用短语。" },
      { word: "challenge", meaning: "挑战", example: "Speaking is a challenge for me.", prompt: "口语对我是一个挑战。" },
    ],
    speaking: {
      title: "谈谈学习目标",
      opener: "Today's topic is learning English. What is your English learning goal?",
      goal: "用英文说明学习目标、困难和下一步计划。",
    },
    writingLesson: {
      grammar: "because 表达原因",
      tip: "because 用来解释原因。可以把简单句变得更完整：I practice every day because I want to improve.",
      examples: ["I review words because I forget them easily.", "I practice speaking because I want to be more confident."],
      prompts: [
        { zh: "我每天复习，因为我容易忘记单词。", answer: "I review every day because I forget words easily." },
        { zh: "我练习口语，因为我想更自信。", answer: "I practice speaking because I want to be more confident." },
        { zh: "我喜欢例句，因为它们容易记住。", answer: "I like examples because they are easy to remember." },
        { zh: "我慢慢说，因为我想说得更清楚。", answer: "I speak slowly because I want to speak more clearly." },
        { zh: "我每天学习，因为小步骤更容易坚持。", answer: "I study every day because small steps are easier to keep." },
      ],
    },
  },
];

export const starterReviewItems: Omit<ReviewItem, "id" | "createdAt" | "updatedAt" | "nextReviewAt">[] = [
  {
    area: "vocabulary",
    title: "available",
    prompt: "用 available 表达：你明天有空吗？",
    answer: "Are you available tomorrow?",
    note: "available 常用于询问时间是否方便。",
    errorCount: 1,
    confidence: 2,
    streak: 0,
    status: "learning",
  },
  {
    area: "speaking",
    title: "回答不要只说 yes/no",
    prompt: "别人问 What do you do after work? 请用完整句回答。",
    answer: "After work, I usually read or watch a short video.",
    note: "口语练习要尽量给一句补充信息，让对话继续。",
    errorCount: 1,
    confidence: 2,
    streak: 0,
    status: "learning",
  },
  {
    area: "writing",
    title: "want to + 动词原形",
    prompt: "翻译：我想练习英语写作。",
    answer: "I want to practice English writing.",
    note: "want 后面接 to do，不写 want practice。",
    errorCount: 1,
    confidence: 2,
    streak: 0,
    status: "learning",
  },
];

export const areaLabels: Record<SkillArea, string> = {
  vocabulary: "词汇",
  speaking: "口语",
  writing: "写作",
};
