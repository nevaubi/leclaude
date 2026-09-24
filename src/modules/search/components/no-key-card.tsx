"use client";
import Link from "next/link";
import { KeyRound } from "lucide-react";
import { cn } from "@/lib/utils";

export function NoKeyCard({ compact, className }: { compact?: boolean; className?: string }) {
  return (
    <div className={cn("rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs", className)} role="status">
      <div className="flex items-start gap-2">
        <KeyRound className="mt-0.5 size-4 shrink-0 text-warning-foreground dark:text-warning" />
        <div className="min-w-0 space-y-1">
          <div className="font-semibold text-foreground">OpenAI key required</div>
          <div className="text-muted-foreground">The research lanes still retrieve and read authorities, but synthesis, verification, headnotes and follow-ups call the OpenAI Responses API. Add <code className="rounded bg-muted px-1 font-mono">OPENAI_API_KEY</code> to <code className="rounded bg-muted px-1 font-mono">.env.local</code> and restart.</div>
          {!compact && <Link href="/settings#ai" className="inline-block font-medium text-primary hover:underline">Open AI configuration →</Link>}
        </div>
      </div>
    </div>
  );
}
