/** Content-addressed src for images embedded in an imported .docx (import and re-read at export agree on it). */
export function docxImageSrc(sha256: string): string { return `/api/blobs/${docxImageBlobId(sha256)}`; }
export function docxImageBlobId(sha256: string): string { return `docximg_${sha256.slice(0, 24)}`; }
