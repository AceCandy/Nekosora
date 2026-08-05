/**
 * Seed Prompt 模板 —— 插入官方内置模板(builtin)。
 * 运行:pnpm tsx scripts/seed-templates.ts
 *
 * 幂等:按 name + scope=builtin 去重,已存在则跳过。
 */
import { and, eq } from "drizzle-orm";
import { getDb, getSchema, closeDb } from "@/lib/infra/db";
import type { TemplateVariable, AgentConfig } from "@/lib/templates/types";

interface BuiltinTemplate {
  name: string;
  description: string;
  category: string;
  icon: string;
  systemPrompt: string;
  userTemplate: string | null;
  variables: TemplateVariable[];
  recommendedModel: string | null;
  isAgent: boolean;
  agentConfig: AgentConfig | null;
  sortOrder: number;
}

const BUILTINS: BuiltinTemplate[] = [
  {
    name: "翻译助手",
    description: "高质量中英互译,保留术语与语气",
    category: "writing",
    icon: "🌐",
    systemPrompt:
      "你是一位专业译者。将用户输入翻译为目标语言,保持原文语气、专业术语准确。" +
      "仅输出译文,不要解释。如原文有歧义,在译文后用 (注:...) 简短说明。",
    userTemplate: "请将以下内容翻译为 {{language}}:\n\n{{text}}",
    variables: [
      { name: "language", label: "目标语言", type: "select", required: true, default: "英文", options: ["英文", "中文", "日文", "韩文", "法文", "德文"] },
      { name: "text", label: "待翻译文本", type: "textarea", required: true },
    ],
    recommendedModel: null,
    isAgent: false,
    agentConfig: null,
    sortOrder: 10,
  },
  {
    name: "代码审查",
    description: "审查代码,指出问题与改进建议",
    category: "coding",
    icon: "💻",
    systemPrompt:
      "你是一位资深 {{framework}} 工程师。审查用户提交的 {{language}} 代码,从以下维度评估:" +
      "1) 正确性与潜在 bug;2) 可读性与命名;3) 性能;4) 安全。" +
      "用分点列出问题(严重程度标记 🔴/🟡/🟢),末尾给出重构建议。",
    userTemplate: "请审查以下代码:\n\n```\n{{code}}\n```",
    variables: [
      { name: "language", label: "编程语言", type: "text", required: true, default: "TypeScript" },
      { name: "framework", label: "框架/上下文", type: "text", required: false, default: "" },
      { name: "code", label: "待审查代码", type: "textarea", required: true },
    ],
    recommendedModel: null,
    isAgent: false,
    agentConfig: null,
    sortOrder: 20,
  },
  {
    name: "会议纪要",
    description: "把会议记录整理为结构化纪要",
    category: "writing",
    icon: "📝",
    systemPrompt:
      "你是一位会议秘书。把用户提供的会议原始记录整理为结构化纪要,包含:" +
      "议题、关键讨论点、决议、行动项(负责人/截止)。用 Markdown 输出。",
    userTemplate: "请整理以下会议记录:\n\n{{notes}}",
    variables: [
      { name: "notes", label: "会议原始记录", type: "textarea", required: true },
    ],
    recommendedModel: null,
    isAgent: false,
    agentConfig: null,
    sortOrder: 30,
  },
  {
    name: "SQL 生成",
    description: "根据自然语言需求生成 SQL",
    category: "coding",
    icon: "🗄️",
    systemPrompt:
      "你是一位数据库专家。根据用户描述的需求和 {{dialect}} 方言,生成可执行的 SQL。" +
      "先简述表结构假设,再给出 SQL(用 ```sql 代码块),最后解释关键逻辑。",
    userTemplate: "需求:{{requirement}}",
    variables: [
      { name: "dialect", label: "数据库方言", type: "select", required: true, default: "PostgreSQL", options: ["PostgreSQL", "MySQL", "SQLite", "SQL Server"] },
      { name: "requirement", label: "查询需求", type: "textarea", required: true },
    ],
    recommendedModel: null,
    isAgent: false,
    agentConfig: null,
    sortOrder: 40,
  },
  {
    name: "研究助手",
    description: "Agent:多步搜索与综合,生成研究报告",
    category: "analysis",
    icon: "🔍",
    systemPrompt:
      "你是一位严谨的研究助手。针对用户问题,使用可用工具(知识库检索)收集信息," +
      "多步迭代直至信息充分,然后综合成结构化报告(背景/发现/结论/来源)。标注信息缺口。",
    userTemplate: "研究问题:{{question}}",
    variables: [
      { name: "question", label: "研究问题", type: "textarea", required: true },
    ],
    recommendedModel: null,
    isAgent: true,
    agentConfig: { maxSteps: 10, allowedTools: [], allowedServers: [] },
    sortOrder: 50,
  },
];

async function main() {
  const db = await getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = getSchema() as any;

  let inserted = 0;
  for (const t of BUILTINS) {
    const existing = await db
      .select({ id: s.promptTemplates.id })
      .from(s.promptTemplates)
      .where(and(eq(s.promptTemplates.name, t.name), eq(s.promptTemplates.scope, "builtin")))
      .limit(1);
    if (existing.length > 0) continue;

    await db.insert(s.promptTemplates).values({
      userId: null,
      scope: "builtin",
      name: t.name,
      description: t.description,
      category: t.category,
      icon: t.icon,
      systemPrompt: t.systemPrompt,
      userTemplate: t.userTemplate,
      variables: t.variables,
      recommendedModel: t.recommendedModel,
      isAgent: t.isAgent,
      agentConfig: t.agentConfig,
      enabled: true,
      sortOrder: t.sortOrder,
    });
    inserted++;
  }

  console.log(`[seed-templates] ✅ 内置模板:新增 ${inserted} 个,跳过 ${BUILTINS.length - inserted} 个(已存在)`);
}

main()
  .then(() => closeDb())
  .then(() => process.exit(0))
  .catch(async (e) => {
    console.error("[seed-templates] 失败:", e);
    await closeDb();
    process.exit(1);
  });
