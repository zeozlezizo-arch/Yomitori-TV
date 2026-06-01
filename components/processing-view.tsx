"use client";

import Image from "next/image";
import { Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

interface ProcessingViewProps {
  imageData: string;
  progress: number;
}

export function ProcessingView({ imageData, progress }: ProcessingViewProps) {
  return (
    <Card className="w-full">
      <CardContent className="p-4 space-y-4">
        {/* Captured Image */}
        <div className="relative aspect-video w-full overflow-hidden rounded-lg">
          <Image
            src={imageData}
            alt="撮影した画像"
            fill
            className="object-contain"
            unoptimized
          />
          {/* Processing overlay */}
          <div className="absolute inset-0 bg-background/80 flex flex-col items-center justify-center gap-4">
            <Loader2 className="h-12 w-12 animate-spin text-primary" />
            <p className="text-lg font-semibold text-foreground">
              文字を認識中...
            </p>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="space-y-2">
          <div className="flex justify-between text-sm text-muted-foreground">
            <span>処理中</span>
            <span>{progress}%</span>
          </div>
          <Progress value={progress} className="h-3" aria-label="認識進捗" />
        </div>
      </CardContent>
    </Card>
  );
}
