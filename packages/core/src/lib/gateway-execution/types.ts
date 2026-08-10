import type { CallContext, IRUsage, ResolvedRoute } from "@/lib/providers/types";

export type GatewayOperation =
  | "chat.stream"
  | "chat.generate"
  | "image.generate"
  | "audio.speech"
  | "audio.transcription";

export type GatewayExecutionStatus = "success" | "failed" | "interrupted";
export type GatewayAttemptStatus = "success" | "failed" | "interrupted" | "rejected";

export interface GatewayAttemptContext {
  executionId: string;
  attempt: number;
  operation: GatewayOperation;
  route: ResolvedRoute;
  apiKey: string;
  abortSignal?: AbortSignal;
}

export interface GatewayAttemptEvent<TEvent> {
  value: TEvent;
  commitsResponse: boolean;
  /** 仅首个非空、用户可见正文事件携带；与响应提交/故障转移边界独立。 */
  firstTokenAt?: number;
}

export interface GatewayAttemptResult<TResult> {
  value: TResult;
  usage?: IRUsage;
  firstTokenAt?: number;
}

export type GatewayAttemptAdapter<TEvent, TResult> = (
  context: GatewayAttemptContext,
) => AsyncGenerator<GatewayAttemptEvent<TEvent>, GatewayAttemptResult<TResult>, void>;

export interface SafeGatewayError {
  code: string;
  message: string;
  phase: string;
  httpStatus?: number;
  details?: Record<string, unknown>;
}

export type GatewayAdapterSelection<TEvent, TResult> =
  | { kind: "selected"; adapter: GatewayAttemptAdapter<TEvent, TResult> }
  | { kind: "rejected"; error: SafeGatewayError };

/** 可离开 execution 安全域的 route 快照，不包含 key、header 或 base URL。 */
export interface GatewayRouteSnapshot {
  modelName: string;
  upstreamModelName: string;
  apiFormat?: ResolvedRoute["apiFormat"];
  protocol: ResolvedRoute["protocol"];
  provider: { id: string; name: string };
  priority: number;
  weight: number;
  source: ResolvedRoute["source"];
  routeId: string;
  modelId?: string;
}

export interface GatewayExecutionOutcome<TResult> {
  executionId: string;
  status: GatewayExecutionStatus;
  result?: TResult;
  usage: IRUsage;
  route?: GatewayRouteSnapshot;
  upstreamKeyMasked?: string;
  firstTokenAt?: number;
  error?: SafeGatewayError;
  committed: boolean;
}

export interface StartExecutionTelemetry {
  executionId: string;
  requestId: string;
  operation: GatewayOperation;
  ctx: CallContext;
  model: string;
  modelId?: string;
  requestPath?: string;
  stream: boolean;
  taskKind?: string;
  startedAt: number;
}

export interface AttemptTelemetry {
  executionId: string;
  attempt: number;
  operation: GatewayOperation;
  route: GatewayRouteSnapshot;
  upstreamKeyMasked?: string;
  status: GatewayAttemptStatus;
  usage?: IRUsage;
  error?: SafeGatewayError;
  latencyMs: number;
  firstTokenLatencyMs?: number;
  startedAt: number;
  completedAt: number;
}

export interface FinalExecutionTelemetry<TResult> {
  initial: StartExecutionTelemetry;
  outcome: GatewayExecutionOutcome<TResult>;
  latencyMs: number;
  firstTokenLatencyMs?: number;
  completedAt: number;
}

export interface GatewayTelemetryPort {
  startExecution(input: StartExecutionTelemetry): Promise<void>;
  recordAttempt(input: AttemptTelemetry): Promise<void>;
  finalizeExecution<TResult>(input: FinalExecutionTelemetry<TResult>): Promise<void>;
}

export interface GatewayBreakerPort {
  recordSuccess(providerId: string): void;
  recordFailure(providerId: string): void;
}

export interface ExecuteGatewayOptions<TEvent, TResult> {
  ctx: CallContext;
  requestId: string;
  operation: GatewayOperation;
  model: string;
  modelId?: string;
  requestPath?: string;
  taskKind?: string;
  abortSignal?: AbortSignal;
  maxKeyAttempts?: number;
  resolveRoutes(): Promise<ResolvedRoute[]>;
  selectAdapter(route: ResolvedRoute):
    | GatewayAttemptAdapter<TEvent, TResult>
    | GatewayAdapterSelection<TEvent, TResult>
    | null;
  /** 首个真实 adapter invocation 前执行；失败必须终止整个 execution。 */
  onProviderStart?(): Promise<void>;
  /** 识别当前 operation 的路由级工具兼容性拒绝。 */
  isToolUnsupported?(error: unknown): boolean;
  /** 记录具体路由的工具能力降级；失败不得改变当前请求结果。 */
  onToolUnsupported?(route: ResolvedRoute): Promise<void>;
  /** 识别 compatible Chat 上游对 stream_options 的明确拒绝。 */
  isStreamOptionsUnsupported?(route: ResolvedRoute, error: unknown): boolean;
  /** 让当前请求立即降级并持久化 Provider 能力；失败不得覆盖请求结果。 */
  onStreamOptionsUnsupported?(route: ResolvedRoute): Promise<void>;
  telemetry: GatewayTelemetryPort;
  breaker: GatewayBreakerPort;
}
