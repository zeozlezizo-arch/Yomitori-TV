"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Camera,
  CameraOff,
  SwitchCamera,
  Volume2,
  VolumeX,
  Settings2,
  X,
  Loader2,
  Trash2,
  Mic,
  MicOff,
} from "lucide-react";
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
import { useOCR } from "@/hooks/use-ocr";
import { useCloudOCR, CloudOCRUnavailableError } from "@/hooks/use-cloud-ocr";
import { useVoiceCommand } from "@/hooks/use-voice-command";
import { cleanOcrText, prepareForSpeech } from "@/lib/japanese-text";

const MIN_CONFIDENCE = 55;
const MIN_TEXT_LENGTH = 2;
const AUTO_LOOP_DELAY_MS = 600;
const OCR_TARGET_MIN_WIDTH = 1280;
// ブレ対策：取得して鮮明さを比較するフレーム数（手動は多め・自動は少なめ）
const SHARPEST_FRAMES_MANUAL = 6;
const SHARPEST_FRAMES_AUTO = 3;
// 鮮明さスコア用の縮小幅
const SHARPNESS_SCORE_WIDTH = 320;

function normalizeForCompare(s: string): string {
  return s.replace(/\s+/g, "").toLowerCase();
}

function computeCropRegion(
  video: HTMLVideoElement,
  guide: HTMLElement
): { sx: number; sy: number; sw: number; sh: number } {
  const vW = video.videoWidth;
  const vH = video.videoHeight;
  if (!vW || !vH) {
    return { sx: 0, sy: 0, sw: vW || 0, sh: vH || 0 };
  }

  const videoRect = video.getBoundingClientRect();
  const guideRect = guide.getBoundingClientRect();
  if (videoRect.width === 0 || videoRect.height === 0) {
    return { sx: 0, sy: 0, sw: vW, sh: vH };
  }

  // object-cover: scale so video covers container; cropped sides are off-screen.
  const scale = Math.max(videoRect.width / vW, videoRect.height / vH);
  const displayedW = vW * scale;
  const displayedH = vH * scale;
  const offsetX = (videoRect.width - displayedW) / 2;
  const offsetY = (videoRect.height - displayedH) / 2;

  const guideLeftInContainer = guideRect.left - videoRect.left;
  const guideTopInContainer = guideRect.top - videoRect.top;

  let sx = (guideLeftInContainer - offsetX) / scale;
  let sy = (guideTopInContainer - offsetY) / scale;
  let sw = guideRect.width / scale;
  let sh = guideRect.height / scale;

  sx = Math.max(0, Math.min(sx, vW));
  sy = Math.max(0, Math.min(sy, vH));
  sw = Math.max(1, Math.min(sw, vW - sx));
  sh = Math.max(1, Math.min(sh, vH - sy));

  return { sx, sy, sw, sh };
}

function preprocessForOCR(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return;
  const { width, height } = canvas;
  const imageData = ctx.getImageData(0, 0, width, height);
  const d = imageData.data;
  const total = width * height;

  // Pass 1: グレースケール化 + ヒストグラム作成
  const hist = new Array<number>(256).fill(0);
  for (let i = 0; i < d.length; i += 4) {
    const gray = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;
    d[i] = gray;
    d[i + 1] = gray;
    d[i + 2] = gray;
    hist[gray]++;
  }

  // Pass 2: 大津の手法で最適な二値化しきい値を求める。
  // ゲームのセリフ枠は文字と背景のコントラストが高いので、二値化すると
  // 記号として誤認識される中間調ノイズを大きく減らせる。
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];

  let sumB = 0;
  let wB = 0;
  let maxVar = -1;
  let threshold = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > maxVar) {
      maxVar = between;
      threshold = t;
    }
  }

  // 文字色の極性を判定：暗い画素が多数なら背景が暗い（白文字）とみなし、
  // Tesseract が得意な「白地に黒文字」へ反転して揃える。
  let darkCount = 0;
  for (let t = 0; t <= threshold; t++) darkCount += hist[t];
  const backgroundIsDark = darkCount > total / 2;

  // Pass 3: 二値化
  for (let i = 0; i < d.length; i += 4) {
    let v = d[i] <= threshold ? 0 : 255;
    if (backgroundIsDark) v = 255 - v;
    d[i] = v;
    d[i + 1] = v;
    d[i + 2] = v;
  }

  ctx.putImageData(imageData, 0, 0);
}

// 縮小したグレースケール画像のラプラシアン分散を「鮮明さ（ピントの合い具合）」の
// 指標として求める。手ブレ・ピンボケのフレームほど値が小さくなる。
function computeSharpness(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number
): number {
  if (w < 3 || h < 3) return 0;
  const d = ctx.getImageData(0, 0, w, h).data;

  // まずグレースケール値の配列を作る
  const gray = new Float32Array(w * h);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    gray[p] = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
  }

  // 4近傍ラプラシアンの分散を計算
  let sum = 0;
  let sumSq = 0;
  let count = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const c = gray[y * w + x];
      const lap =
        4 * c -
        gray[(y - 1) * w + x] -
        gray[(y + 1) * w + x] -
        gray[y * w + x - 1] -
        gray[y * w + x + 1];
      sum += lap;
      sumSq += lap * lap;
      count++;
    }
  }
  if (count === 0) return 0;
  const mean = sum / count;
  return sumSq / count - mean * mean;
}

// 短時間に複数フレームを取得し、最も鮮明な（ブレの少ない）フレームを
// メインキャンバスへ描画する。手ブレ・カメラ位置のブレによる精度低下を抑える。
// 返り値は採用したフレームの鮮明さスコア。
async function captureSharpestFrame(
  video: HTMLVideoElement,
  mainCanvas: HTMLCanvasElement,
  scoreCanvas: HTMLCanvasElement,
  crop: { sx: number; sy: number; sw: number; sh: number },
  targetW: number,
  targetH: number,
  frames: number
): Promise<number> {
  const mainCtx = mainCanvas.getContext("2d", { willReadFrequently: true });
  const scoreCtx = scoreCanvas.getContext("2d", { willReadFrequently: true });
  if (!mainCtx || !scoreCtx) return 0;

  const SW = scoreCanvas.width;
  const SH = scoreCanvas.height;

  let bestScore = -1;
  for (let i = 0; i < frames; i++) {
    // 評価用に縮小して描画 → 鮮明さを計算
    scoreCtx.drawImage(
      video,
      crop.sx,
      crop.sy,
      crop.sw,
      crop.sh,
      0,
      0,
      SW,
      SH
    );
    const score = computeSharpness(scoreCtx, SW, SH);

    // これまでで最も鮮明なら、同じフレームをフル解像度でメインへ描画して採用
    if (score > bestScore) {
      bestScore = score;
      mainCtx.imageSmoothingEnabled = true;
      mainCtx.imageSmoothingQuality = "high";
      mainCtx.drawImage(
        video,
        crop.sx,
        crop.sy,
        crop.sw,
        crop.sh,
        0,
        0,
        targetW,
        targetH
      );
    }

    // 次のフレームが届くのを少し待つ（カメラは概ね30fps）
    if (i < frames - 1) {
      await new Promise((r) => setTimeout(r, 45));
    }
  }

  return bestScore;
}

export function TVTextScanner() {
  // Camera
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scoreCanvasRef = useRef<HTMLCanvasElement>(null);
  const scanGuideRef = useRef<HTMLDivElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [facingMode, setFacingMode] = useState<"user" | "environment">(
    "environment"
  );
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraLoading, setCameraLoading] = useState(false);

  // OCR — クラウド(Google Cloud Vision)を優先し、未設定・失敗時はローカル(Tesseract)へフォールバック
  const cloudOcr = useCloudOCR();
  const {
    recognize: recognizeLocal,
    isLoading: localLoading,
    isProcessing: localProcessing,
    loadProgress,
    recognizeProgress,
    error: localError,
  } = useOCR({ languages: "jpn+eng", pageSegMode: "6" });

  // クラウドOCRが利用不可（キー未設定）と分かったら true。以降はローカルのみ使う。
  const cloudUnavailableRef = useRef(false);

  const ocrProcessing = cloudOcr.isProcessing || localProcessing;
  const ocrLoading = localLoading;
  const ocrError = cloudOcr.error || localError;

  const [recognizedText, setRecognizedText] = useState("");
  const [recognizedConfidence, setRecognizedConfidence] = useState<number | null>(
    null
  );
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Auto mode
  const [autoMode, setAutoMode] = useState(false);
  const autoModeRef = useRef(false);
  const processingRef = useRef(false);
  const lastSpokenRef = useRef<string>("");

  // Speech
  const {
    speak,
    stop,
    isSpeaking,
    isSupported,
    voices,
    selectedVoice,
    setSelectedVoice,
    rate,
    setRate,
  } = useSpeech();

  // Settings
  const [showSettings, setShowSettings] = useState(false);

  const japaneseVoices = voices.filter(
    (voice) => voice.lang.startsWith("ja") || voice.lang === "ja-JP"
  );

  // ---- Camera lifecycle ----------------------------------------------------

  const startCamera = useCallback(async () => {
    setCameraLoading(true);
    setCameraError(null);

    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }

    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode,
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });

      setStream(mediaStream);

      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
        await videoRef.current.play().catch(() => {});
      }

      setIsCameraOn(true);
      // クラウドOCRを使うため、重い Tesseract の事前読み込みは行わない。
      // （クラウドが使えない時だけ、認識時にローカルOCRを遅延ロードする）
    } catch {
      setCameraError("カメラへのアクセスを許可してください");
      setIsCameraOn(false);
    } finally {
      setCameraLoading(false);
    }
  }, [facingMode, stream]);

  const stopCamera = useCallback(() => {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      setStream(null);
    }
    setIsCameraOn(false);
    setAutoMode(false);
    autoModeRef.current = false;
    stop();
  }, [stream, stop]);

  const switchCamera = useCallback(() => {
    setFacingMode((prev) => (prev === "user" ? "environment" : "user"));
  }, []);

  useEffect(() => {
    if (isCameraOn) {
      startCamera();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facingMode]);

  useEffect(() => {
    return () => {
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [stream]);

  // ---- Capture + OCR -------------------------------------------------------

  const captureAndRecognize = useCallback(async (): Promise<string | null> => {
    if (
      !videoRef.current ||
      !canvasRef.current ||
      processingRef.current ||
      !isCameraOn
    ) {
      return null;
    }

    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (video.readyState < video.HAVE_CURRENT_DATA) return null;
    if (!video.videoWidth || !video.videoHeight) return null;

    processingRef.current = true;
    setStatusMessage(null);

    try {
      // 1. Crop to the on-screen scan guide (so we don't OCR overlays/background).
      const guide = scanGuideRef.current;
      const crop = guide
        ? computeCropRegion(video, guide)
        : {
            sx: 0,
            sy: 0,
            sw: video.videoWidth,
            sh: video.videoHeight,
          };

      // 2. 小さい切り出しは拡大する（OCR精度は解像度に依存するため）。
      const upscale = Math.max(1, OCR_TARGET_MIN_WIDTH / crop.sw);
      const targetW = Math.round(crop.sw * upscale);
      const targetH = Math.round(crop.sh * upscale);

      canvas.width = targetW;
      canvas.height = targetH;

      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return null;

      // 2b. ブレ対策：短時間に複数フレームを撮り、最も鮮明な1枚を採用する。
      const scoreCanvas = scoreCanvasRef.current;
      if (scoreCanvas) {
        scoreCanvas.width = SHARPNESS_SCORE_WIDTH;
        scoreCanvas.height = Math.max(
          1,
          Math.round((SHARPNESS_SCORE_WIDTH * crop.sh) / crop.sw)
        );
        const frames = autoModeRef.current
          ? SHARPEST_FRAMES_AUTO
          : SHARPEST_FRAMES_MANUAL;
        await captureSharpestFrame(
          video,
          canvas,
          scoreCanvas,
          crop,
          targetW,
          targetH,
          frames
        );
      } else {
        // フォールバック：1フレームだけ描画
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(
          video,
          crop.sx,
          crop.sy,
          crop.sw,
          crop.sh,
          0,
          0,
          targetW,
          targetH
        );
      }

      // 認識：クラウドOCR(Google Cloud Vision)を優先し、未設定・失敗時はローカル(Tesseract)へ。
      let text = "";
      let confidence = 0;
      let cloudSucceeded = false;

      if (!cloudUnavailableRef.current) {
        try {
          // クラウドOCRは自然なカラー画像が得意なので、加工せず送る。
          const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
          const result = await cloudOcr.recognize(dataUrl);
          text = result.text;
          confidence = result.confidence;
          cloudSucceeded = true;
        } catch (err) {
          // キー未設定なら以降は常にローカルを使う
          if (err instanceof CloudOCRUnavailableError) {
            cloudUnavailableRef.current = true;
          }
          // それ以外（通信失敗等）はこの撮影だけローカルにフォールバック
        }
      }

      if (!cloudSucceeded) {
        // ローカル(Tesseract)用に二値化してから認識する。
        preprocessForOCR(canvas);
        const result = await recognizeLocal(canvas);
        text = result.text;
        confidence = result.confidence;
      }

      // 日本語のセリフ部分だけを残し、記号ノイズを除去する
      const cleaned = cleanOcrText(text);

      if (cleaned.length < MIN_TEXT_LENGTH || confidence < MIN_CONFIDENCE) {
        if (!autoModeRef.current) {
          setStatusMessage(
            cleaned.length === 0
              ? "文字が検出できませんでした。明るさや距離を調整してみてください。"
              : `認識精度が低すぎます（${Math.round(
                  confidence
                )}%）。もう少し近づくか、画面の反射を避けて撮影してください。`
          );
        }
        return null;
      }

      setRecognizedText(cleaned);
      setRecognizedConfidence(confidence);
      return cleaned;
    } catch (err) {
      if (!autoModeRef.current) {
        setStatusMessage(
          err instanceof Error ? err.message : "文字認識に失敗しました"
        );
      }
      return null;
    } finally {
      processingRef.current = false;
    }
  }, [isCameraOn, cloudOcr.recognize, recognizeLocal]);

  // ---- Auto-mode loop (chained, not interval) ------------------------------

  const runAutoLoop = useCallback(async () => {
    while (autoModeRef.current && isCameraOn) {
      const text = await captureAndRecognize();
      if (text) {
        const normalized = normalizeForCompare(text);
        // 直前に読み上げた内容と違うときだけ読み上げる（同じ画面の連呼を防ぐ）
        if (normalized !== normalizeForCompare(lastSpokenRef.current)) {
          lastSpokenRef.current = text;
          speak(prepareForSpeech(text));
        }
      }
      if (!autoModeRef.current) break;
      await new Promise((r) => setTimeout(r, AUTO_LOOP_DELAY_MS));
    }
  }, [captureAndRecognize, isCameraOn, speak]);

  const toggleAutoMode = useCallback(() => {
    setAutoMode((prev) => {
      const next = !prev;
      autoModeRef.current = next;
      if (next) {
        lastSpokenRef.current = "";
        void runAutoLoop();
      } else {
        stop();
      }
      return next;
    });
  }, [runAutoLoop, stop]);

  // ---- Manual actions ------------------------------------------------------

  // 利用者が「読んで」と指示したタイミングで、その場で撮影→認識→読み上げを行う。
  const handleReadAloud = useCallback(async () => {
    if (autoMode) return;
    // 読み上げ中ならまず止める（同じボタンで停止できる）
    if (isSpeaking) {
      stop();
      return;
    }
    const text = await captureAndRecognize();
    if (text) {
      lastSpokenRef.current = text;
      speak(prepareForSpeech(text));
    }
  }, [autoMode, isSpeaking, stop, captureAndRecognize, speak]);

  // 直前に認識したテキストをもう一度読み上げる（再撮影なし）。
  const handleRepeat = useCallback(() => {
    if (!recognizedText) return;
    if (isSpeaking) {
      stop();
    } else {
      speak(prepareForSpeech(recognizedText));
    }
  }, [recognizedText, isSpeaking, speak, stop]);

  // 音声コマンド「読んで」で呼ばれる。その場で撮影→認識→読み上げ。
  // 自動モード中や認識処理中は重複を避けて無視する。
  const handleVoiceTrigger = useCallback(() => {
    if (autoModeRef.current || processingRef.current) return;
    void (async () => {
      const text = await captureAndRecognize();
      if (text) {
        lastSpokenRef.current = text;
        speak(prepareForSpeech(text));
      }
    })();
  }, [captureAndRecognize, speak]);

  const voice = useVoiceCommand(handleVoiceTrigger);

  // カメラを閉じたら音声コマンドの聞き取りも止める
  useEffect(() => {
    if (!isCameraOn) voice.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCameraOn]);

  const handleClear = useCallback(() => {
    stop();
    setRecognizedText("");
    setRecognizedConfidence(null);
    setStatusMessage(null);
    lastSpokenRef.current = "";
  }, [stop]);

  // ---- Render --------------------------------------------------------------

  const showProcessingBadge = ocrProcessing || ocrLoading;
  const processingLabel = ocrLoading
    ? `エンジン読込中${loadProgress ? ` ${loadProgress}%` : ""}`
    : recognizeProgress > 0
      ? `認識中 ${recognizeProgress}%`
      : "認識中";

  return (
    <div className="fixed inset-0 bg-background flex flex-col overflow-hidden">
      <div className="flex-1 relative bg-black">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`absolute inset-0 w-full h-full object-cover ${
            isCameraOn ? "opacity-100" : "opacity-0"
          }`}
        />

        <canvas ref={canvasRef} className="hidden" />
        <canvas ref={scoreCanvasRef} className="hidden" />

        {!isCameraOn && !cameraLoading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center">
            <CameraOff className="h-16 w-16 text-muted-foreground mb-4" />
            <h2 className="text-xl font-bold text-foreground mb-2">
              TV文字読み上げ
            </h2>
            <p className="text-muted-foreground mb-6 max-w-xs">
              カメラを起動してテレビ画面の文字を認識・読み上げします
            </p>
            {cameraError && (
              <p className="text-destructive text-sm mb-4">{cameraError}</p>
            )}
            <Button
              onClick={startCamera}
              size="lg"
              className="h-16 px-8 text-xl font-bold gap-3"
            >
              <Camera className="h-7 w-7" />
              カメラを起動
            </Button>
          </div>
        )}

        {cameraLoading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="h-12 w-12 text-primary animate-spin" />
          </div>
        )}

        {isCameraOn && (
          <>
            <div className="absolute top-0 left-0 right-0 p-3 flex items-center justify-between bg-gradient-to-b from-black/60 to-transparent">
              <Button
                onClick={stopCamera}
                variant="ghost"
                size="icon"
                className="h-12 w-12 text-white bg-black/30 hover:bg-black/50"
                aria-label="カメラを閉じる"
              >
                <X className="h-6 w-6" />
              </Button>

              <div className="flex items-center gap-2">
                {showProcessingBadge && (
                  <div className="flex items-center gap-2 bg-black/50 px-3 py-1.5 rounded-full">
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    <span className="text-white text-sm">{processingLabel}</span>
                  </div>
                )}
                {autoMode && !showProcessingBadge && (
                  <div className="bg-primary/80 px-3 py-1.5 rounded-full">
                    <span className="text-primary-foreground text-sm font-medium">
                      自動モード
                    </span>
                  </div>
                )}
                {voice.isListening && !showProcessingBadge && !autoMode && (
                  <div className="flex items-center gap-1.5 bg-red-500/80 px-3 py-1.5 rounded-full">
                    <Mic className="h-4 w-4 text-white animate-pulse" />
                    <span className="text-white text-sm font-medium">
                      「読んで」で読み上げ
                    </span>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2">
                {voice.isSupported && (
                  <Button
                    onClick={voice.toggle}
                    variant="ghost"
                    size="icon"
                    className={`h-12 w-12 text-white hover:bg-black/50 ${
                      voice.isListening ? "bg-red-500/70" : "bg-black/30"
                    }`}
                    aria-label={
                      voice.isListening
                        ? "音声コマンドをOFF"
                        : "音声コマンドをON（「読んで」で読み上げ）"
                    }
                    title={
                      voice.isListening
                        ? "音声コマンドをOFF"
                        : "音声コマンドをON（「読んで」で読み上げ）"
                    }
                  >
                    {voice.isListening ? (
                      <Mic className="h-6 w-6" />
                    ) : (
                      <MicOff className="h-6 w-6" />
                    )}
                  </Button>
                )}

                <Button
                  onClick={switchCamera}
                  variant="ghost"
                  size="icon"
                  className="h-12 w-12 text-white bg-black/30 hover:bg-black/50"
                  aria-label="カメラ切り替え"
                >
                  <SwitchCamera className="h-6 w-6" />
                </Button>
              </div>
            </div>

            {/* Scan guide — this is the actual OCR crop region */}
            <div
              ref={scanGuideRef}
              className="absolute inset-x-4 top-20 bottom-48 border-2 border-primary/60 rounded-xl pointer-events-none"
            >
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary px-3 py-1 rounded-full">
                <span className="text-primary-foreground text-xs font-medium">
                  読み取りたい文字をこの枠内に
                </span>
              </div>
            </div>

            {/* Status / recognized text overlay */}
            {(recognizedText || statusMessage || ocrError) && (
              <div className="absolute left-3 right-3 bottom-48 bg-black/75 rounded-xl p-3 backdrop-blur-sm">
                {recognizedText && (
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div className="flex items-center gap-2">
                      {recognizedConfidence !== null && (
                        <span
                          className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                            recognizedConfidence >= 80
                              ? "bg-accent/30 text-accent"
                              : "bg-yellow-500/30 text-yellow-300"
                          }`}
                        >
                          精度 {Math.round(recognizedConfidence)}%
                        </span>
                      )}
                    </div>
                    <Button
                      onClick={handleClear}
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-white/70 hover:text-white hover:bg-white/10 -mt-1 -mr-1"
                      aria-label="テキストをクリア"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                )}
                {recognizedText && (
                  <p className="text-white text-sm leading-relaxed whitespace-pre-wrap max-h-32 overflow-y-auto">
                    {recognizedText.slice(0, 400)}
                    {recognizedText.length > 400 && "\u2026"}
                  </p>
                )}
                {!recognizedText && (statusMessage || ocrError) && (
                  <p className="text-yellow-200 text-sm leading-relaxed">
                    {statusMessage || ocrError}
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Bottom control bar */}
      <div className="bg-card border-t border-border p-4">
        <div className="flex items-center gap-3 max-w-lg mx-auto">
          {isCameraOn ? (
            <>
              <Button
                onClick={toggleAutoMode}
                variant={autoMode ? "default" : "outline"}
                size="lg"
                className={`flex-1 h-16 text-base font-bold gap-2 ${
                  autoMode ? "bg-primary" : ""
                }`}
              >
                {autoMode ? (
                  <>
                    <VolumeX className="h-6 w-6" />
                    自動OFF
                  </>
                ) : (
                  <>
                    <Volume2 className="h-6 w-6" />
                    自動ON
                  </>
                )}
              </Button>

              {!autoMode && (
                <Button
                  onClick={handleReadAloud}
                  variant="secondary"
                  size="lg"
                  disabled={ocrProcessing || ocrLoading}
                  className="flex-1 h-16 text-base font-bold gap-2"
                >
                  {ocrLoading ? (
                    <>
                      <Loader2 className="h-6 w-6 animate-spin" />
                      準備中
                    </>
                  ) : ocrProcessing ? (
                    <>
                      <Loader2 className="h-6 w-6 animate-spin" />
                      認識中
                    </>
                  ) : isSpeaking ? (
                    <>
                      <VolumeX className="h-6 w-6" />
                      停止
                    </>
                  ) : (
                    <>
                      <Volume2 className="h-6 w-6" />
                      読む
                    </>
                  )}
                </Button>
              )}

              {!autoMode && recognizedText && !isSpeaking && (
                <Button
                  onClick={handleRepeat}
                  variant="outline"
                  size="lg"
                  disabled={ocrProcessing || ocrLoading}
                  className="h-16 w-16"
                  aria-label="もう一度読み上げ"
                  title="もう一度読み上げ"
                >
                  <Volume2 className="h-6 w-6" />
                </Button>
              )}

              <Button
                onClick={() => setShowSettings(true)}
                variant="outline"
                size="lg"
                className="h-16 w-16"
                aria-label="設定"
              >
                <Settings2 className="h-6 w-6" />
              </Button>
            </>
          ) : (
            <Button
              onClick={startCamera}
              size="lg"
              className="flex-1 h-16 text-xl font-bold gap-3"
            >
              <Camera className="h-7 w-7" />
              カメラを起動
            </Button>
          )}
        </div>
      </div>

      {/* Settings panel */}
      {showSettings && (
        <div className="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm flex flex-col">
          <div className="p-4 border-b border-border flex items-center justify-between">
            <h2 className="text-xl font-bold text-foreground">設定</h2>
            <Button
              onClick={() => setShowSettings(false)}
              variant="ghost"
              size="icon"
              className="h-12 w-12"
              aria-label="閉じる"
            >
              <X className="h-6 w-6" />
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-6">
            {isSupported && japaneseVoices.length > 0 && (
              <div className="space-y-3">
                <label className="text-base font-medium text-foreground">
                  音声
                </label>
                <Select
                  value={selectedVoice?.name || ""}
                  onValueChange={(value) => {
                    const voice = voices.find((v) => v.name === value);
                    setSelectedVoice(voice || null);
                  }}
                >
                  <SelectTrigger className="w-full h-14 text-base">
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

            {isSupported && (
              <div className="space-y-4">
                <label className="text-base font-medium text-foreground">
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
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>遅い</span>
                  <span>普通</span>
                  <span>速い</span>
                </div>
              </div>
            )}

            <div className="bg-muted rounded-xl p-4 space-y-3">
              <h3 className="font-semibold text-foreground">使い方</h3>
              <ul className="text-sm text-muted-foreground space-y-2">
                <li>1. カメラを起動してセリフの枠を読み取り枠内に収める</li>
                <li>2.「読む」ボタンを押すとその場で認識して読み上げます</li>
                <li>3. 右上のマイクをONにして「読んで」と声に出すと読み上げます</li>
                <li>4.「自動ON」にすると画面が変わるたびに自動で読み上げます</li>
                <li>5. 撮影時は数枚から最も鮮明な画像を自動採用します（手ブレ対策）</li>
                <li>6. 精度が低い時は、近づく・画面の反射を避ける・明るくする</li>
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
