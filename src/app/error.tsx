"use client";
import * as React from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  React.useEffect(() => { console.error(error); }, [error]);
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive"><AlertTriangle className="size-6" /></div>
      <h1 className="text-lg font-semibold">Something went wrong</h1>
      <p className="max-w-md text-sm text-muted-foreground break-words">{error.message || "An unexpected error occurred."}</p>
      {error.digest && <p className="font-mono text-[11px] text-muted-foreground">ref {error.digest}</p>}
      <Button onClick={reset} variant="outline"><RotateCcw className="size-4" /> Try again</Button>
    </div>
  );
}
