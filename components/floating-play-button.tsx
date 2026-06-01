"use client";

import { Volume2, Pause, Play, Square, Settings2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { useSpeech } from "@/hooks/use-speech";
import { useState } from "react";

interface FloatingPlayButtonProps {
  text: string | null;
}

export function FloatingPlayButton({ text }: FloatingPlayButtonProps) {
  const {
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
  } = useSpeech();

  const [showSettings, setShowSettings] = useState(false);

  const japaneseVoices = voices.filter(
    (voice) => voice.lang.startsWith("ja") || voice.lang === "ja-JP"
  );

  const handleSpeak = () => {
    if (!text) return;
    
    if (isSpeaking && !isPaused) {
      pause();
    } else if (isPaused) {
      resume();
    } else {
      speak(text);
    }
  };

  if (!isSupported) {
    return null;
  }

  const hasText = text && text.trim().length > 0;

  return (
    <>
      {/* Settings Panel Overlay */}
      {showSettings && (
        <div className="fixed inset-0 z-40 bg-background/80 backdrop-blur-sm">
          <div className="fixed bottom-24 left-4 right-4 z-50 max-w-lg mx-auto">
            <div className="bg-card border border-border rounded-2xl p-5 shadow-2xl space-y-5">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-foreground">音声設定</h3>
                <Button
                  onClick={() => setShowSettings(false)}
                  variant="ghost"
                  size="icon"
                  className="h-10 w-10"
                  aria-label="閉じる"
                >
                  <X className="h-5 w-5" />
                </Button>
              </div>

              {/* Voice Selection */}
              {japaneseVoices.length > 0 && (
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">
                    音声
                  </label>
                  <Select
                    value={selectedVoice?.name || ""}
                    onValueChange={(value) => {
                      const voice = voices.find((v) => v.name === value);
                      setSelectedVoice(voice || null);
                    }}
                  >
                    <SelectTrigger className="w-full h-12">
                      <SelectValue placeholder="音声を選択" />
                    </SelectTrigger>
                    <SelectContent>
                      {japaneseVoices.map((voice) => (
                        <SelectItem key={voice.name} value={voice.name}>
                          {voice.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Speed Control */}
              <div className="space-y-3">
                <label className="text-sm font-medium text-foreground">
                  読み上げ速度: {rate.toFixed(1)}x
                </label>
                <Slider
                  value={[rate]}
                  onValueChange={(values) => setRate(values[0])}
                  min={0.5}
                  max={2}
                  step={0.1}
                  className="w-full"
                  aria-label="読み上げ速度"
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>遅い</span>
                  <span>普通</span>
                  <span>速い</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Floating Button Bar */}
      <div className="fixed bottom-0 left-0 right-0 z-30 bg-card border-t border-border p-4 safe-area-inset-bottom">
        <div className="max-w-lg mx-auto flex items-center gap-3">
          {/* Main Play Button */}
          <Button
            onClick={handleSpeak}
            size="lg"
            disabled={!hasText}
            className="flex-1 h-16 text-xl font-bold gap-3 disabled:opacity-50"
            aria-label={
              !hasText
                ? "テキストがありません"
                : isSpeaking
                ? isPaused
                  ? "再開"
                  : "一時停止"
                : "読み上げ"
            }
          >
            {isSpeaking ? (
              isPaused ? (
                <>
                  <Play className="h-7 w-7" />
                  再開
                </>
              ) : (
                <>
                  <Pause className="h-7 w-7" />
                  一時停止
                </>
              )
            ) : (
              <>
                <Volume2 className="h-7 w-7" />
                {hasText ? "読み上げる" : "テキストなし"}
              </>
            )}
          </Button>

          {/* Stop Button */}
          {isSpeaking && (
            <Button
              onClick={stop}
              variant="destructive"
              size="lg"
              className="h-16 w-16"
              aria-label="停止"
            >
              <Square className="h-7 w-7" />
            </Button>
          )}

          {/* Settings Button */}
          <Button
            onClick={() => setShowSettings(!showSettings)}
            variant="outline"
            size="lg"
            className="h-16 w-16"
            aria-label="設定"
          >
            <Settings2 className="h-6 w-6" />
          </Button>
        </div>
      </div>
    </>
  );
}
