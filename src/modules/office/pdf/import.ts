import "server-only";

/**
 * Import a pdf file into this editor's content model.
 * Implemented by the pdf editor module; the shared /api/office/import route calls it.
 */
export async function importDocument(bytes: Uint8Array, filename: string): Promise<{ title: string; content: unknown; meta?: Record<string, unknown> }> {
  void bytes;
  throw new Error(`Import for pdf is not implemented yet (${filename})`);
}
