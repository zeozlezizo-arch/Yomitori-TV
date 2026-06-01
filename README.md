# TV文字読み上げアプリ

テレビ画面（ポケモンなどのゲームのセリフ）をカメラで撮影し、文字認識して読み上げるアプリです。

## OCR（文字認識）の仕組み

精度を上げるため、**クラウドOCR（Google Cloud Vision）を優先**して使用します。
APIキーが未設定、または通信に失敗した場合は、自動的に**ローカルOCR（Tesseract.js）にフォールバック**します。

| 状況 | 使われるエンジン |
| --- | --- |
| `GOOGLE_VISION_API_KEY` が設定済み | Google Cloud Vision（高精度） |
| キー未設定 / 通信失敗 | Tesseract.js（オフライン・端末内処理） |

## セットアップ

```bash
pnpm install
cp .env.local.example .env.local   # 値を編集して APIキーを設定
pnpm dev
```

### Google Cloud Vision のAPIキー取得

1. [Google Cloud Console](https://console.cloud.google.com/) でプロジェクトを作成
2. 「Cloud Vision API」を有効化
3. 「APIとサービス > 認証情報」で APIキーを作成
4. （推奨）キーの利用を Cloud Vision API のみに制限
5. `.env.local` の `GOOGLE_VISION_API_KEY` に設定

Vercel などにデプロイする場合は、同じ環境変数をプロジェクト設定に追加してください。
APIキーはサーバー側（`app/api/ocr/route.ts`）でのみ使用され、ブラウザには公開されません。

## 使い方

1. 「カメラを起動」し、読みたいセリフを枠内に収める
2. 「読む」ボタンを押すと、その場で認識して読み上げます
3. 「自動ON」にすると、画面が変わるたびに自動で読み上げます

## 主なファイル

- `app/api/ocr/route.ts` — Cloud Vision を呼ぶサーバールート（APIキーはここだけで使用）
- `hooks/use-cloud-ocr.ts` — クラウドOCR呼び出し
- `hooks/use-ocr.ts` — ローカルOCR（Tesseract）フォールバック
- `hooks/use-speech.ts` — 文単位で間を入れて自然なペースで読み上げ
- `lib/japanese-text.ts` — 日本語セリフ抽出・記号ノイズ除去・読み上げ整形
- `components/tv-text-scanner.tsx` — メイン画面
