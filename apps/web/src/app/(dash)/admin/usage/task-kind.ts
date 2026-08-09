export function getTaskKindMessageKey(taskKind: string) {
  switch (taskKind) {
    case "title":
      return "taskKinds.title" as const;
    case "memory":
      return "taskKinds.memory" as const;
    case "compact":
      return "taskKinds.compact" as const;
    case "web_search":
      return "taskKinds.web_search" as const;
    default:
      return taskKind.startsWith("web_search:") ? "taskKinds.web_search" as const : null;
  }
}
