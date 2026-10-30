import "server-only";
import { LEVEL_NAMES } from "@/lib/schema/paper";
import type { AnswerKey } from "@/lib/content";
import type { JudgeResult, PaperSummary, PublicQuestion } from "@/lib/types";
import { VERDICT_LABEL } from "@/lib/types";

export type LLMMessage = { role: "system" | "user" | "assistant"; content: string };

const LEVEL_FOCUS: Record<number, string> = {
  1: "计算机基础、变量与数据类型、输入输出、顺序/分支/循环结构",
  2: "多重循环、ASCII 与字符、数学函数、简单的流程图",
  3: "数据编码（原码/反码/补码）、进制转换、位运算、一维数组、字符串",
  4: "函数与参数传递、指针、二维数组、结构体、简单排序、文件操作、异常处理",
  5: "初等数论（素数筛、GCD/LCM、唯一分解）、高精度、链表、二分、递归、分治、贪心、复杂度分析",
  6: "树与二叉树、哈夫曼编码、栈与队列、面向对象、搜索（DFS/BFS）、简单动态规划",
  7: "图论基础、图的遍历、哈希表、动态规划进阶、数学函数",
  8: "排列组合、最短路、最小生成树、倍增、算法综合与复杂度优化",
};

function tutorPersona(level: number) {
  return `你是一位耐心、专业的少儿编程（C++）教练，正在辅导一名备考 CCF GESP ${LEVEL_NAMES[level]} 的中小学生。
该级别重点考查：${LEVEL_FOCUS[level] ?? "C++ 程序设计"}。

讲解要求：
- 用简体中文，语气亲切、鼓励，面向 9~16 岁学生，避免堆砌术语；必须用到术语时顺带一句话解释。
- 先诊断：准确指出学生"错在哪里、为什么会这样想"，再讲正确思路。不要泛泛复述题目。
- 需要时用小例子、手动模拟（列表格逐步跟踪变量）或画示意来说明。
- 讲解末尾用「📌 知识点」总结 1~3 条要点，并给一条「💡 避坑提示」。
- 使用 Markdown：代码放在 \`\`\`cpp 代码块中；数学公式用 $...$。
- 篇幅适中（一般不超过 400 字），学生追问时再展开。`;
}

function objectiveBlock(q: PublicQuestion) {
  if (q.type === "single_choice") {
    return `【单选题 第 ${q.number} 题】\n${q.stem}\n\n${q.options.map((o) => `${o.label}. ${o.content}`).join("\n")}`;
  }
  if (q.type === "true_false") return `【判断题 第 ${q.number} 题】\n${q.stem}`;
  return "";
}

const tfLabel = (a: string | null) => (a === "T" ? "正确（√）" : a === "F" ? "错误（×）" : "未作答");

export function buildObjectiveMessages(params: {
  paper: PaperSummary;
  question: PublicQuestion;
  key: AnswerKey;
  studentAnswer: string | null;
}): LLMMessage[] {
  const { paper, question, key, studentAnswer } = params;
  const fmt = question.type === "true_false" ? tfLabel : (a: string | null) => a ?? "未作答";
  const correct = studentAnswer !== null && studentAnswer === key.answer;

  const context = `${objectiveBlock(question)}

标准答案：${fmt(key.answer)}
学生答案：${fmt(studentAnswer)}（${correct ? "答对了" : "答错了"}）
${key.explanation ? `\n官方/教师解析（供参考）：\n${key.explanation}` : ""}`;

  const task = correct
    ? "学生答对了。请简要确认其思路，并补充这道题背后的知识点和容易混淆的地方，帮助巩固。"
    : studentAnswer === null
      ? "学生没有作答。请引导他一步步分析，给出正确答案及理由。"
      : question.type === "single_choice"
        ? `学生选了 ${studentAnswer}。请先分析选项 ${studentAnswer} 错在哪里（或学生可能的误解），再说明为什么 ${key.answer} 是正确的；如有必要，逐一点评其余选项。若题目含代码，请手动模拟关键步骤。`
        : "请说明这句话为什么是" + tfLabel(key.answer) + "，并指出学生可能的误解。若题目含代码，请手动模拟关键步骤。";

  return [
    { role: "system", content: `${tutorPersona(paper.level)}\n\n以下是题目信息（来自 ${paper.examTitle} C++ ${LEVEL_NAMES[paper.level]}）：\n\n${context}` },
    { role: "user", content: task },
  ];
}

function judgeSummary(j: JudgeResult | null | undefined) {
  if (!j) return "学生还没有提交评测。";
  if (j.verdict === "CE") return `评测结果：编译错误\n编译器输出：\n\`\`\`\n${j.compileOutput.slice(0, 2000)}\n\`\`\``;
  const lines = [`评测结果：${VERDICT_LABEL[j.verdict]}（通过 ${j.passed}/${j.total} 个测试点）`];
  const failed = j.cases.find((c) => c.verdict !== "AC" && c.input !== undefined);
  if (failed) {
    lines.push(
      `第一个未通过的测试点（${failed.isSample ? "样例" : "隐藏数据"}，${VERDICT_LABEL[failed.verdict]}）：`,
      `输入：\n\`\`\`\n${failed.input}\n\`\`\``,
      `期望输出：\n\`\`\`\n${failed.expected}\n\`\`\``,
      `学生输出：\n\`\`\`\n${failed.actual || "（无输出）"}\n\`\`\``,
    );
    if (failed.stderr) lines.push(`错误信息：${failed.stderr}`);
  }
  return lines.join("\n");
}

export function buildProgrammingMessages(params: {
  paper: PaperSummary;
  question: Extract<PublicQuestion, { type: "programming" }>;
  key: AnswerKey;
  code: string;
  judge?: JudgeResult | null;
}): LLMMessage[] {
  const { paper, question: q, key, code, judge } = params;
  const statement = `【编程题：${q.title}】（时间限制 ${q.timeLimitMs / 1000}s，内存限制 ${q.memoryLimitMb}MB）
${q.description}

输入格式：
${q.inputFormat}

输出格式：
${q.outputFormat}

样例：
${q.samples.map((s, i) => `样例${i + 1} 输入：\n${s.input}\n样例${i + 1} 输出：\n${s.output}`).join("\n\n")}
${q.dataRange ? `\n数据范围：${q.dataRange}` : ""}`;

  const rules = `编程题辅导规则：
- 目标是让学生自己把题做出来。默认只给"诊断 + 提示"，指出出错的代码行和原因，用伪代码或关键一两行代码说明修改方向；不要直接给出完整的 AC 代码，除非学生明确要求"给出完整代码/标准答案"。
- 编译错误：把编译器报错翻译成学生能懂的话，并指出对应的行。
- 答案错误：结合未通过的测试点手动模拟，找出逻辑漏洞（边界、数据类型溢出、循环条件、输出格式等）。
- 超时：分析时间复杂度，结合数据范围说明需要的复杂度，提示优化方向。
- 运行错误：检查数组越界、除零、栈溢出、未初始化等。
- 如果代码已经通过，可点评代码风格与复杂度，并提出可以优化或拓展的地方。`;

  const reference = key.referenceSolution
    ? `\n\n官方参考程序（仅供你分析使用，不要整段贴给学生）：\n\`\`\`cpp\n${key.referenceSolution}\n\`\`\``
    : "";

  return [
    {
      role: "system",
      content: `${tutorPersona(paper.level)}\n\n${rules}\n\n题目（${paper.examTitle} C++ ${LEVEL_NAMES[paper.level]}）：\n${statement}${reference}`,
    },
    {
      role: "user",
      content: `这是我的代码：\n\`\`\`cpp\n${code.slice(0, 20_000)}\n\`\`\`\n\n${judgeSummary(judge)}\n\n请帮我分析问题出在哪里，该怎么改？`,
    },
  ];
}

/** RAG context: semantically similar past questions (pgvector) the tutor may recommend. */
export function relatedQuestionsBlock(related: { id: string; type: string; number: number; title: string | null; stem: string }[]) {
  if (related.length === 0) return "";
  const lines = related.map((r) => {
    const label = r.type === "programming" ? `编程题《${r.title}》` : `${r.type === "single_choice" ? "单选" : "判断"}第 ${r.number} 题`;
    const [, exam, level] = r.id.match(/^cpp-(\d{4}-\d{2})-l(\d)/) ?? [];
    return `- ${exam ?? ""} ${level ? `${level}级` : ""} ${label}：${r.stem.replace(/\s+/g, " ").slice(0, 80)}`;
  });
  return `\n\n题库中考查相似知识点的真题（讲解结束时可推荐 1~2 道让学生巩固，注明考试场次和题号）：\n${lines.join("\n")}`;
}
