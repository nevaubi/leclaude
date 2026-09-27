import { pageDb } from "@/lib/db/request";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { workspaceView } from "@/modules/workspace/service";
import { SetupForm } from "@/modules/workspace/components/setup-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Set up" };

/** First-run setup. Once the workspace has an owner this page is closed; the profile is edited in Settings. */
export default async function Page() {
  await pageDb();
  const ws = workspaceView();
  if (ws.configured) redirect("/matters");
  return <SetupForm appName={process.env.NEXT_PUBLIC_APP_NAME?.trim() || "LeClaude"} defaultFirmName={process.env.NEXT_PUBLIC_FIRM_NAME?.trim() || ""} />;
}
