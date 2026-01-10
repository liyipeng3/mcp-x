import fs from "node:fs";
import path from "node:path";

export interface McpXConfig {
  carBaseUrl?: string;
  cameraSnapshotUrl?: string;
}

let cachedConfig: McpXConfig | null = null;

const parseConfigObject = (parsed: unknown): McpXConfig => {
  if (!parsed || typeof parsed !== "object") return {};
  const obj = parsed as Record<string, unknown>;
  return {
    carBaseUrl: typeof obj.carBaseUrl === "string" ? obj.carBaseUrl : undefined,
    cameraSnapshotUrl: typeof obj.cameraSnapshotUrl === "string" ? obj.cameraSnapshotUrl : undefined,
  };
};

export const loadConfig = (): McpXConfig => {
  if (cachedConfig) return cachedConfig;

  const explicitPath = process.env.MCP_X_CONFIG_PATH?.trim();
  const candidates = [
    explicitPath && path.isAbsolute(explicitPath) ? explicitPath : undefined,
    path.join(process.cwd(), "mcp-x.config.json"),
    path.resolve(__dirname, "..", "mcp-x.config.json"),
  ].filter(Boolean) as string[];

  const configPath = candidates.find(p => fs.existsSync(p));
  if (!configPath) {
    cachedConfig = {};
    return cachedConfig;
  }

  const raw = fs.readFileSync(configPath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  cachedConfig = parseConfigObject(parsed);
  return cachedConfig;
};
