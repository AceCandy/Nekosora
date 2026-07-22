interface ClosableTransport {
  close(): Promise<void>;
}

interface ConnectableClient<TTransport> {
  connect(
    transport: TTransport,
    options?: { signal?: AbortSignal },
  ): Promise<void>;
}

/** 连接取消时主动关闭底层 transport，避免超时后遗留进程或网络句柄。 */
export async function connectMcpClient<TTransport extends ClosableTransport>(
  client: ConnectableClient<TTransport>,
  transport: TTransport,
  signal: AbortSignal,
): Promise<void> {
  const closeTransport = () => {
    void transport.close().catch(() => {});
  };

  if (signal.aborted) {
    closeTransport();
    throw signal.reason;
  }

  signal.addEventListener("abort", closeTransport, { once: true });
  try {
    await client.connect(transport, { signal });
  } finally {
    signal.removeEventListener("abort", closeTransport);
  }
}

/** 保留硬超时保证，同时通知连接逻辑取消并释放已创建的资源。 */
export async function withConnectionTimeout<T>(
  connect: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      reject(new Error("mcp_connect_timeout"));
    }, timeoutMs);
  });

  try {
    return await Promise.race([connect(controller.signal), timeout]);
  } finally {
    clearTimeout(timeoutId!);
  }
}
