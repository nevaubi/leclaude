import { beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { Document, Packer, Paragraph } from "docx";
import { db, resetSqlite } from "@/lib/db";
import type { Matter } from "@/lib/types/domain";
import { defaultBatesPrefix, getEDiscoverySettings, ingestFiles, originalOf, updateEDiscoverySettings, type IngestFileResult } from "@/modules/ediscovery/ingest";
import { parseEmail } from "@/modules/ediscovery/ingest-eml";
import { searchDocuments, matterStats } from "@/modules/ediscovery/service";
import { POST as ingestPOST, GET as ingestGET } from "@/app/api/ediscovery/ingest/route";
import { GET as originalGET } from "@/app/api/ediscovery/docs/[id]/original/route";

const A = "m_ingest_test_a";
const B = "m_ingest_test_b";

function matter(id: string, shortName: string): Matter {
  return { id, slug: id, name: `${shortName} (test)`, shortName, client: "Test client", clientSide: "plaintiff", practiceArea: "Commercial" as Matter["practiceArea"], status: "active", openedAt: "2026-01-01", teamIds: [] };
}

async function pdf(pages: string[], opts: { title?: string; created?: Date } = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const text of pages) doc.addPage([400, 400]).drawText(text, { x: 40, y: 340, size: 12, font });
  if (opts.title) doc.setTitle(opts.title);
  if (opts.created) doc.setCreationDate(opts.created);
  return doc.save();
}

async function docx(text: string): Promise<Uint8Array> {
  const buf = await Packer.toBuffer(new Document({ creator: "Test", title: "Supply agreement notes", sections: [{ children: [new Paragraph(text)] }] }));
  return new Uint8Array(buf);
}

const enc = (s: string) => new TextEncoder().encode(s);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0, 0x90, 0x77, 0x53, 0xde]);
const EML = [
  "From: \"Jane Doe\" <jane@acme.test>",
  "To: Bob Roe <bob@beta.test>, carol@acme.test",
  "Cc: =?utf-8?Q?Dan_=C3=96berg?= <dan@acme.test>",
  "Subject: Re: Shipment schedule",
  "Date: Tue, 05 Mar 2024 10:15:00 -0500",
  "Message-ID: <abc123@acme.test>",
  "MIME-Version: 1.0",
  "Content-Type: multipart/alternative; boundary=\"XYZ\"",
  "",
  "--XYZ",
  "Content-Type: text/plain; charset=utf-8",
  "Content-Transfer-Encoding: quoted-printable",
  "",
  "The pallet count on the second truck was short by forty units =E2=80=94 zanzibarquartz.",
  "--XYZ",
  "Content-Type: text/html; charset=utf-8",
  "",
  "<p>The pallet count was short.</p>",
  "--XYZ--",
  "",
].join("\r\n");

let pdfBytes: Uint8Array;
let results: IngestFileResult[];

beforeAll(async () => {
  resetSqlite();
  db().matters.putMany([matter(A, "Acme v. Beta Supply"), matter(B, "Gamma Holdings")]);
  pdfBytes = await pdf(["Page one mentions the widget recall.", "Page two continues the recall discussion."], { title: "Recall memo", created: new Date("2023-06-01T12:00:00Z") });
  const res = await ingestFiles([
    { name: "recall.pdf", mime: "application/pdf", bytes: pdfBytes },
    { name: "notes.docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", bytes: await docx("The supply agreement was amended in May; quibblewort clause.") },
    { name: "call-notes.txt", mime: "text/plain", bytes: enc("Call with vendor about the flux capacitor timeline. Unique term: xylophonic."), lastModified: Date.parse("2022-11-20T00:00:00Z") },
    { name: "shipment.eml", mime: "message/rfc822", bytes: enc(EML) },
    { name: "photo.png", mime: "image/png", bytes: PNG },
    { name: "fake.pdf", mime: "application/pdf", bytes: enc("this is not a pdf at all, just text pretending") },
    { name: "../../etc/passwd", mime: "text/plain", bytes: enc("root:x:0:0") },
  ], { matterId: A, custodian: "Jane Doe", scanner: { name: "test", scan: async () => ({ status: "clean", engine: "test", durationMs: 0 }) } });
  results = res.results;
}, 60_000);

describe("ingest pipeline", () => {
  it("reports a result for every file", () => {
    expect(results).toHaveLength(7);
    expect(results.filter((r) => r.status === "created")).toHaveLength(5);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(2);
  });

  it("rejects content whose magic bytes do not match the declared type, and traversal names", () => {
    const fake = results.find((r) => r.name === "fake.pdf");
    expect(fake).toMatchObject({ status: "rejected", code: "type_mismatch" });
    const trav = results.find((r) => r.status === "rejected" && r.name.includes("passwd"));
    expect(trav).toMatchObject({ status: "rejected", code: "path_traversal" });
    // Nothing was created for rejected files.
    expect(db().edocs.find((d) => d.matterId === A && d.subject.toLowerCase().includes("fake"))).toHaveLength(0);
  });

  it("assigns sequential Bates numbers from the matter prefix, with a range for multi-page PDFs", () => {
    expect(defaultBatesPrefix(db().matters.get(A))).toBe("ABS");
    const created = results.filter((r): r is Extract<IngestFileResult, { status: "created" }> => r.status === "created");
    expect(created[0]).toMatchObject({ name: "recall.pdf", bates: "ABS-0000001", batesEnd: "ABS-0000002", pages: 2 });
    expect(created.slice(1).map((r) => r.bates)).toEqual(["ABS-0000003", "ABS-0000004", "ABS-0000005", "ABS-0000006"]);
    expect(getEDiscoverySettings(A).nextBates).toBe(7);
  });

  it("extracts text, metadata and dates per type, and keeps the original bytes with their hash", async () => {
    const byName = (n: string) => { const r = results.find((x) => x.name === n) as Extract<IngestFileResult, { status: "created" }>; return db().edocs.get(r.docId)!; };
    const p = byName("recall.pdf");
    expect(p.text).toContain("widget recall");
    expect(p.subject).toBe("Recall memo");
    expect(p.date).toBe("2023-06-01");
    const orig = originalOf(p)!;
    expect(orig.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(orig.extraction.status).toBe("extracted");
    const blob = db().blobs.get(orig.blobId)!;
    expect(Buffer.from(blob.bytes).equals(Buffer.from(pdfBytes))).toBe(true);
    expect(blob.meta?.matterId).toBe(A);

    expect(byName("notes.docx").text).toContain("quibblewort");
    const txt = byName("call-notes.txt");
    expect(txt.date).toBe("2022-11-20");
    expect(originalOf(txt)!.dateSource).toBe("file-modified");

    const mail = byName("shipment.eml");
    expect(mail).toMatchObject({ type: "Email", subject: "Re: Shipment schedule", from: "Jane Doe", date: "2024-03-05" });
    expect(mail.to).toEqual(["Bob Roe", "carol@acme.test"]);
    expect(mail.cc).toEqual(["Dan Öberg"]);
    expect(mail.text).toContain("zanzibarquartz");

    const img = byName("photo.png");
    expect(img.type).toBe("Image");
    expect(img.text).toBe("");
    expect(img.tags).toContain("needs-ocr");
    expect(originalOf(img)!.extraction.status).toBe("needs_ocr");
  });

  it("creates the custodian once and resolves it by exact name afterwards", async () => {
    const docs = db().edocs.find((d) => d.matterId === A);
    const ids = new Set(docs.map((d) => d.custodianId));
    expect(ids.size).toBe(1);
    const person = db().people.get([...ids][0])!;
    expect(person.name).toBe("Jane Doe");
    const again = await ingestFiles([{ name: "more.txt", mime: "text/plain", bytes: enc("Follow-up from jane about shipments.") }], { matterId: A, custodian: "jane  doe" });
    const created = again.results[0] as Extract<IngestFileResult, { status: "created" }>;
    expect(db().edocs.get(created.docId)!.custodianId).toBe(person.id);
  });

  it("deduplicates by file hash within the matter, but not across matters", async () => {
    const dup = await ingestFiles([{ name: "recall-copy.pdf", mime: "application/pdf", bytes: pdfBytes }], { matterId: A });
    expect(dup.results[0]).toMatchObject({ status: "duplicate", existingBates: "ABS-0000001" });
    expect(dup.created).toBe(0);
    const other = await ingestFiles([{ name: "recall.pdf", mime: "application/pdf", bytes: pdfBytes }], { matterId: B });
    expect(other.results[0]).toMatchObject({ status: "created", bates: "GH-0000001" });
  });

  it("indexes documents for search scoped to their matter", async () => {
    const hitA = await searchDocuments({ matterId: A, q: "xylophonic" });
    expect(hitA.total).toBe(1);
    const recallA = await searchDocuments({ matterId: A, q: "recall" });
    const recallB = await searchDocuments({ matterId: B, q: "recall" });
    expect(recallA.hits.every((h) => db().edocs.get(h.id)!.matterId === A)).toBe(true);
    expect(recallB.hits.every((h) => db().edocs.get(h.id)!.matterId === B)).toBe(true);
    expect(matterStats(B).total).toBe(1);
  });

  it("honours a configured prefix and never reuses a number", async () => {
    updateEDiscoverySettings(B, { batesPrefix: "gam" });
    expect(getEDiscoverySettings(B)).toMatchObject({ batesPrefix: "GAM", nextBates: 1 });
    const r = await ingestFiles([{ name: "a.md", mime: "text/markdown", bytes: enc("# Heading\nSome markdown body text.") }], { matterId: B });
    expect(r.results[0]).toMatchObject({ status: "created", bates: "GAM-0000001" });
    expect(() => updateEDiscoverySettings(B, { batesPrefix: "G1" })).toThrow(/2–8 letters/);
  });
});

describe("email parser", () => {
  it("parses headers, encoded words and the plain-text part", () => {
    const e = parseEmail(EML);
    expect(e.subject).toBe("Re: Shipment schedule");
    expect(e.messageId).toBe("abc123@acme.test");
    expect(e.text).toContain("forty units —");
    expect(e.text).not.toContain("<p>");
  });
  it("lists attachments without extracting them", () => {
    const raw = "From: a@x.test\r\nSubject: s\r\nContent-Type: multipart/mixed; boundary=b\r\n\r\n--b\r\nContent-Type: text/plain\r\n\r\nbody\r\n--b\r\nContent-Type: application/pdf; name=\"x.pdf\"\r\nContent-Disposition: attachment; filename=\"x.pdf\"\r\nContent-Transfer-Encoding: base64\r\n\r\nJVBERi0=\r\n--b--\r\n";
    const e = parseEmail(raw);
    expect(e.text).toBe("body");
    expect(e.attachments).toEqual([{ name: "x.pdf", mime: "application/pdf" }]);
  });
});

describe("ingest route", () => {
  it("accepts multipart uploads and reports per-file results", async () => {
    const form = new FormData();
    form.append("file", new File([enc("Route upload body with term plinthwork.")], "route.txt", { type: "text/plain" }));
    form.append("file", new File([enc("not really a png")], "bad.png", { type: "image/png" }));
    form.append("custodian", "Route Custodian");
    const res = await ingestPOST(new NextRequest(`http://localhost/api/ediscovery/ingest?matter=${B}`, { method: "POST", body: form }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.created).toBe(1);
    expect(body.rejected).toBe(1);
    expect(body.results[1]).toMatchObject({ status: "rejected", code: "type_mismatch" });
  });

  it("returns the numbering settings, 404 for an unknown matter and 415 for a non-multipart body", async () => {
    const ok = await ingestGET(new NextRequest(`http://localhost/api/ediscovery/ingest?matter=${A}`));
    expect((await ok.json()).settings.batesPrefix).toBe("ABS");
    const missing = await ingestPOST(new NextRequest("http://localhost/api/ediscovery/ingest?matter=m_does_not_exist", { method: "POST", body: new FormData() }));
    expect(missing.status).toBe(404);
    const json = await ingestPOST(new NextRequest(`http://localhost/api/ediscovery/ingest?matter=${A}`, { method: "POST", body: JSON.stringify({}), headers: { "Content-Type": "application/json" } }));
    expect(json.status).toBe(415);
  });

  it("serves the original bytes of an ingested document", async () => {
    const r = results.find((x) => x.name === "recall.pdf") as Extract<IngestFileResult, { status: "created" }>;
    const res = await originalGET(new NextRequest(`http://localhost/api/ediscovery/docs/${r.docId}/original`), { params: Promise.resolve({ id: r.docId }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("x-content-sha256")).toBe(r.sha256);
    expect(Buffer.from(await res.arrayBuffer()).equals(Buffer.from(pdfBytes))).toBe(true);
  });
});
