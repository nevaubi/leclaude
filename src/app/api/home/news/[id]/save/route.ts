import { jsonError } from "@/lib/ai/sse";
import { saveNewsToLibrary } from "@/modules/home/service";

export const runtime = "nodejs";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const item = saveNewsToLibrary(id);
  return item ? Response.json({ item, href: `/library?item=${item.id}` }, { status: 201 }) : jsonError("News item not found", 404);
}
