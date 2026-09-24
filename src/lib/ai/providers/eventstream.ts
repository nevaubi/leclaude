/**
 * `application/vnd.amazon.eventstream` binary framing (pure). Bedrock's InvokeModelWithResponseStream wraps each
 * model event in a frame:
 *
 *   prelude   total_length u32 | headers_length u32 | prelude_crc u32 (CRC32 of the first 8 bytes)
 *   headers   name_len u8 | name | value_type u8 | value            (repeated)
 *   payload   total_length - headers_length - 16 bytes
 *   trailer   message_crc u32 (CRC32 of everything before it)
 *
 * The decoder validates both checksums, tolerates frames split across chunks, and exposes Bedrock's
 * `chunk` / `exception` / `error` message kinds. The encoder exists for tests and fixtures.
 */

export type HeaderValue =
  | { type: "boolean"; value: boolean }
  | { type: "byte"; value: number }
  | { type: "short"; value: number }
  | { type: "integer"; value: number }
  | { type: "long"; value: bigint }
  | { type: "bytes"; value: Uint8Array }
  | { type: "string"; value: string }
  | { type: "timestamp"; value: bigint }
  | { type: "uuid"; value: string };

export interface EventStreamMessage {
  headers: Record<string, HeaderValue>;
  payload: Uint8Array;
}

// ---------------- CRC32 (IEEE 802.3, same polynomial as zlib) ----------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array, previous = 0): number {
  let c = (previous ^ 0xffffffff) >>> 0;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ---------------- Encoding (tests / fixtures) ----------------

const enc = new TextEncoder();
const dec = new TextDecoder();

function encodeHeaders(headers: Record<string, HeaderValue>): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const [name, hv] of Object.entries(headers)) {
    const n = enc.encode(name);
    if (n.length > 255) throw new Error(`eventstream: header name too long: ${name}`);
    let body: Uint8Array;
    switch (hv.type) {
      case "boolean": body = new Uint8Array([hv.value ? 0 : 1]); break;
      case "byte": body = new Uint8Array([2, hv.value & 0xff]); break;
      case "short": { const b = new Uint8Array(3); b[0] = 3; new DataView(b.buffer).setInt16(1, hv.value); body = b; break; }
      case "integer": { const b = new Uint8Array(5); b[0] = 4; new DataView(b.buffer).setInt32(1, hv.value); body = b; break; }
      case "long": { const b = new Uint8Array(9); b[0] = 5; new DataView(b.buffer).setBigInt64(1, hv.value); body = b; break; }
      case "bytes": { const b = new Uint8Array(3 + hv.value.length); b[0] = 6; new DataView(b.buffer).setUint16(1, hv.value.length); b.set(hv.value, 3); body = b; break; }
      case "string": { const s = enc.encode(hv.value); const b = new Uint8Array(3 + s.length); b[0] = 7; new DataView(b.buffer).setUint16(1, s.length); b.set(s, 3); body = b; break; }
      case "timestamp": { const b = new Uint8Array(9); b[0] = 8; new DataView(b.buffer).setBigInt64(1, hv.value); body = b; break; }
      case "uuid": { const hex = hv.value.replace(/-/g, ""); const b = new Uint8Array(17); b[0] = 9; for (let i = 0; i < 16; i++) b[1 + i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16); body = b; break; }
    }
    const frame = new Uint8Array(1 + n.length + body.length);
    frame[0] = n.length;
    frame.set(n, 1);
    frame.set(body, 1 + n.length);
    parts.push(frame);
  }
  return concat(parts);
}

export function encodeEventStreamMessage(headers: Record<string, HeaderValue>, payload: Uint8Array): Uint8Array {
  const h = encodeHeaders(headers);
  const total = 12 + h.length + payload.length + 4;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, total);
  view.setUint32(4, h.length);
  view.setUint32(8, crc32(out.subarray(0, 8)));
  out.set(h, 12);
  out.set(payload, 12 + h.length);
  view.setUint32(total - 4, crc32(out.subarray(0, total - 4)));
  return out;
}

/** Encode a Bedrock `chunk` event carrying a JSON model event (what the runtime streams to us). */
export function encodeBedrockChunk(event: unknown): Uint8Array {
  const bytes = Buffer.from(JSON.stringify(event), "utf8").toString("base64");
  return encodeEventStreamMessage(
    { ":event-type": { type: "string", value: "chunk" }, ":content-type": { type: "string", value: "application/json" }, ":message-type": { type: "string", value: "event" } },
    enc.encode(JSON.stringify({ bytes, p: "" })),
  );
}

export function encodeBedrockException(exceptionType: string, message: string): Uint8Array {
  return encodeEventStreamMessage(
    { ":exception-type": { type: "string", value: exceptionType }, ":content-type": { type: "string", value: "application/json" }, ":message-type": { type: "string", value: "exception" } },
    enc.encode(JSON.stringify({ message })),
  );
}

// ---------------- Decoding ----------------

export class EventStreamDecodeError extends Error {
  constructor(message: string) { super(message); this.name = "EventStreamDecodeError"; }
}

function decodeHeaders(bytes: Uint8Array): Record<string, HeaderValue> {
  const out: Record<string, HeaderValue> = {};
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 0;
  while (pos < bytes.length) {
    const nameLen = bytes[pos++];
    const name = dec.decode(bytes.subarray(pos, pos + nameLen));
    pos += nameLen;
    const type = bytes[pos++];
    switch (type) {
      case 0: out[name] = { type: "boolean", value: true }; break;
      case 1: out[name] = { type: "boolean", value: false }; break;
      case 2: out[name] = { type: "byte", value: view.getInt8(pos) }; pos += 1; break;
      case 3: out[name] = { type: "short", value: view.getInt16(pos) }; pos += 2; break;
      case 4: out[name] = { type: "integer", value: view.getInt32(pos) }; pos += 4; break;
      case 5: out[name] = { type: "long", value: view.getBigInt64(pos) }; pos += 8; break;
      case 6: { const len = view.getUint16(pos); pos += 2; out[name] = { type: "bytes", value: bytes.slice(pos, pos + len) }; pos += len; break; }
      case 7: { const len = view.getUint16(pos); pos += 2; out[name] = { type: "string", value: dec.decode(bytes.subarray(pos, pos + len)) }; pos += len; break; }
      case 8: out[name] = { type: "timestamp", value: view.getBigInt64(pos) }; pos += 8; break;
      case 9: { const hex = Array.from(bytes.subarray(pos, pos + 16), (b) => b.toString(16).padStart(2, "0")).join(""); out[name] = { type: "uuid", value: `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}` }; pos += 16; break; }
      default: throw new EventStreamDecodeError(`unknown header value type ${type}`);
    }
  }
  return out;
}

/** Streaming decoder: push byte chunks, receive complete messages. Both CRCs are verified on every frame. */
export class EventStreamDecoder {
  private buffer: Uint8Array = new Uint8Array(0);

  push(chunk: Uint8Array): EventStreamMessage[] {
    this.buffer = this.buffer.length ? concat([this.buffer, chunk]) : chunk;
    const out: EventStreamMessage[] = [];
    while (this.buffer.length >= 12) {
      const view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
      const total = view.getUint32(0);
      const headersLen = view.getUint32(4);
      const preludeCrc = view.getUint32(8);
      if (total < 16 || headersLen > total - 16) throw new EventStreamDecodeError(`invalid frame lengths (total ${total}, headers ${headersLen})`);
      if (crc32(this.buffer.subarray(0, 8)) !== preludeCrc) throw new EventStreamDecodeError("prelude CRC mismatch");
      if (this.buffer.length < total) break; // wait for the rest of the frame
      const frame = this.buffer.subarray(0, total);
      const messageCrc = new DataView(frame.buffer, frame.byteOffset, frame.byteLength).getUint32(total - 4);
      if (crc32(frame.subarray(0, total - 4)) !== messageCrc) throw new EventStreamDecodeError("message CRC mismatch");
      const headers = decodeHeaders(frame.subarray(12, 12 + headersLen));
      const payload = frame.slice(12 + headersLen, total - 4);
      out.push({ headers, payload });
      this.buffer = this.buffer.slice(total);
    }
    return out;
  }

  /** Bytes still buffered (a non-empty remainder at end of stream means a truncated frame). */
  get pending(): number { return this.buffer.length; }
}

export type BedrockStreamEvent =
  | { kind: "chunk"; event: unknown }
  | { kind: "exception"; exceptionType: string; message: string }
  | { kind: "error"; errorCode: string; message: string }
  | { kind: "other"; eventType?: string };

function headerString(h: Record<string, HeaderValue>, name: string): string | undefined {
  const v = h[name];
  return v && v.type === "string" ? v.value : undefined;
}

/** Interpret a decoded frame the way the Bedrock runtime uses it. */
export function decodeBedrockEvent(msg: EventStreamMessage): BedrockStreamEvent {
  const messageType = headerString(msg.headers, ":message-type") ?? "event";
  const text = dec.decode(msg.payload);
  if (messageType === "exception") {
    let message = text;
    try { message = (JSON.parse(text) as { message?: string; Message?: string }).message ?? (JSON.parse(text) as { Message?: string }).Message ?? text; } catch { /* keep text */ }
    return { kind: "exception", exceptionType: headerString(msg.headers, ":exception-type") ?? "unknown", message };
  }
  if (messageType === "error") {
    return { kind: "error", errorCode: headerString(msg.headers, ":error-code") ?? "unknown", message: headerString(msg.headers, ":error-message") ?? text };
  }
  const eventType = headerString(msg.headers, ":event-type");
  if (eventType === "chunk") {
    const body = JSON.parse(text) as { bytes?: string };
    if (typeof body.bytes !== "string") throw new EventStreamDecodeError("chunk event without bytes");
    return { kind: "chunk", event: JSON.parse(Buffer.from(body.bytes, "base64").toString("utf8")) };
  }
  return { kind: "other", eventType };
}

function concat(parts: Uint8Array[]): Uint8Array {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}
