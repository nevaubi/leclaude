/**
 * OCR provider contract. No OCR engine is installed in this deployment, so no
 * provider is registered: image-only pages are detected at extraction time
 * (`needsOcr`), labelled "needs OCR" in the editor and the agent snapshot, and
 * excluded from text-based claims. Nothing here fabricates text.
 *
 * A production provider (e.g. Amazon Textract's AnalyzeDocument /
 * StartDocumentTextDetection over the S3 evidence object, constitution §20/§30)
 * implements `OcrProvider` and registers itself with `registerOcrProvider`.
 * Its output must keep the path to the original evidence: engine name and
 * version, per-word boxes in PDF user space and confidences, so OCR text can be
 * cited with page precision and distinguished from native text.
 */

/** One recognized word, positioned in PDF user space of the source page (points, origin bottom-left). */
export interface OcrWord { text: string; x: number; y: number; w: number; h: number; confidence: number }

export interface OcrPageResult {
  /** 1-based source page number. */
  page: number;
  text: string;
  words: OcrWord[];
  /** Mean word confidence 0..1. */
  confidence: number;
  engine: string;
  engineVersion: string;
}

export interface OcrRequest {
  /** Original PDF bytes (or a server-side evidence reference resolved by the provider). */
  bytes: Uint8Array;
  /** 1-based source pages to recognize (the pages flagged needsOcr). */
  pages: number[];
  /** Tenant/matter scoping for providers that read from S3; never widened by the provider. */
  matterId?: string | null;
  signal?: AbortSignal;
}

export interface OcrProvider {
  id: string;
  /** Recognize the requested pages. Must throw on failure (never return empty text as success). */
  recognize(req: OcrRequest): Promise<OcrPageResult[]>;
}

let provider: OcrProvider | null = null;

/** Register the deployment's OCR provider (none is registered by default). */
export function registerOcrProvider(p: OcrProvider | null) { provider = p; }

/** The configured OCR provider, or null when OCR is unavailable (the current state). */
export function getOcrProvider(): OcrProvider | null { return provider; }

export const OCR_UNAVAILABLE_MESSAGE = "No OCR engine is configured. Image-only pages are marked \"needs OCR\" and excluded from text search, quotes and summaries.";
