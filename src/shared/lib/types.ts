/**
 * 跨域通用类型 —— 无业务语义,任何层可安全 import。
 */

/**
 * Next.js Server Action 的最小签名(FormData 入参,无返回或 Promise<void>)。
 * 供表单组件(如 ConfirmDialog)约束 action prop。
 */
export type FormDataSerializableAction = (formData: FormData) => void | Promise<void>;
