import { describe, expect, it } from "vitest";
import { crc32 as zlibCrc32 } from "node:zlib";
import { EventStreamDecodeError, EventStreamDecoder, crc32, decodeBedrockEvent, encodeBedrockChunk, encodeBedrockException, encodeEventStreamMessage } from "@/lib/ai/providers/eventstream";

const enc = new TextEncoder();

describe("AWS event stream framing", () => {
  it("computes IEEE CRC32 like zlib", () => {
    for (const s of ["", "a", "The quick brown fox jumps over the lazy dog", "x".repeat(5000)]) {
      const bytes = enc.encode(s);
      expect(crc32(bytes)).toBe(zlibCrc32(bytes));
    }
  });

  it("encodes and decodes a frame with every header type", () => {
    const payload = enc.encode('{"hello":"world"}');
    const frame = encodeEventStreamMessage(
      {
        ":message-type": { type: "string", value: "event" },
        flag: { type: "boolean", value: true },
        off: { type: "boolean", value: false },
        b: { type: "byte", value: -3 },
        s: { type: "short", value: -1234 },
        i: { type: "integer", value: 123456 },
        l: { type: "long", value: 1234567890123n },
        raw: { type: "bytes", value: new Uint8Array([1, 2, 3]) },
        ts: { type: "timestamp", value: 1700000000000n },
        id: { type: "uuid", value: "123e4567-e89b-12d3-a456-426614174000" },
      },
      payload,
    );
    const view = new DataView(frame.buffer);
    expect(view.getUint32(0)).toBe(frame.length);
    expect(view.getUint32(8)).toBe(crc32(frame.subarray(0, 8)));
    expect(view.getUint32(frame.length - 4)).toBe(crc32(frame.subarray(0, frame.length - 4)));
    const [msg] = new EventStreamDecoder().push(frame);
    expect(msg.headers).toEqual({
      ":message-type": { type: "string", value: "event" },
      flag: { type: "boolean", value: true },
      off: { type: "boolean", value: false },
      b: { type: "byte", value: -3 },
      s: { type: "short", value: -1234 },
      i: { type: "integer", value: 123456 },
      l: { type: "long", value: 1234567890123n },
      raw: { type: "bytes", value: new Uint8Array([1, 2, 3]) },
      ts: { type: "timestamp", value: 1700000000000n },
      id: { type: "uuid", value: "123e4567-e89b-12d3-a456-426614174000" },
    });
    expect(new TextDecoder().decode(msg.payload)).toBe('{"hello":"world"}');
  });

  it("decodes Bedrock chunk events split across two chunks, plus an exception frame", () => {
    const events = [
      { type: "message_start", message: { id: "msg_1", usage: { input_tokens: 5 } } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "héllo" } },
      { type: "message_stop", "amazon-bedrock-invocationMetrics": { inputTokenCount: 5, outputTokenCount: 2 } },
    ];
    const all = Buffer.concat([...events.map((e) => Buffer.from(encodeBedrockChunk(e))), Buffer.from(encodeBedrockException("throttlingException", "Too many requests"))]);
    const decoder = new EventStreamDecoder();
    const cut = 37; // inside the first frame's headers
    const decoded = [...decoder.push(all.subarray(0, cut)), ...decoder.push(all.subarray(cut))].map(decodeBedrockEvent);
    expect(decoded).toEqual([
      { kind: "chunk", event: events[0] },
      { kind: "chunk", event: events[1] },
      { kind: "chunk", event: events[2] },
      { kind: "exception", exceptionType: "throttlingException", message: "Too many requests" },
    ]);
    expect(decoder.pending).toBe(0);
  });

  it("holds an incomplete trailing frame and reports it as pending", () => {
    const frame = encodeBedrockChunk({ type: "ping" });
    const decoder = new EventStreamDecoder();
    expect(decoder.push(frame.subarray(0, 10))).toEqual([]);
    expect(decoder.pending).toBe(10);
    expect(decoder.push(frame.subarray(10)).map(decodeBedrockEvent)).toEqual([{ kind: "chunk", event: { type: "ping" } }]);
    expect(decoder.pending).toBe(0);
  });

  it("rejects corrupted frames on either checksum", () => {
    const frame = encodeBedrockChunk({ type: "ping" });
    const badPayload = Uint8Array.from(frame);
    badPayload[frame.length - 6] ^= 0xff; // flip a payload byte → message CRC mismatch
    expect(() => new EventStreamDecoder().push(badPayload)).toThrow(EventStreamDecodeError);
    const badPrelude = Uint8Array.from(frame);
    badPrelude[5] ^= 0x01; // headers_length byte → prelude CRC mismatch
    expect(() => new EventStreamDecoder().push(badPrelude)).toThrow(/prelude CRC/);
  });
});
