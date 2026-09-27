"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { TopbarSlot } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";
import { NewMatterDialog } from "@/modules/matters/components/new-matter-dialog";

/** /ediscovery with no matters in the workspace: one sentence and one action, no fabricated data. */
export function NoMattersState() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <TopbarSlot><span className="shrink-0 text-sm font-medium">E-Discovery</span></TopbarSlot>
      <div className="flex h-full items-center justify-center p-8">
        <div className="max-w-sm text-center" role="status">
          <h1 className="text-[15px] font-medium">Create a matter to start reviewing documents</h1>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted-foreground">Documents, depositions, issue codes and productions all belong to a matter. Once it exists you can upload files and begin review here.</p>
          <Button size="sm" className="mt-4" onClick={() => setOpen(true)}><Plus className="size-4" /> New matter</Button>
        </div>
      </div>
      <NewMatterDialog open={open} onOpenChange={setOpen} onCreated={(m) => router.push(`/ediscovery?matter=${encodeURIComponent(m.id)}`)} />
    </>
  );
}
