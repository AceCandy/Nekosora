/**
 * Provider 相关共享类型(仅类型,无运行时值)。
 * 本文件为普通类型模块,不是 server action 文件;类型在编译期擦除,不会进入客户端 bundle。
 */

/**
 * 一个可绑给 <form action={...}> 的 Server Action 类型。
 * React 的 form action 签名要求 (formData: FormData) => void | Promise<void>;
 * 无论原 action 还是已 .bind 前缀参数的版本,最终调用签名都一致。
 */
export type FormDataSerializableAction = (formData: FormData) => void | Promise<void>;
