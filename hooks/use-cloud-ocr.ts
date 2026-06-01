"use client";

import { useCallback, useState } from "react";

export interface CloudOCRResult {
  text: string;
  confidence: number;
}

// クラウドOCRが未設定（APIキー無し）であることを示す専用エラー。
// これを受け取った呼び出し側は、以後ローカルOCRに切り替える。
export class CloudOCRUnavailableError extends Error {
  constructor(message = "クラウドOCRが設定されていません") {
    super(message);
    this.name = "CloudOCRUnavailableError";
  }
}

interface UseCloudOCRReturn {
  recognize: (dataUrl: string) => Promise<CloudOCRResult>;
  isProcessing: boolean;
  error: string | null;
}

/**
 * サーバーの /api/ocr 経由で Google Cloud Vision を呼び出すフック。
 * APIキーはサーバー側にのみ存在し、ブラウザには渡らない。
 */
export function useCloudOCR(): UseCloudOCRReturn {
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recognize = useCallback(
    async (dataUrl: string): Promise<CloudOCRResult> => {
      setIsProcessing(true);
      setError(null);
      try {
        const res = await fetch("/api/ocr", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: dataUrl }),
        });

        // 503 = APIキー未設定。フォールバック用の専用エラーを投げる。
        if (res.status === 503) {
          throw new CloudOCRUnavailableError();
        }

        const data = (await res.json()) as {
          text?: string;
          confidence?: number;
          error?: string;
        };

        if (!res.ok) {
          throw new Error(data.error || `OCRに失敗しました (${res.status})`);
        }

        return {
          text: (data.text ?? "").trim(),
          confidence: data.confidence ?? 0,
        };
      } catch (err) {
        if (!(err instanceof CloudOCRUnavailableError)) {
          setError(err instanceof Error ? err.message : "OCRに失敗しました");
        }
        throw err;
      } finally {
        setIsProcessing(false);
      }
    },
    []
  );

  return { recognize, isProcessing, error };
}
