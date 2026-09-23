import "server-only";

/**
 * Import a slides file into this editor's content model.
 * Implemented by the slides editor module; the shared /api/office/import route calls it.
 */
export async function importDocument(bytes: Uint8Array, filename: string): Promise<{ title: string; content: unknown; meta?: Record<string, unknown> }> {
  void bytes;
  throw new Error(`Import for slides is not implemented yet (${filename})`);
}
