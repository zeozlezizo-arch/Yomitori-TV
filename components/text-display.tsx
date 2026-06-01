"use client";

import {
  Volume2,
  VolumeX,
  Pause,
  Play,
  Square,
  Settings2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

interface TextDisplayProps {
  text: string;
  confidence?: number;
}

export function TextDisplay({ text, confidence }: TextDisplayProps) {
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
    if (isSpeaking && !isPaused) {
      pause();
    } else if (isPaused) {
      resume();
    } else {
      speak(text);
    }
  };

  if (!text) {
    return null;
  }

  return (
    <Card className="w-full">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-xl">認識結果</CardTitle>
          {confidence !== undefined && (
            <span className="text-sm text-muted-foreground">
              精度: {Math.round(confidence)}%
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Recognized Text */}
        <div className="bg-muted p-4 rounded-lg max-h-48 overflow-y-auto">
          <p className="text-foreground whitespace-pre-wrap leading-relaxed text-lg">
            {text || "テキストが認識されませんでした"}
          </p>
        </div>

        {/* Speech Controls */}
        {isSupported ? (
          <div className="space-y-4">
            <div className="flex gap-2">
              <Button
                onClick={handleSpeak}
                size="lg"
                className="flex-1 h-14 text-lg font-semibold gap-2"
                aria-label={
                  isSpeaking ? (isPaused ? "再開" : "一時停止") : "読み上げ"
                }
              >
                {isSpeaking ? (
                  isPaused ? (
                    <>
                      <Play className="h-6 w-6" />
                      再開
                    </>
                  ) : (
                    <>
                      <Pause className="h-6 w-6" />
                      一時停止
                    </>
                  )
                ) : (
                  <>
                    <Volume2 className="h-6 w-6" />
                    読み上げる
                  </>
                )}
              </Button>

              {isSpeaking && (
                <Button
                  onClick={stop}
                  variant="destructive"
                  size="lg"
                  className="h-14 px-6"
                  aria-label="停止"
                >
                  <Square className="h-6 w-6" />
                </Button>
              )}

              <Button
                onClick={() => setShowSettings(!showSettings)}
                variant="outline"
                size="lg"
                className="h-14 px-4"
                aria-label="設定"
              >
                <Settings2 className="h-6 w-6" />
              </Button>
            </div>

            {/* Settings Panel */}
            {showSettings && (
              <div className="bg-secondary p-4 rounded-lg space-y-4">
                {/* Voice Selection */}
                {japaneseVoices.length > 0 && (
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-secondary-foreground">
                      音声
                    </label>
                    <Select
                      value={selectedVoice?.name || ""}
                      onValueChange={(value) => {
                        const voice = voices.find((v) => v.name === value);
                        setSelectedVoice(voice || null);
                      }}
                    >
                      <SelectTrigger className="w-full">
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
                <div className="space-y-2">
                  <label className="text-sm font-medium text-secondary-foreground">
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
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2 text-destructive p-3 bg-destructive/10 rounded-lg">
            <VolumeX className="h-5 w-5" />
            <span>このブラウザは音声合成に対応していません</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
