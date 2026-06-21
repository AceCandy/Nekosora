"use client";
import { useEffect, useRef } from "react";
import { X } from "lucide-react";

interface ModalProps {
  /** 受控开关:true 时打开,false 时关闭。 */
  open: boolean;
  /** 请求关闭的回调(点遮罩 / 按 ESC / 点关闭按钮时触发)。 */
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

/**
 * 轻量弹窗 —— 基于原生 <dialog> + showModal()/close()。
 *
 * 优点:零依赖;原生支持 ESC 关闭、焦点陷阱、aria。
 * 关闭时机:点击 backdrop(原生 click 落在 dialog 元素本身)、ESC(原生 cancel 事件)。
 *
 * 实现要点:
 *   1. 未打开时 **不渲染** <dialog>(return null),避免空 dialog 占据文档流、拦截背后的点击。
 *      原生 <dialog> 没有 open 属性时是 inline 可见元素而非隐藏 —— 曾导致关闭后的弹窗仍盖
 *      在列表上,使「编辑」按钮点不动。
 *   2. 打开时挂载 <dialog> 并在 useEffect 里调 showModal()(必须在 DOM 挂载后调用)。
 *   3. close/ESC/遮罩点击 → 触发 onClose → 父组件把 open 切回 false → 本组件卸载 dialog。
 */
export default function Modal({ open, onClose, title, children }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);

  // 挂载后/打开时调 showModal。由于在 open=false 时返回 null，
  // 仅在 open=true 时 <dialog> 真正被挂载，此时 ref 才有值，调用 showModal()。
  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    if (open) {
      if (!dlg.open) dlg.showModal();
    } else {
      if (dlg.open) dlg.close();
    }
  }, [open]);

  if (!open) return null;

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={onClose}
      onClick={(e) => {
        // 点击 backdrop:原生 dialog 元素本身就是 backdrop 区域,event.target === dialog。
        if (e.target === ref.current) onClose();
      }}
      className="
        m-auto w-[min(640px,92vw)] rounded-lg border border-morning-mist bg-white p-0
        text-space-ink shadow-xl backdrop:bg-black/40
        dark:border-deep-space dark:bg-twilight-obsidian dark:text-nebula-silver
      "
    >
      <header className="flex items-center justify-between border-b border-morning-mist px-5 py-3 dark:border-deep-space">
        <h2 className="text-base font-semibold">{title}</h2>
        <button
          type="button"
          onClick={onClose}
          className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-250 p-1 rounded transition-colors inline-flex items-center justify-center"
          aria-label="关闭"
        >
          <X className="w-4 h-4" />
        </button>
      </header>
      <div className="px-5 py-4">{children}</div>
    </dialog>
  );
}
