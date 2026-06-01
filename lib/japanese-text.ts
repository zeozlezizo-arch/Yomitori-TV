// ポケモンなどのゲーム内セリフを OCR した結果を整形するためのユーティリティ。
//
// Tesseract はゲーム独自フォントを読むと、日本語以外の部分を意味のない記号
// （| \ _ ^ ~ = などの羅列）として誤認識しがち。ここでは
//   1. セリフに使われる文字だけを許可リストで残す
//   2. ノイズだけになった行を捨てる
//   3. 読み上げ用に自然な文へ整える
// という後処理を行う。

// セリフで実際に使われる約物（記号）の許可リスト。
const ALLOWED_PUNCT = new Set<number>([
  0x3001, // 、
  0x3002, // 。
  0xff0c, // ，
  0xff0e, // ．
  0x002c, // ,
  0x002e, // .
  0x0021, // !
  0x003f, // ?
  0xff01, // ！
  0xff1f, // ？
  0x300c, // 「
  0x300d, // 」
  0x300e, // 『
  0x300f, // 』
  0xff08, // （
  0xff09, // ）
  0x0028, // (
  0x0029, // )
  0x30fb, // ・
  0x2026, // …
  0x2025, // ‥
  0x301c, // 〜
  0x007e, // ~
  0xff5e, // ～
  0x266a, // ♪
  0x266c, // ♬
  0x003a, // :
  0xff1a, // ：
  0x2019, // ’
  0x0027, // '
  0x002d, // -
  0x30a0, // ゠
]);

function isAllowedChar(cp: number): boolean {
  return (
    cp === 0x0a || // 改行
    cp === 0x20 || // 半角スペース
    cp === 0x3000 || // 全角スペース
    (cp >= 0x3040 && cp <= 0x309f) || // ひらがな
    (cp >= 0x30a0 && cp <= 0x30ff) || // カタカナ（長音符ー含む）
    (cp >= 0x31f0 && cp <= 0x31ff) || // カタカナ拡張
    (cp >= 0xff66 && cp <= 0xff9f) || // 半角カタカナ
    (cp >= 0x4e00 && cp <= 0x9fff) || // CJK統合漢字
    (cp >= 0x3400 && cp <= 0x4dbf) || // CJK拡張A
    cp === 0x3005 || // 々
    cp === 0x3006 || // 〆
    (cp >= 0x0041 && cp <= 0x005a) || // A-Z
    (cp >= 0x0061 && cp <= 0x007a) || // a-z
    (cp >= 0x0030 && cp <= 0x0039) || // 0-9
    (cp >= 0xff21 && cp <= 0xff3a) || // 全角A-Z
    (cp >= 0xff41 && cp <= 0xff5a) || // 全角a-z
    (cp >= 0xff10 && cp <= 0xff19) || // 全角0-9
    ALLOWED_PUNCT.has(cp)
  );
}

function isJapaneseChar(cp: number): boolean {
  return (
    (cp >= 0x3040 && cp <= 0x309f) ||
    (cp >= 0x30a0 && cp <= 0x30ff) ||
    (cp >= 0xff66 && cp <= 0xff9f) ||
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0x3400 && cp <= 0x4dbf)
  );
}

/**
 * OCR の生テキストから、セリフとして成立する部分だけを残す。
 * 行構造は保持しつつ、記号ノイズだけの行や日本語をほとんど含まない行を捨てる。
 */
export function cleanOcrText(raw: string): string {
  if (!raw) return "";

  // ゼロ幅文字を除去
  const normalized = raw.replace(/[​-‍﻿]/g, "");

  const cleanedLines: string[] = [];

  for (const line of normalized.split(/\r?\n/)) {
    // 許可文字だけを残す
    let kept = "";
    for (const ch of line) {
      const cp = ch.codePointAt(0)!;
      if (isAllowedChar(cp)) kept += ch;
    }

    // 連続スペースを1つに、前後の空白を除去
    kept = kept.replace(/[ 　]{2,}/g, " ").trim();
    if (!kept) continue;

    // この行に含まれる日本語文字数と、約物以外の文字数を数える
    let jpCount = 0;
    let contentCount = 0; // スペース・記号を除いた文字数
    for (const ch of kept) {
      const cp = ch.codePointAt(0)!;
      if (cp === 0x20 || cp === 0x3000) continue;
      if (isJapaneseChar(cp)) jpCount++;
      if (!ALLOWED_PUNCT.has(cp)) contentCount++;
    }

    // 中身がほぼ無い、または日本語が1文字も無い短い行はノイズとみなして捨てる
    if (contentCount === 0) continue;
    if (jpCount === 0 && contentCount < 3) continue;

    cleanedLines.push(kept);
  }

  return cleanedLines.join("\n").trim();
}

/**
 * 整形済みテキストを読み上げ用の自然な文章にする。
 * ゲームのセリフは枠幅で改行されるため、改行は基本的に連結する。
 */
export function prepareForSpeech(text: string): string {
  if (!text) return "";

  let out = "";
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    out += line;
    if (i < lines.length - 1) {
      const last = line[line.length - 1];
      // 文末記号で終わっていればそのまま（句点側で間が入る）。
      // それ以外は単に途中改行なので空白を入れずに連結する。
      if (last && /[。．.！!？?、，,]/.test(last)) {
        // すでに区切りがあるので何もしない
      }
    }
  }

  // 余分な空白を整理
  return out.replace(/[ 　]{2,}/g, " ").trim();
}

/**
 * 読み上げを文単位に分割する。文末記号で区切り、適度な長さのまとまりにする。
 * 文間に「間」を入れて自然なペースで読ませるために使う。
 */
export function splitIntoSpeechSegments(text: string): string[] {
  if (!text) return [];

  // 文末記号の直後で分割（記号は前のまとまりに残す）
  const rawSegments = text.split(/(?<=[。．.！!？?])/);

  const segments: string[] = [];
  for (const seg of rawSegments) {
    const trimmed = seg.trim();
    if (trimmed) segments.push(trimmed);
  }

  return segments.length > 0 ? segments : [text.trim()].filter(Boolean);
}
