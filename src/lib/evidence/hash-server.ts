import "server-only";
import { createHash } from "node:crypto";
import { canonicalText } from "./hash";

/** Synchronous artifact hash for server code whose writes are synchronous. Identical output to `artifactHash()`. */
export function artifactHashSync(text: string): string {
  return createHash("sha256").update(canonicalText(text)).digest("hex");
}
