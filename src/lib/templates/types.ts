/**
 * Prompt 模板共享类型 —— dialect 中立。
 */

export type TemplateScope = "builtin" | "private" | "shared";

export interface TemplateVariable {
  /** 变量名(出现在 {{var}} 占位符中)。 */
  name: string;
  /** 展示标签。 */
  label: string;
  type: "text" | "textarea" | "select";
  required: boolean;
  default?: string;
  /** type=select 时的选项。 */
  options?: string[];
}

/** Agent 模板配置(isAgent=true 时)。 */
export interface AgentConfig {
  /** agent 循环最大轮数。 */
  maxSteps: number;
  /** 允许调用的 MCP 工具名(限定名 serverName__toolName)。 */
  allowedTools: string[];
  /** 允许的 MCP server id。 */
  allowedServers: string[];
}

/** 模板的业务视图(从 DB 行映射)。 */
export interface PromptTemplate {
  id: string;
  userId: string | null;
  scope: TemplateScope;
  name: string;
  description: string | null;
  category: string | null;
  icon: string | null;
  systemPrompt: string | null;
  userTemplate: string | null;
  variables: TemplateVariable[];
  recommendedModel: string | null;
  isAgent: boolean;
  agentConfig: AgentConfig | null;
  enabled: boolean;
  sortOrder: number;
  useCount: number;
}
