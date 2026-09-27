import { pageDb } from "@/lib/db/request";
import type { Metadata } from "next";
import { aiConfig } from "@/lib/ai/config";
import { loadHomeInitialData } from "@/modules/home/service";
import { HomePage } from "@/modules/home/components/home-page";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Home" };

export default async function Page() {
  await pageDb();
  const initial = loadHomeInitialData({ aiConfigured: aiConfig().hasKey });
  return <HomePage initial={initial} />;
}
