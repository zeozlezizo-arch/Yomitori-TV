"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createWorker, type Worker } from "tesseract.js";

export interface OCRResult {
  text: string;
  confidence: number;
}

interface UseOCROptions {
  languages?: string;
  pageSegMode?: string;
}

interface UseOCRReturn {
  recognize: (
    image: HTMLCanvasElement | HTMLImageElement | ImageData | Blob | File | string
  ) => Promise<OCRResult>;
  warmup: () => Promise<void>;
  isReady: boolean;
  isLoading: boolean;
  isProcessing: boolean;
  loadProgress: number;
  recognizeProgress: number;
  error: string | null;
}

export function useOCR(options: UseOCROptions = {}): UseOCRReturn {
  const { languages = "jpn+eng", pageSegMode = "6" } = options;

  const workerRef = useRef<Worker | null>(null);
  const initPromiseRef = useRef<Promise<Worker> | null>(null);

  const [isReady, setIsReady] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0);
  const [recognizeProgress, setRecognizeProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const ensureWorker = useCallback(async (): Promise<Worker> => {
    if (workerRef.current) return workerRef.current;
    if (initPromiseRef.current) return initPromiseRef.current;

    setIsLoading(true);
    setLoadProgress(0);
    setError(null);

    initPromiseRef.current = (async () => {
      try {
        const worker = await createWorker(languages, 1, {
          logger: (m) => {
            if (m.status === "recognizing text") {
              setRecognizeProgress(Math.round((m.progress ?? 0) * 100));
            } else if (typeof m.progress === "number") {
              setLoadProgress(Math.round(m.progress * 100));
            }
          },
        });

        await worker.setParameters({
          tessedit_pageseg_mode: pageSegMode as never,
          preserve_interword_spaces: "1",
          user_defined_dpi: "300",
        });

        workerRef.current = worker;
        setIsReady(true);
        return worker;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "OCRエンジンの初期化に失敗しました";
        setError(message);
        throw err;
      } finally {
        setIsLoading(false);
        initPromiseRef.current = null;
      }
    })();

    return initPromiseRef.current;
  }, [languages, pageSegMode]);

  const warmup = useCallback(async () => {
    await ensureWorker();
  }, [ensureWorker]);

  const recognize = useCallback(
    async (
      image: HTMLCanvasElement | HTMLImageElement | ImageData | Blob | File | string
    ): Promise<OCRResult> => {
      const worker = await ensureWorker();
      setIsProcessing(true);
      setRecognizeProgress(0);
      setError(null);
      try {
        const { data } = await worker.recognize(image as never);
        return {
          text: (data.text ?? "").trim(),
          confidence: data.confidence ?? 0,
        };
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "文字認識に失敗しました";
        setError(message);
        throw err;
      } finally {
        setIsProcessing(false);
        setRecognizeProgress(0);
      }
    },
    [ensureWorker]
  );

  useEffect(() => {
    return () => {
      const worker = workerRef.current;
      workerRef.current = null;
      if (worker) {
        worker.terminate().catch(() => {});
      }
    };
  }, []);

  return {
    recognize,
    warmup,
    isReady,
    isLoading,
    isProcessing,
    loadProgress,
    recognizeProgress,
    error,
  };
}
