import { describe, expect, it, vi } from "vitest";
import { extractFromEmrPdf, MAX_UPLOAD_BYTES } from "../src/utils/emrExtract.ts";

// Build a fake File. `producerAtEnd` imitates how "Microsoft: Print To PDF" marks its files.
function pdfFile({ size = 2000, producerAtEnd = false, type = "application/pdf" } = {}) {
  let tail = "";
  if (producerAtEnd) tail = "\n/Producer (Microsoft: Print To PDF)\n%%EOF";
  const bytes = new Uint8Array(Math.max(size, 20 + tail.length));
  bytes.set(new TextEncoder().encode("%PDF-1.4 synthetic"), 0);
  if (tail) bytes.set(new TextEncoder().encode(tail), bytes.length - tail.length);
  return new File([bytes], "synthetic.pdf", { type });
}

function serverReplies(status, jsonBody) {
  const fetchMock = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (jsonBody === undefined) throw new Error("not json"); // imitates an HTML/plain-text error page
      return jsonBody;
    },
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("extractFromEmrPdf: checks that happen before upload", () => {
  it("rejects files that are not PDFs", async () => {
    const f = serverReplies(200, {});
    await expect(extractFromEmrPdf(pdfFile({ type: "image/png" }))).rejects.toThrow(/PDF/);
    expect(f).not.toHaveBeenCalled();
  });

  it("stops a Microsoft Print to PDF file and tells the user how to re-save it", async () => {
    const f = serverReplies(200, {});
    const err = await extractFromEmrPdf(pdfFile({ producerAtEnd: true })).catch((e) => e);
    expect(err.message).toMatch(/Microsoft Print to PDF/);
    expect(err.message).toMatch(/Save as PDF/);
    expect(f).not.toHaveBeenCalled();
  });

  it("detects the marker even when the file is large (reads only the end)", async () => {
    const f = serverReplies(200, {});
    const err = await extractFromEmrPdf(pdfFile({ size: 5 * 1024 * 1024, producerAtEnd: true })).catch((e) => e);
    expect(err.message).toMatch(/Microsoft Print to PDF/);
    expect(f).not.toHaveBeenCalled();
  });

  it("stops files over the size limit and states the size", async () => {
    const f = serverReplies(200, {});
    const err = await extractFromEmrPdf(pdfFile({ size: MAX_UPLOAD_BYTES + 1 })).catch((e) => e);
    expect(err.message).toMatch(/too large/);
    expect(err.message).toMatch(/3\.0 MB/);
    expect(err.message).toMatch(/Save as PDF/);
    expect(f).not.toHaveBeenCalled();
  });

  it("accepts a small normal PDF and sends it to the server", async () => {
    const f = serverReplies(200, {
      choices: [{ message: { content: JSON.stringify({ name: "TEST PATIENT", currentDiagnosis: "Dx: malaria", vitals: { bp: "120/80" } }) } }],
      filteredText: "context",
    });
    const result = await extractFromEmrPdf(pdfFile());
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("/api/extract-emr");
    expect(JSON.parse(init.body).document.mediaType).toBe("application/pdf");
    expect(result.extracted.name).toBe("TEST PATIENT");
    expect(result.extracted.currentDiagnosis).toBe("malaria"); // "Dx:" prefix is removed
    expect(result.extracted.vitals.bp).toBe("120/80");
  });
});

describe("extractFromEmrPdf: server replies that are not JSON", () => {
  it.each([
    [413, /too large/],
    [408, /took too long/],
    [504, /took too long/],
    [500, /server had a problem \(error 500\)/],
    [502, /server had a problem \(error 502\)/],
    [418, /code 418/],
  ])("status %i gives a clear message", async (status, pattern) => {
    serverReplies(status, undefined);
    const err = await extractFromEmrPdf(pdfFile()).catch((e) => e);
    expect(err.message).toMatch(pattern);
    expect(err.message).not.toBe("Unexpected response from server. Please try again.");
  });
});

describe("extractFromEmrPdf: server replies with JSON", () => {
  it("shows the server's own error message", async () => {
    serverReplies(500, { error: "Extraction failed: something specific" });
    await expect(extractFromEmrPdf(pdfFile())).rejects.toThrow("Extraction failed: something specific");
  });

  it("reports an empty AI reply", async () => {
    serverReplies(200, { choices: [{ message: { content: "" } }] });
    await expect(extractFromEmrPdf(pdfFile())).rejects.toThrow(/Empty response/);
  });
});
