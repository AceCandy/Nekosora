"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

/**
 * 语音输入(Web Speech API):start 开始听写,final 结果经 onTranscript 追加进输入框。
 * 仅 Chrome/Edge/Safari(webkit 前缀)可用;Firefox 等不支持时 supported=false,调用方隐藏入口。
 * interim 结果不入框(避免抖动),只把确认句交给调用方。
 */

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: { transcript: string };
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start(): void;
  stop(): void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

export function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function subscribeNoop() {
  return () => {};
}

export interface UseSpeechInputOptions {
  /** BCP-47 语言标记(跟随界面 locale)。 */
  locale: string;
  /** 确认句回调:把转写文本追加进输入框。 */
  onTranscript: (text: string) => void;
}

export interface SpeechInput {
  /** 当前环境是否支持语音识别(SSR 恒 false,hydration 后取真实值)。 */
  supported: boolean;
  /** 是否正在听写。 */
  listening: boolean;
  start: () => void;
  stop: () => void;
}

export function useSpeechInput({ locale, onTranscript }: UseSpeechInputOptions): SpeechInput {
  // useSyncExternalStore:SSR 返回 false,客户端取真实支持度,避免 hydration 不一致
  const supported = useSyncExternalStore(
    subscribeNoop,
    () => getSpeechRecognitionCtor() !== null,
    () => false,
  );
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  // 回调随提交更新(effect 内写 ref,避免识别器持有过期闭包)
  const onTranscriptRef = useRef(onTranscript);
  const localeRef = useRef(locale);
  useEffect(() => {
    onTranscriptRef.current = onTranscript;
    localeRef.current = locale;
  });

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setListening(false);
  }, []);

  const start = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor || recognitionRef.current) return;
    const recognition = new Ctor();
    recognition.lang = localeRef.current;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (!result?.isFinal) continue;
        const text = result[0]?.transcript?.trim();
        if (text) onTranscriptRef.current(text);
      }
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      setListening(false);
    };
    recognition.onerror = () => {
      recognitionRef.current = null;
      setListening(false);
    };
    recognitionRef.current = recognition;
    try {
      recognition.start();
      setListening(true);
    } catch {
      recognitionRef.current = null;
      setListening(false);
    }
  }, []);

  // 卸载时确保识别器释放(麦克风指示熄灭)
  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
      recognitionRef.current = null;
    };
  }, []);

  return { supported, listening, start, stop };
}
