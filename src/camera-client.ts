import sharp from "sharp";

export interface CameraSnapshot {
  mimeType: string;
  base64Data: string;
  byteLength: number;
  source?: "cache" | "stream" | "http";
  totalMs?: number;
}

export class CameraClient {
  private snapshotUrl?: string;
  private basicAuth?: string;
  private cachedSnapshot?: { url: string; snapshot: CameraSnapshot; expiresAt: number };
  private mjpegStream?: {
    url: string;
    abort: AbortController;
    task: Promise<void>;
    lastFrame?: Buffer<ArrayBufferLike>;
    lastFrameTs?: number;
    lastSnapshot?: { frameTs: number; configKey: string; snapshot: CameraSnapshot };
    waiters: Array<(frame: Buffer<ArrayBufferLike>) => void>;
  };

  constructor(snapshotUrl: string | undefined = process.env.CAMERA_SNAPSHOT_URL) {
    this.snapshotUrl = snapshotUrl;
    this.basicAuth = process.env.CAMERA_BASIC_AUTH;
  }

  private getSnapshotCacheMs() {
    const raw = process.env.MCP_X_SNAPSHOT_CACHE_MS ?? "500";
    const cacheMs = Number.parseInt(raw, 10);
    return Number.isFinite(cacheMs) && cacheMs > 0 ? cacheMs : 0;
  }

  private getMjpegStreamEnabled() {
    const enabledEnv = (process.env.MCP_X_MJPEG_STREAM ?? "1").trim().toLowerCase();
    return enabledEnv !== "0" && enabledEnv !== "false" && enabledEnv !== "off";
  }

  private async waitForMjpegFrame(params: { timeoutMs: number }) {
    const stream = this.mjpegStream;
    if (!stream) return undefined;
    if (stream.lastFrame) return stream.lastFrame;

    const timeoutMs = Math.max(0, params.timeoutMs);
    if (timeoutMs === 0) return undefined;

    return await new Promise<Buffer<ArrayBufferLike> | undefined>((resolve) => {
      const timer = setTimeout(() => {
        const i = stream.waiters.indexOf(resolve);
        if (i >= 0) stream.waiters.splice(i, 1);
        resolve(undefined);
      }, timeoutMs);

      stream.waiters.push((frame) => {
        clearTimeout(timer);
        resolve(frame);
      });

      if (stream.waiters.length > 50) {
        stream.waiters.splice(0, stream.waiters.length - 50);
      }
    });
  }

  private async sleep(ms: number) {
    if (!Number.isFinite(ms) || ms <= 0) return;
    await new Promise<void>((resolve) => setTimeout(resolve, ms));
  }

  private async compressIfNeeded(params: {
    buffer: Buffer<ArrayBufferLike>;
    mimeType: string;
  }): Promise<{ buffer: Buffer<ArrayBufferLike>; mimeType: string }> {
    const enabledEnv = (process.env.MCP_X_IMAGE_COMPRESS ?? "1").trim().toLowerCase();
    const enabled = enabledEnv !== "0" && enabledEnv !== "false" && enabledEnv !== "off";
    if (!enabled) return params;

    const minBytes = Number.parseInt(process.env.MCP_X_IMAGE_MIN_BYTES ?? "200000", 10);
    if (Number.isFinite(minBytes) && params.buffer.byteLength < minBytes) return params;

    const maxWidth = Number.parseInt(process.env.MCP_X_IMAGE_MAX_WIDTH ?? "960", 10);
    const quality = Number.parseInt(process.env.MCP_X_IMAGE_QUALITY ?? "65", 10);
    const formatRaw = (process.env.MCP_X_IMAGE_FORMAT ?? "jpeg").trim().toLowerCase();
    const format = formatRaw === "webp" || formatRaw === "png" ? formatRaw : "jpeg";

    try {
      const image = sharp(params.buffer, { failOn: "none" }).rotate();
      const metadata = await image.metadata();

      let pipeline = image;
      if (Number.isFinite(maxWidth) && maxWidth > 0 && metadata.width && metadata.width > maxWidth) {
        pipeline = pipeline.resize({ width: maxWidth, withoutEnlargement: true });
      }

      let outMimeType = params.mimeType;
      if (format === "webp") {
        outMimeType = "image/webp";
        pipeline = pipeline.webp({ quality: Number.isFinite(quality) ? quality : 75 });
      } else if (format === "png" || (format === "jpeg" && metadata.hasAlpha)) {
        outMimeType = "image/png";
        pipeline = pipeline.png({ compressionLevel: 9, adaptiveFiltering: true });
      } else {
        outMimeType = "image/jpeg";
        pipeline = pipeline.jpeg({ quality: Number.isFinite(quality) ? quality : 75, mozjpeg: true });
      }

      const outBuffer = await pipeline.toBuffer();
      if (outBuffer.byteLength >= params.buffer.byteLength) return params;
      return { buffer: outBuffer, mimeType: outMimeType };
    } catch {
      return params;
    }
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
  ): Promise<Buffer<ArrayBufferLike>> {
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

  private async readJpegFramesFromMjpegStream(
    body: ReadableStream<Uint8Array>,
    opts: { abort: AbortController; maxBufferBytes: number; maxSearchedBytes: number; onFrame: (frame: Buffer<ArrayBufferLike>) => void }
  ) {
    const reader = body.getReader();
    const jpegStart = Buffer.from([0xff, 0xd8]);
    const jpegEnd = Buffer.from([0xff, 0xd9]);

    let buffer = Buffer.alloc(0);
    let searchedBytes = 0;

    try {
      while (!opts.abort.signal.aborted) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value || value.byteLength === 0) continue;

        const chunk = Buffer.from(value);
        buffer = Buffer.concat([buffer, chunk]);
        searchedBytes += chunk.byteLength;

        if (searchedBytes > opts.maxSearchedBytes) {
          throw new Error(`MJPEG stream read exceeded ${opts.maxSearchedBytes} bytes`);
        }

        while (true) {
          const startIndex = buffer.indexOf(jpegStart);
          if (startIndex < 0) break;

          const endIndex = buffer.indexOf(jpegEnd, startIndex + 2);
          if (endIndex < 0) break;

          const frame = buffer.subarray(startIndex, endIndex + 2);
          opts.onFrame(frame);
          buffer = buffer.subarray(endIndex + 2);
        }

        if (buffer.length > opts.maxBufferBytes) {
          buffer = buffer.subarray(Math.max(0, buffer.length - Math.floor(opts.maxBufferBytes / 4)));
        }
      }
    } finally {
      try {
        await reader.cancel();
      } catch {
      }
    }
  }

  private stopMjpegStream() {
    const stream = this.mjpegStream;
    if (!stream) return;
    stream.abort.abort();
    this.mjpegStream = undefined;
  }

  private ensureMjpegStreamRunning(url: string) {
    if (!this.getMjpegStreamEnabled()) return;
    if (this.mjpegStream?.url === url) return;

    this.stopMjpegStream();

    const abort = new AbortController();
    const stream = {
      url,
      abort,
      task: Promise.resolve(),
      lastFrame: undefined as Buffer<ArrayBufferLike> | undefined,
      lastFrameTs: undefined as number | undefined,
      lastSnapshot: undefined as { frameTs: number; configKey: string; snapshot: CameraSnapshot } | undefined,
      waiters: [] as Array<(frame: Buffer<ArrayBufferLike>) => void>,
    };

    stream.task = (async () => {
      let backoffMs = 300;

      while (!abort.signal.aborted) {
        const authHeaderValue = this.getAuthHeaderValue();
        try {
          const response = await fetch(url, {
            method: "GET",
            headers: authHeaderValue ? { Authorization: authHeaderValue } : undefined,
            signal: abort.signal,
          });

          if (!response.ok) {
            throw new Error(`HTTP ${response.status} ${response.statusText}`);
          }

          const contentType = response.headers.get("content-type") ?? "";
          const contentTypeLower = contentType.toLowerCase();
          const isMjpeg =
            contentTypeLower.includes("multipart/x-mixed-replace") ||
            (contentTypeLower.startsWith("multipart/") && contentTypeLower.includes("boundary="));

          if (!isMjpeg || !response.body) {
            return;
          }

          const maxBufferBytes = Number.parseInt(process.env.MCP_X_MJPEG_MAX_BUFFER_BYTES ?? "2097152", 10);
          const maxSearchedBytes = Number.parseInt(process.env.MCP_X_MJPEG_MAX_SEARCH_BYTES ?? "16777216", 10);

          await this.readJpegFramesFromMjpegStream(response.body as ReadableStream<Uint8Array>, {
            abort,
            maxBufferBytes: Number.isFinite(maxBufferBytes) && maxBufferBytes > 0 ? maxBufferBytes : 2 * 1024 * 1024,
            maxSearchedBytes: Number.isFinite(maxSearchedBytes) && maxSearchedBytes > 0 ? maxSearchedBytes : 16 * 1024 * 1024,
            onFrame: (frame) => {
              stream.lastFrame = frame;
              stream.lastFrameTs = Date.now();
              stream.lastSnapshot = undefined;
              const waiters = stream.waiters.splice(0, stream.waiters.length);
              for (const resolve of waiters) resolve(frame);
            },
          });

          backoffMs = 300;
        } catch {
          if (abort.signal.aborted) return;
          await this.sleep(backoffMs);
          backoffMs = Math.min(5000, Math.floor(backoffMs * 1.7));
        }
      }
    })();

    this.mjpegStream = stream;
  }

  async fetchSnapshot(params?: { url?: string; timeoutMs?: number }): Promise<CameraSnapshot> {
    const startAt = Date.now();
    const url = (params?.url ?? this.snapshotUrl)?.trim();
    if (!url) {
      throw new Error("Missing camera snapshot url. Set CAMERA_SNAPSHOT_URL or pass url.");
    }

    const cacheMs = this.getSnapshotCacheMs();
    if (cacheMs > 0 && this.cachedSnapshot?.url === url && Date.now() < this.cachedSnapshot.expiresAt) {
      return { ...this.cachedSnapshot.snapshot, source: "cache", totalMs: Date.now() - startAt };
    }

    if (this.mjpegStream?.url === url) {
      const configKey = [
        process.env.MCP_X_IMAGE_COMPRESS ?? "1",
        process.env.MCP_X_IMAGE_MIN_BYTES ?? "200000",
        process.env.MCP_X_IMAGE_MAX_WIDTH ?? "960",
        process.env.MCP_X_IMAGE_QUALITY ?? "65",
        process.env.MCP_X_IMAGE_FORMAT ?? "jpeg",
      ].join("|");

      const streamSnapshot = this.mjpegStream.lastSnapshot;
      if (streamSnapshot && streamSnapshot.configKey === configKey && streamSnapshot.frameTs === this.mjpegStream.lastFrameTs) {
        const snap: CameraSnapshot = { ...streamSnapshot.snapshot, source: "stream", totalMs: Date.now() - startAt };
        if (cacheMs > 0) {
          this.cachedSnapshot = { url, snapshot: snap, expiresAt: Date.now() + cacheMs };
        }
        return snap;
      }

      const frame = await this.waitForMjpegFrame({ timeoutMs: Math.min(params?.timeoutMs ?? 8000, 1200) });
      if (frame) {
        let mimeType = "image/jpeg";
        const compressed = await this.compressIfNeeded({ buffer: frame, mimeType });
        const snapshot: CameraSnapshot = {
          mimeType: compressed.mimeType,
          base64Data: compressed.buffer.toString("base64"),
          byteLength: compressed.buffer.byteLength,
          source: "stream",
          totalMs: Date.now() - startAt,
        };
        this.mjpegStream.lastSnapshot = {
          frameTs: this.mjpegStream.lastFrameTs ?? Date.now(),
          configKey,
          snapshot,
        };
        if (cacheMs > 0) {
          this.cachedSnapshot = { url, snapshot, expiresAt: Date.now() + cacheMs };
        }
        return snapshot;
      }
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

      let mimeType = (isMjpeg ? "image/jpeg" : contentType.split(";")[0]) ?? "image/jpeg";

      let buffer: Buffer<ArrayBufferLike> = isMjpeg && response.body
        ? await this.readFirstJpegFrameFromMjpegStream(response.body as ReadableStream<Uint8Array>, {
            controller,
            maxBytes: 4 * 1024 * 1024,
          })
        : (Buffer.from(await response.arrayBuffer()) as Buffer<ArrayBufferLike>);

      const compressed = await this.compressIfNeeded({ buffer, mimeType });
      buffer = compressed.buffer;
      mimeType = compressed.mimeType;

      if (isMjpeg) {
        this.ensureMjpegStreamRunning(url);
      }

      const snapshot: CameraSnapshot = {
        mimeType,
        base64Data: buffer.toString("base64"),
        byteLength: buffer.byteLength,
        source: "http",
        totalMs: Date.now() - startAt,
      };

      if (cacheMs > 0) {
        this.cachedSnapshot = { url, snapshot, expiresAt: Date.now() + cacheMs };
      }

      return snapshot;
    } finally {
      clearTimeout(timeout);
    }
  }
}
