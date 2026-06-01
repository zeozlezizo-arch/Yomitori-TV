import { NextResponse } from "next/server";

// Google Cloud Vision の DOCUMENT_TEXT_DETECTION を呼び出す OCR エンドポイント。
//
// APIキーはサーバー側の環境変数にのみ保持し、ブラウザには絶対に渡さない。
//   GOOGLE_VISION_API_KEY=...  （.env.local や Vercel の環境変数に設定）
//
// クライアントからは { image: "data:image/jpeg;base64,..." } を POST する。

export const runtime = "nodejs";

const VISION_ENDPOINT = "https://vision.googleapis.com/v1/images:annotate";

interface VisionVertex {
  x?: number;
  y?: number;
}
interface VisionSymbol {
  confidence?: number;
}
interface VisionWord {
  confidence?: number;
  symbols?: VisionSymbol[];
}
interface VisionParagraph {
  confidence?: number;
  words?: VisionWord[];
}
interface VisionBlock {
  confidence?: number;
  paragraphs?: VisionParagraph[];
}
interface VisionPage {
  confidence?: number;
  blocks?: VisionBlock[];
}
interface VisionResponse {
  responses?: Array<{
    fullTextAnnotation?: {
      text?: string;
      pages?: VisionPage[];
    };
    error?: { message?: string };
  }>;
  error?: { message?: string };
}

export async function POST(request: Request) {
  const apiKey = process.env.GOOGLE_VISION_API_KEY;
  if (!apiKey) {
    // キー未設定。クライアントはこの 503 を見てローカルOCRにフォールバックする。
    return NextResponse.json(
      { error: "OCR API key not configured", configured: false },
      { status: 503 }
    );
  }

  let body: { image?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const image = body.image;
  if (!image || typeof image !== "string") {
    return NextResponse.json({ error: "Missing image" }, { status: 400 });
  }

  // data URL のプレフィックスを取り除いて純粋な base64 にする
  const base64 = image.includes(",") ? image.slice(image.indexOf(",") + 1) : image;

  try {
    const visionRes = await fetch(`${VISION_ENDPOINT}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: [
          {
            image: { content: base64 },
            features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
            // 日本語を優先。英数字も拾えるよう en も補助的に指定。
            imageContext: { languageHints: ["ja", "en"] },
          },
        ],
      }),
    });

    const data: VisionResponse = await visionRes.json();

    if (!visionRes.ok || data.error) {
      const message =
        data.error?.message ||
        data.responses?.[0]?.error?.message ||
        `Vision API error (${visionRes.status})`;
      return NextResponse.json({ error: message }, { status: 502 });
    }

    const annotation = data.responses?.[0]?.fullTextAnnotation;
    const text = annotation?.text ?? "";

    // ページの信頼度（0〜1）の平均を 0〜100 に変換。取得できなければ高めの既定値。
    const pages = annotation?.pages ?? [];
    const confidences = pages
      .map((p) => p.confidence)
      .filter((c): c is number => typeof c === "number" && c > 0);
    const confidence =
      confidences.length > 0
        ? (confidences.reduce((a, b) => a + b, 0) / confidences.length) * 100
        : text
          ? 95
          : 0;

    return NextResponse.json({ text, confidence });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "OCR request failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
