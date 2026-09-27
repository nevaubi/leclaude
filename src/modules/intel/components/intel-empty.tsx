import * as React from "react";
import Link from "next/link";
import { Radar } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * First-run state for /intel: the intelligence layer has no records because no source has run.
 * Says how to connect one (Settings → Data & automation) instead of rendering empty tables.
 */
export function IntelEmptyState({ enabledSources, totalSources }: { enabledSources: number; totalSources: number }) {
  return (
    <div className="flex h-full min-h-0 items-start justify-center overflow-auto p-6 md:pt-16" role="status">
      <div className="w-full max-w-[520px]">
        <Radar className="mb-3 size-5 text-muted-foreground" strokeWidth={1.75} aria-hidden />
        <h1 className="text-[15px] font-semibold tracking-tight">No intelligence records yet</h1>
        <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
          Intelligence is built only from sources your firm turns on: dockets for your matters, case law and regulatory queries, watched pages and your own document folders. Nothing is shown until a source has run.
        </p>
        <ol className="mt-4 divide-y divide-line-quiet border-y border-line-quiet text-[12.5px]">
          <li className="flex items-baseline gap-3 py-2"><span className="w-4 shrink-0 tabular text-muted-foreground">1</span><span>Open <Link href="/settings#sources" className="font-medium hover:text-primary">Settings → Data &amp; automation</Link> and enable a source (docket watch, case law, Federal Register, local folders).</span></li>
          <li className="flex items-baseline gap-3 py-2"><span className="w-4 shrink-0 tabular text-muted-foreground">2</span><span>Add queries or folders to it; provider keys, where needed, go in the environment.</span></li>
          <li className="flex items-baseline gap-3 py-2"><span className="w-4 shrink-0 tabular text-muted-foreground">3</span><span>Run it now or wait for its schedule. Entities, trends, chronologies and insights appear here once records arrive.</span></li>
        </ol>
        <div className="mt-4 flex items-center gap-3">
          <Button size="sm" asChild><Link href="/settings#sources">Connect a source</Link></Button>
          <span className="text-[11.5px] text-muted-foreground">{enabledSources} of {totalSources} sources enabled</span>
        </div>
      </div>
    </div>
  );
}
