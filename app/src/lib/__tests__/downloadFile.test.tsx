/**
 * downloadFile.test.tsx — EXP-1 client-side regression suite.
 *
 * The old export buttons were plain `<a download>` anchors, so the browser
 * saved whatever came back — including {"error":"upstream_error"} as
 * findings.json. downloadFile() must only trigger a download for a real
 * file response, and must return a customer-safe error (downloading
 * nothing) in every failure mode.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { downloadFile, filenameFromContentDisposition } from "../downloadFile";

const originalFetch = global.fetch;

let createObjectURLMock: ReturnType<typeof vi.fn>;
let revokeObjectURLMock: ReturnType<typeof vi.fn>;
let clickSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  createObjectURLMock = vi.fn(() => "blob:mock-url");
  revokeObjectURLMock = vi.fn();
  (URL as unknown as Record<string, unknown>).createObjectURL = createObjectURLMock;
  (URL as unknown as Record<string, unknown>).revokeObjectURL = revokeObjectURLMock;
  clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});

afterEach(() => {
  global.fetch = originalFetch;
  clickSpy.mockRestore();
});

function csvResponse(): Response {
  return new Response('"ID","Title"\r\n"1","Finding"\r\n', {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="findings-2026-07-16.csv"',
    },
  });
}

describe("downloadFile", () => {
  it("downloads a CSV response using the server-provided .csv filename", async () => {
    global.fetch = vi.fn(async () => csvResponse());
    let capturedDownload: string | null = null;
    clickSpy.mockImplementation(function (this: HTMLAnchorElement) {
      capturedDownload = this.download;
    });

    const result = await downloadFile("/api/export/findings", "fallback.csv");

    expect(result).toBeNull();
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(capturedDownload).toBe("findings-2026-07-16.csv");
    expect(capturedDownload!.endsWith(".csv")).toBe(true);
    expect(createObjectURLMock).toHaveBeenCalledTimes(1);
    expect(revokeObjectURLMock).toHaveBeenCalledTimes(1);
  });

  it("returns an error and downloads nothing when the API responds with a JSON error", async () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: "upstream_error" }), {
        status: 502,
        headers: { "content-type": "application/json" },
      })
    );

    const result = await downloadFile("/api/export/findings", "findings.csv");

    expect(result).toMatch(/export failed/i);
    expect(clickSpy).not.toHaveBeenCalled();
    expect(createObjectURLMock).not.toHaveBeenCalled();
  });

  it("never downloads a JSON body even on a 200 response", async () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: "upstream_error" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    const result = await downloadFile("/api/export/findings", "findings.csv");

    expect(result).toMatch(/export failed/i);
    expect(clickSpy).not.toHaveBeenCalled();
    expect(createObjectURLMock).not.toHaveBeenCalled();
  });

  it("returns an error and downloads nothing when fetch itself fails", async () => {
    global.fetch = vi.fn(async () => {
      throw new TypeError("network down");
    });

    const result = await downloadFile("/api/export/findings", "findings.csv");

    expect(result).toMatch(/export failed/i);
    expect(clickSpy).not.toHaveBeenCalled();
    expect(createObjectURLMock).not.toHaveBeenCalled();
  });

  it("falls back to the provided filename when the server sends no content-disposition", async () => {
    global.fetch = vi.fn(async () =>
      new Response("a,b\r\n1,2\r\n", {
        status: 200,
        headers: { "content-type": "text/csv" },
      })
    );
    let capturedDownload: string | null = null;
    clickSpy.mockImplementation(function (this: HTMLAnchorElement) {
      capturedDownload = this.download;
    });

    const result = await downloadFile("/api/export/findings", "findings-fallback.csv");

    expect(result).toBeNull();
    expect(capturedDownload).toBe("findings-fallback.csv");
  });
});

describe("filenameFromContentDisposition", () => {
  it("parses quoted and unquoted filenames", () => {
    expect(filenameFromContentDisposition('attachment; filename="a-b.csv"')).toBe("a-b.csv");
    expect(filenameFromContentDisposition("attachment; filename=a.pdf")).toBe("a.pdf");
    expect(filenameFromContentDisposition(null)).toBeNull();
    expect(filenameFromContentDisposition("attachment")).toBeNull();
  });
});
