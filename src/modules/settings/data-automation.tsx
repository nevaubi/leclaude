"use client";
import * as React from "react";
import Link from "next/link";
import { Database } from "lucide-react";
import { EmptyState } from "@/components/ui/misc";
import { KeyValueList } from "@/components/ui/form";

/**
 * Settings → Data & automation. Placeholder until the intelligence round
 * mounts its sources table, jobs log, local folders and storage stats here.
 * Contract: the intel round replaces the body of this component (same export
 * name and props) or renders its own panel inside <SettingsSection id="data">.
 */
export function DataAutomationSection({ background, dataDir, corpusFolders }: { background: "inline" | "cron" | "off"; dataDir: string; corpusFolders: number }) {
  return (
    <div className="space-y-3">
      <KeyValueList
        dense
        columns={2}
        items={[
          { label: "Background jobs", value: background === "off" ? "off" : background === "cron" ? "external cron (POST /api/intel/jobs/tick)" : "in-process loop", mono: true },
          { label: "Data directory", value: dataDir, mono: true },
          { label: "Local corpus folders", value: corpusFolders ? `${corpusFolders} configured (LECLAUDE_CORPUS_DIRS)` : "none (set LECLAUDE_CORPUS_DIRS)", mono: !corpusFolders },
          { label: "Intelligence", value: <Link href="/intel" className="text-primary hover:underline">Open Intelligence</Link> },
        ]}
      />
      <EmptyState compact icon={Database} title="Sources and jobs appear here once the intelligence layer is online" description="Enable and schedule sources, run them now, read job logs with steward fixes and escalations, and manage watched folders." />
    </div>
  );
}
