#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";



import { registerTools } from "./tools.js";

// 创建MCP服务器
const server = new McpServer({
  name: "car-controller-mcp",
  version: "1.0.0"
});

registerTools(server);


async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Car Controller MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});