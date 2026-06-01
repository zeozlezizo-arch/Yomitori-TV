"use client";

import { useRef, useCallback } from "react";
import { ImagePlus } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ImageUploaderProps {
  onImageSelect: (imageData: string) => void;
}

export function ImageUploader({ onImageSelect }: ImageUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (e) => {
        const result = e.target?.result;
        if (typeof result === "string") {
          onImageSelect(result);
        }
      };
      reader.readAsDataURL(file);

      // 同じファイルを再選択できるようにリセット
      if (inputRef.current) {
        inputRef.current.value = "";
      }
    },
    [onImageSelect]
  );

  const handleClick = useCallback(() => {
    inputRef.current?.click();
  }, []);

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        onChange={handleFileChange}
        className="hidden"
        aria-hidden="true"
      />
      <Button
        onClick={handleClick}
        variant="secondary"
        size="lg"
        className="w-full h-16 text-lg font-semibold gap-3"
        aria-label="画像を選択"
      >
        <ImagePlus className="h-7 w-7" />
        画像を選択
      </Button>
    </>
  );
}
