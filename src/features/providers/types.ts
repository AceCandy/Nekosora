/**
 * Provider 相关共享类型(仅类型,无运行时值)。
 * 本文件为普通类型模块,不是 server action 文件;类型在编译期擦除,不会进入客户端 bundle。
 */

// 通用 Server Action 类型已挪到 shared(避免 shared/ui 反向依赖 features)。
// 此处 re-export 保持向后兼容,新代码请直接 import from "@/shared/lib/types"。
export type { FormDataSerializableAction } from "@/shared/lib/types";
