import { pageDb } from "@/lib/db/request";
// Inert leftover from visual verification of TeamSettings; the lead should delete this folder
// (src/app/matters/team-preview). The workers' shell hook blocks deleting files under src/.
import { notFound } from "next/navigation";

export default async function Page() {
  await pageDb();
  notFound();
}
