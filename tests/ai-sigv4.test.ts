import { describe, expect, it } from "vitest";
import { rfc3986Encode, sha256Hex, signV4 } from "@/lib/ai/providers/sigv4";

/**
 * AWS-documented Signature Version 4 example ("Examples: Signature Calculations in AWS Signature Version 4",
 * Amazon S3 API Reference — GET Object): fixed date, the example credentials, and the published canonical
 * request hash and signature.
 */
const CREDS = { accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" };
const EMPTY_SHA = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

describe("SigV4 signing", () => {
  it("reproduces the documented AWS example (canonical request, string to sign, signature)", () => {
    const r = signV4(
      { method: "GET", path: "/test.txt", headers: { Host: "examplebucket.s3.amazonaws.com", Range: "bytes=0-9", "x-amz-content-sha256": EMPTY_SHA }, body: "" },
      { region: "us-east-1", service: "s3", credentials: CREDS, date: "20130524T000000Z", doubleEncodePath: false },
    );
    expect(r.canonicalRequest).toBe(["GET", "/test.txt", "", "host:examplebucket.s3.amazonaws.com", "range:bytes=0-9", `x-amz-content-sha256:${EMPTY_SHA}`, "x-amz-date:20130524T000000Z", "", "host;range;x-amz-content-sha256;x-amz-date", EMPTY_SHA].join("\n"));
    expect(sha256Hex(r.canonicalRequest)).toBe("7344ae5b7ee6c3e7e6b0fe0640412a37625d1fbfff95c48bbb2dc43964946972");
    expect(r.stringToSign).toBe(["AWS4-HMAC-SHA256", "20130524T000000Z", "20130524/us-east-1/s3/aws4_request", "7344ae5b7ee6c3e7e6b0fe0640412a37625d1fbfff95c48bbb2dc43964946972"].join("\n"));
    expect(r.signature).toBe("f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41");
    expect(r.headers.authorization).toBe(`AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=${r.signature}`);
    expect(r.headers["x-amz-date"]).toBe("20130524T000000Z");
  });

  it("is deterministic and changes with any signed input", () => {
    const req = { method: "POST", path: "/model/anthropic.claude-3-5-sonnet-20241022-v2%3A0/invoke-with-response-stream", headers: { host: "bedrock-runtime.us-east-1.amazonaws.com", "content-type": "application/json", accept: "application/vnd.amazon.eventstream" }, body: JSON.stringify({ max_tokens: 1 }) };
    const opts = { region: "us-east-1", service: "bedrock", credentials: CREDS, date: "20250101T000000Z" };
    const a = signV4(req, opts);
    const b = signV4(req, opts);
    expect(a.signature).toBe(b.signature);
    expect(signV4({ ...req, body: JSON.stringify({ max_tokens: 2 }) }, opts).signature).not.toBe(a.signature);
    expect(signV4(req, { ...opts, region: "us-west-2" }).signature).not.toBe(a.signature);
    expect(a.scope).toBe("20250101/us-east-1/bedrock/aws4_request");
  });

  it("double-encodes the already-encoded Bedrock model path in the canonical URI (non-S3 services)", () => {
    const r = signV4(
      { method: "POST", path: "/model/anthropic.claude-3-5-sonnet-20241022-v2%3A0/invoke", headers: { host: "bedrock-runtime.us-east-1.amazonaws.com" }, body: "{}" },
      { region: "us-east-1", service: "bedrock", credentials: CREDS, date: "20250101T000000Z" },
    );
    expect(r.canonicalRequest.split("\n")[1]).toBe("/model/anthropic.claude-3-5-sonnet-20241022-v2%253A0/invoke");
  });

  it("signs the session token and the payload hash", () => {
    const r = signV4(
      { method: "POST", path: "/model/x/invoke", headers: { host: "bedrock-runtime.eu-west-1.amazonaws.com", "content-type": "application/json" }, body: '{"a":1}' },
      { region: "eu-west-1", service: "bedrock", credentials: { ...CREDS, sessionToken: "TOKEN" }, date: "20250101T000000Z" },
    );
    expect(r.signedHeaders).toBe("content-type;host;x-amz-date;x-amz-security-token");
    expect(r.headers["x-amz-security-token"]).toBe("TOKEN");
    expect(r.canonicalRequest.trim().endsWith(sha256Hex('{"a":1}'))).toBe(true);
  });

  it("percent-encodes per RFC 3986", () => {
    expect(rfc3986Encode("a b*c'(d)!~")).toBe("a%20b%2Ac%27%28d%29%21~");
  });
});
