import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransportOptions } from "@modelcontextprotocol/sdk/client/sse.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransportOptions } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { proxyServer } from "./proxyServer.js";

export enum ServerType {
  HTTPStream = "HTTPStream",
  SSE = "SSE",
}

export const startStdioServer = async ({
  initStdioServer,
  initStreamClient,
  serverType,
  transportOptions = {},
  url,
}: {
  initStdioServer?: () => Promise<Server>;
  initStreamClient?: () => Promise<Client>;
  serverType: ServerType;
  transportOptions?:
    | SSEClientTransportOptions
    | StreamableHTTPClientTransportOptions;
  url: string;
}): Promise<Server> => {
  let transport: SSEClientTransport | StreamableHTTPClientTransport;
  switch (serverType) {
    case ServerType.SSE:
      transport = new SSEClientTransport(new URL(url), transportOptions);
      break;
    default:
      transport = new StreamableHTTPClientTransport(
        new URL(url),
        transportOptions,
      );
  }
  const streamClient = initStreamClient
    ? await initStreamClient()
    : new Client(
        {
          name: "mcp-proxy",
          version: "1.0.0",
        },
        {
          capabilities: {},
        },
      );
  await streamClient.connect(transport);

  const serverVersion = streamClient.getServerVersion() as {
    name: string;
    version: string;
  };

  const serverCapabilities = streamClient.getServerCapabilities() as {
    capabilities: Record<string, unknown>;
  };

  const stdioServer = initStdioServer
    ? await initStdioServer()
    : new Server(serverVersion, {
        capabilities: serverCapabilities,
      });

  const stdioTransport = new StdioServerTransport();

  await stdioServer.connect(stdioTransport);

  await proxyServer({
    client: streamClient,
    server: stdioServer,
    serverCapabilities,
  });

  return stdioServer;
};
