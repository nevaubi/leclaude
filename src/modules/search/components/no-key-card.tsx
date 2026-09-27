"use client";
import Link from "next/link";
import { KeyRound } from "lucide-react";
import { cn } from "@/lib/utils";

export function NoKeyCard({ compact, className }: { compact?: boolean; className?: string }) {
  return (
    <div className={cn("rounded-md border p-3 text-xs", className)} role="status" data-state="not-configured">
      <div className="flex items-start gap-2">
        <KeyRound className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 space-y-1">
          <div className="font-medium text-foreground">No model provider configured</div>
          <div className="text-muted-foreground">The research lanes still search and read authorities, but synthesis, verification, headnotes and follow-ups need a model. Configure Amazon Bedrock, Anthropic or OpenAI in the environment and restart.</div>
          {!compact && <Link href="/settings#ai" className="inline-block font-medium text-foreground underline-offset-2 hover:underline">Open model configuration</Link>}
        </div>
      </div>
    </div>
  );
}
