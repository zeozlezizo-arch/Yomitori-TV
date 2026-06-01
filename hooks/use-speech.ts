"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { splitIntoSpeechSegments } from "@/lib/japanese-text";

// 文と文のあいだに入れる「間」（ミリ秒）。自然なペースで読ませるため。
const INTER_SEGMENT_PAUSE_MS = 350;

interface UseSpeechReturn {
  speak: (text: string) => void;
  stop: () => void;
  pause: () => void;
  resume: () => void;
  isSpeaking: boolean;
  isPaused: boolean;
  isSupported: boolean;
  voices: SpeechSynthesisVoice[];
  selectedVoice: SpeechSynthesisVoice | null;
  setSelectedVoice: (voice: SpeechSynthesisVoice | null) => void;
  rate: number;
  setRate: (rate: number) => void;
}

export function useSpeech(): UseSpeechReturn {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoice, setSelectedVoice] =
    useState<SpeechSynthesisVoice | null>(null);
  const [rate, setRate] = useState(1);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  // 文単位の読み上げキュー管理
  const segmentsRef = useRef<string[]>([]);
  const segmentIndexRef = useRef(0);
  const pauseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      setIsSupported(true);

      const loadVoices = () => {
        const availableVoices = window.speechSynthesis.getVoices();
        setVoices(availableVoices);

        // 日本語の音声を優先選択
        const japaneseVoice = availableVoices.find(
          (voice) => voice.lang.startsWith("ja") || voice.lang === "ja-JP"
        );
        if (japaneseVoice && !selectedVoice) {
          setSelectedVoice(japaneseVoice);
        }
      };

      loadVoices();
      window.speechSynthesis.onvoiceschanged = loadVoices;

      return () => {
        window.speechSynthesis.onvoiceschanged = null;
      };
    }
  }, [selectedVoice]);

  // キュー内の次の文を読み上げる。文末で「間」を入れてから次へ進む。
  const speakNextSegment = useCallback(() => {
    if (cancelledRef.current) return;

    const index = segmentIndexRef.current;
    const segments = segmentsRef.current;

    if (index >= segments.length) {
      setIsSpeaking(false);
      setIsPaused(false);
      return;
    }

    const utterance = new SpeechSynthesisUtterance(segments[index]);
    utterance.rate = rate;
    utterance.pitch = 1;
    utterance.volume = 1;
    if (selectedVoice) {
      utterance.voice = selectedVoice;
    }

    utterance.onstart = () => {
      if (utteranceRef.current !== utterance) return;
      setIsSpeaking(true);
      setIsPaused(false);
    };

    utterance.onend = () => {
      // 直前にキャンセル／別の読み上げに差し替えられた古い発話は無視する
      if (cancelledRef.current || utteranceRef.current !== utterance) return;
      segmentIndexRef.current += 1;
      if (segmentIndexRef.current >= segmentsRef.current.length) {
        setIsSpeaking(false);
        setIsPaused(false);
        return;
      }
      // 次の文へ進む前に少し間を置く
      pauseTimerRef.current = setTimeout(speakNextSegment, INTER_SEGMENT_PAUSE_MS);
    };

    utterance.onerror = () => {
      if (utteranceRef.current !== utterance) return;
      setIsSpeaking(false);
      setIsPaused(false);
    };

    utteranceRef.current = utterance;
    window.speechSynthesis.speak(utterance);
  }, [rate, selectedVoice]);

  const speak = useCallback(
    (text: string) => {
      if (!isSupported || !text.trim()) return;

      // 既存の読み上げ・予約タイマーを停止
      if (pauseTimerRef.current) {
        clearTimeout(pauseTimerRef.current);
        pauseTimerRef.current = null;
      }
      window.speechSynthesis.cancel();

      // 文単位に分割して順番に読み上げる
      segmentsRef.current = splitIntoSpeechSegments(text);
      segmentIndexRef.current = 0;
      cancelledRef.current = false;

      if (segmentsRef.current.length === 0) return;

      setIsSpeaking(true);
      setIsPaused(false);
      speakNextSegment();
    },
    [isSupported, speakNextSegment]
  );

  const stop = useCallback(() => {
    if (!isSupported) return;
    cancelledRef.current = true;
    if (pauseTimerRef.current) {
      clearTimeout(pauseTimerRef.current);
      pauseTimerRef.current = null;
    }
    segmentsRef.current = [];
    segmentIndexRef.current = 0;
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
    setIsPaused(false);
  }, [isSupported]);

  const pause = useCallback(() => {
    if (!isSupported) return;
    window.speechSynthesis.pause();
    setIsPaused(true);
  }, [isSupported]);

  const resume = useCallback(() => {
    if (!isSupported) return;
    window.speechSynthesis.resume();
    setIsPaused(false);
  }, [isSupported]);

  // アンマウント時に読み上げと予約タイマーを確実に止める
  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  return {
    speak,
    stop,
    pause,
    resume,
    isSpeaking,
    isPaused,
    isSupported,
    voices,
    selectedVoice,
    setSelectedVoice,
    rate,
    setRate,
  };
}
