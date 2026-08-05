"use client";

import { useEffect } from "react";

/**
 * Service Worker 注册器。
 *
 * 仅在生产环境注册(开发时 SW 缓存会与 Next.js 热更新冲突,导致页面不刷新)。
 * SW 接管后,后续导航走离线优先策略(见 public/sw.js)。
 */
export default function RegisterSW() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    const register = () => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .catch(() => {
          /* 注册失败静默,不影响主功能 */
        });
    };

    // 页面 load 后注册,避免抢占首屏关键资源。
    if (document.readyState === "complete") {
      register();
    } else {
      window.addEventListener("load", register, { once: true });
      return () => window.removeEventListener("load", register);
    }
  }, []);

  return null;
}
