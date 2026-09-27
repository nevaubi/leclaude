import { withDb } from "@/lib/db/request";
import { NextRequest } from "next/server";
import { jsonError } from "@/lib/ai/sse";
import { deleteItem, getItemDetail, updateItem } from "@/modules/library/service";
import type { UpdateItemInput } from "@/modules/library/types";
import { withAuth } from "@/lib/auth/route";
import { refs } from "@/lib/auth/resources";

export const runtime = "nodejs";
type Params = { params: Promise<{ id: string }> };

async function handleGET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const detail = getItemDetail(id);
  return detail ? Response.json(detail) : jsonError("Not found", 404);
}

async function handlePATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as UpdateItemInput | null;
  if (!body) return jsonError("Invalid body");
  try {
    const item = updateItem(id, body);
    return item ? Response.json({ item }) : jsonError("Not found", 404);
  } catch (e) { return jsonError((e as Error).message, 400); }
}

async function handleDELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    const r = deleteItem(id);
    return r.deleted.length ? Response.json(r) : jsonError("Not found", 404);
  } catch (e) { return jsonError((e as Error).message, 400); }
}

export const GET = withDb(withAuth(handleGET, { action: "read", resource: (_req, { id }) => refs.library(id) }));
export const PATCH = withDb(withAuth(handlePATCH, { action: "write", resource: (_req, { id }) => refs.library(id) }));
export const DELETE = withDb(withAuth(handleDELETE, { action: "delete", resource: (_req, { id }) => refs.library(id) }));
