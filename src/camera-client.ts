export interface CameraSnapshot {
  mimeType: string;
  base64Data: string;
  byteLength: number;
}

export class CameraClient {
  private snapshotUrl?: string;
  private basicAuth?: string;

  constructor(snapshotUrl: string | undefined = process.env.CAMERA_SNAPSHOT_URL) {
    this.snapshotUrl = snapshotUrl;
    this.basicAuth = process.env.CAMERA_BASIC_AUTH;
  }

  setSnapshotUrl(url: string) {
    this.snapshotUrl = url;
  }

  getSnapshotUrl() {
    return this.snapshotUrl;
  }

  private getAuthHeaderValue() {
    if (!this.basicAuth) return undefined;
    const raw = this.basicAuth.trim();
    if (!raw) return undefined;
    const encoded = raw.includes(":") ? Buffer.from(raw, "utf8").toString("base64") : raw;
    return `Basic ${encoded}`;
  }

  private async readFirstJpegFrameFromMjpegStream(
    body: ReadableStream<Uint8Array>,
    opts: { controller: AbortController; maxBytes: number }
  ) {
    const reader = body.getReader();
    const jpegStart = Buffer.from([0xff, 0xd8]);
    const jpegEnd = Buffer.from([0xff, 0xd9]);

    let buffer = Buffer.alloc(0);
    let searchedBytes = 0;

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value || value.byteLength === 0) continue;

        const chunk = Buffer.from(value);
        buffer = Buffer.concat([buffer, chunk]);
        searchedBytes += chunk.byteLength;

        const startIndex = buffer.indexOf(jpegStart);
        if (startIndex > 0) {
          buffer = buffer.subarray(startIndex);
        }

        const start = startIndex >= 0 ? 0 : buffer.indexOf(jpegStart);
        if (start >= 0) {
          const endIndex = buffer.indexOf(jpegEnd, start + 2);
          if (endIndex >= 0) {
            const frame = buffer.subarray(start, endIndex + 2);
            await reader.cancel();
            opts.controller.abort();
            return frame;
          }
        }

        if (searchedBytes > opts.maxBytes) {
          throw new Error(`MJPEG stream read exceeded ${opts.maxBytes} bytes without a JPEG frame`);
        }

        if (buffer.length > 256 * 1024) {
          buffer = buffer.subarray(Math.max(0, buffer.length - 32 * 1024));
        }
      }

      throw new Error("MJPEG stream ended before a complete JPEG frame was found");
    } finally {
      try {
        await reader.cancel();
      } catch {
      }
    }
  }

  async fetchSnapshot(params?: { url?: string; timeoutMs?: number }): Promise<CameraSnapshot> {
    const url = (params?.url ?? this.snapshotUrl)?.trim();
    if (!url) {
      throw new Error("Missing camera snapshot url. Set CAMERA_SNAPSHOT_URL or pass url.");
    }

    const controller = new AbortController();
    const timeoutMs = Math.max(1000, params?.timeoutMs ?? 8000);
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const authHeaderValue = this.getAuthHeaderValue();
      const response = await fetch(url, {
        method: "GET",
        headers: authHeaderValue ? { Authorization: authHeaderValue } : undefined,
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`HTTP ${response.status} ${response.statusText}${text ? `: ${text}` : ""}`);
      }

      const contentType = response.headers.get("content-type") ?? "image/jpeg";
      const contentTypeLower = contentType.toLowerCase();
      const isMjpeg =
        contentTypeLower.includes("multipart/x-mixed-replace") ||
        (contentTypeLower.startsWith("multipart/") && contentTypeLower.includes("boundary="));

      const buffer = isMjpeg && response.body
        ? await this.readFirstJpegFrameFromMjpegStream(response.body as ReadableStream<Uint8Array>, {
            controller,
            maxBytes: 4 * 1024 * 1024,
          })
        : Buffer.from(await response.arrayBuffer());

      return {
        mimeType: (isMjpeg ? "image/jpeg" : contentType.split(";")[0]) ?? "image/jpeg",
        base64Data: buffer.toString("base64"),
        byteLength: buffer.byteLength,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
