import { withDb } from "@/lib/db/request";
import { jsonError } from "@/lib/ai/sse";
import { saveNewsToLibrary } from "@/modules/home/service";
import { withAuth } from "@/lib/auth/route";

export const runtime = "nodejs";

async function handlePOST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const item = saveNewsToLibrary(id);
  return item ? Response.json({ item, href: `/library?item=${item.id}` }, { status: 201 }) : jsonError("News item not found", 404);
}

export const POST = withDb(withAuth(handlePOST, { action: "write", resource: () => ({ kind: "library_item" }) }));
