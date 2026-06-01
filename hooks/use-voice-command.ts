"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// 「読んで」などの呼びかけを検出するためのパターン（ひらがな比較）。
const TRIGGER_PATTERNS = [
  "よんで",
  "よんでください",
  "よんでよ",
  "よみあげて",
  "よみあげ",
  "よんだ", // 認識ゆれ対策
];

// 連続検出を防ぐためのクールダウン（ミリ秒）
const TRIGGER_COOLDOWN_MS = 2500;

// カタカナ・漢字交じりの認識結果をひらがな寄りに正規化して照合する。
function normalize(text: string): string {
  return text
    .replace(/\s+/g, "")
    .replace(/[ァ-ヶ]/g, (c) =>
      String.fromCharCode(c.charCodeAt(0) - 0x60)
    ) // カタカナ→ひらがな
    .replace("読んで", "よんで")
    .replace("読み上げて", "よみあげて")
    .replace("読み上げ", "よみあげ");
}

interface UseVoiceCommandReturn {
  isListening: boolean;
  isSupported: boolean;
  start: () => void;
  stop: () => void;
  toggle: () => void;
}

/**
 * マイクで音声を常時聞き取り、「読んで」等の呼びかけを検出したら onTrigger を呼ぶ。
 * Web Speech Recognition（Chrome/Edge系）を使用。
 */
export function useVoiceCommand(onTrigger: () => void): UseVoiceCommandReturn {
  const [isListening, setIsListening] = useState(false);
  const [isSupported, setIsSupported] = useState(false);

  // SpeechRecognition は型定義が無い環境があるため any で扱う
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);
  const listeningRef = useRef(false);
  const lastTriggerRef = useRef(0);
  const onTriggerRef = useRef(onTrigger);

  // 最新のコールバックを保持
  useEffect(() => {
    onTriggerRef.current = onTrigger;
  }, [onTrigger]);

  // 対応状況の判定
  useEffect(() => {
    if (typeof window === "undefined") return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    const SpeechRecognition = w.SpeechRecognition || w.webkitSpeechRecognition;
    setIsSupported(!!SpeechRecognition);
  }, []);

  const handleResult = useCallback((event: unknown) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const e = event as any;
    let transcript = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      transcript += e.results[i][0]?.transcript ?? "";
    }
    const normalized = normalize(transcript);
    if (!normalized) return;

    const matched = TRIGGER_PATTERNS.some((p) => normalized.includes(p));
    if (!matched) return;

    const now = Date.now();
    if (now - lastTriggerRef.current < TRIGGER_COOLDOWN_MS) return;
    lastTriggerRef.current = now;
    onTriggerRef.current();
  }, []);

  const start = useCallback(() => {
    if (typeof window === "undefined") return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    const SpeechRecognition = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SpeechRecognition) return;
    if (recognitionRef.current) return;

    const recognition = new SpeechRecognition();
    recognition.lang = "ja-JP";
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = handleResult;

    recognition.onend = () => {
      // 一定時間で自動停止するので、リスニング継続中なら再開する
      if (listeningRef.current) {
        try {
          recognition.start();
        } catch {
          // 連続 start の例外は無視
        }
      }
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onerror = (ev: any) => {
      // マイク拒否などの致命的エラーは停止
      if (ev?.error === "not-allowed" || ev?.error === "service-not-allowed") {
        listeningRef.current = false;
        setIsListening(false);
      }
      // no-speech / aborted などは onend 経由で再開される
    };

    recognitionRef.current = recognition;
    listeningRef.current = true;
    try {
      recognition.start();
      setIsListening(true);
    } catch {
      // すでに開始済みなどは無視
    }
  }, [handleResult]);

  const stop = useCallback(() => {
    listeningRef.current = false;
    setIsListening(false);
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (recognition) {
      try {
        recognition.onend = null;
        recognition.stop();
      } catch {
        // 無視
      }
    }
  }, []);

  const toggle = useCallback(() => {
    if (listeningRef.current) stop();
    else start();
  }, [start, stop]);

  // アンマウント時に確実に停止
  useEffect(() => {
    return () => {
      listeningRef.current = false;
      const recognition = recognitionRef.current;
      recognitionRef.current = null;
      if (recognition) {
        try {
          recognition.onend = null;
          recognition.stop();
        } catch {
          // 無視
        }
      }
    };
  }, []);

  return { isListening, isSupported, start, stop, toggle };
}
