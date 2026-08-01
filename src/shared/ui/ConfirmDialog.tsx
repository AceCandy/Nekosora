"use client";
import type { FormDataSerializableAction } from "@/shared/lib/types";
import Modal from "@/shared/ui/Modal";

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** 正文说明。 */
  message: React.ReactNode;
  /** 确认按钮文案,默认「确认」。 */
  confirmLabel?: string;
  /** 取消按钮文案,默认「取消」。 */
  cancelLabel?: string;
  /** 确认按钮是否为危险样式(红色),默认 true。 */
  danger?: boolean;
  /**
   * 确认时触发的 server action(可选)。
   * 传入时确认按钮渲染为 <form action={...}> 提交;不传则用 onConfirm 回调。
   */
  action?: FormDataSerializableAction;
  /** 确认时回调(action 未传时使用)。 */
  onConfirm?: () => void;
}

/**
 * 通用确认弹窗,基于 <Modal>。
 * 常见用途:删除二次确认(danger)。
 * 确认按钮:优先用 server action(原生 form 提交,删数据场景);否则调 onConfirm。
 * 无论哪条路径,确认后都会关闭弹窗。
 */
export default function ConfirmDialog({
  open,
  onClose,
  title,
  message,
  confirmLabel = "确认",
  cancelLabel = "取消",
  danger = true,
  action,
  onConfirm,
}: ConfirmDialogProps) {
  const confirmCls = danger
    ? "bg-red-600 text-white hover:bg-red-700"
    : "bg-neutral-900 text-white hover:bg-neutral-700 dark:bg-white dark:text-black";

  const handleConfirm = () => {
    if (onConfirm) onConfirm();
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title={title} ariaLabel={title}>
      <div className="space-y-4">
        <div className="text-ui-body text-neutral-600 dark:text-neutral-300">{message}</div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-neutral-300 px-4 py-2 text-ui-body hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            {cancelLabel}
          </button>
          {action ? (
            <form action={action} onSubmit={() => setTimeout(onClose, 0)}>
              <button
                type="submit"
                className={`rounded-md px-4 py-2 text-ui-body font-medium ${confirmCls}`}
              >
                {confirmLabel}
              </button>
            </form>
          ) : (
            <button
              type="button"
              onClick={handleConfirm}
              className={`rounded-md px-4 py-2 text-ui-body font-medium ${confirmCls}`}
            >
              {confirmLabel}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
