import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { EventSource } from "eventsource";
import { getRandomPort } from "get-port-please";
import { setTimeout as delay } from "node:timers/promises";
import { expect, it, vi } from "vitest";

import { proxyServer } from "./proxyServer.js";
import { startHTTPStreamServer } from "./startHTTPStreamServer.js";

if (!("EventSource" in global)) {
  // @ts-expect-error - figure out how to use --experimental-eventsource with vitest
  global.EventSource = EventSource;
}

it("proxies messages between HTTP stream and stdio servers", async () => {
  const stdioTransport = new StdioClientTransport({
    args: ["src/simple-stdio-server.ts"],
    command: "tsx",
  });

  const stdioClient = new Client(
    {
      name: "mcp-proxy",
      version: "1.0.0",
    },
    {
      capabilities: {},
    },
  );

  await stdioClient.connect(stdioTransport);

  const serverVersion = stdioClient.getServerVersion() as {
    name: string;
    version: string;
  };

  const serverCapabilities = stdioClient.getServerCapabilities() as {
    capabilities: Record<string, unknown>;
  };

  const port = await getRandomPort();

  const onConnect = vi.fn();
  const onClose = vi.fn();

  await startHTTPStreamServer({
    createServer: async () => {
      const mcpServer = new Server(serverVersion, {
        capabilities: serverCapabilities,
      });

      await proxyServer({
        client: stdioClient,
        server: mcpServer,
        serverCapabilities,
      });

      return mcpServer;
    },
    endpoint: "/stream",
    onClose,
    onConnect,
    port,
  });

  const streamClient = new Client(
    {
      name: "stream-client",
      version: "1.0.0",
    },
    {
      capabilities: {},
    },
  );

  const transport = new StreamableHTTPClientTransport(
    new URL(`http://localhost:${port}/stream`),
  );

  await streamClient.connect(transport);

  const result = await streamClient.listResources();
  expect(result).toEqual({
    resources: [
      {
        name: "Example Resource",
        uri: "file:///example.txt",
      },
    ],
  });

  expect(
    await streamClient.readResource({ uri: result.resources[0].uri }, {}),
  ).toEqual({
    contents: [
      {
        mimeType: "text/plain",
        text: "This is the content of the example resource.",
        uri: "file:///example.txt",
      },
    ],
  });
  expect(await streamClient.subscribeResource({ uri: "xyz" })).toEqual({});
  expect(await streamClient.unsubscribeResource({ uri: "xyz" })).toEqual({});
  expect(await streamClient.listResourceTemplates()).toEqual({
    resourceTemplates: [
      {
        description: "Specify the filename to retrieve",
        name: "Example resource template",
        uriTemplate: `file://{filename}`,
      },
    ],
  });

  expect(onConnect).toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();

  // the transport no requires the function terminateSession to be called but the client does not implement it
  // so we need to call it manually
  await transport.terminateSession();
  await streamClient.close();

  await delay(1000);

  expect(onClose).toHaveBeenCalled();
});
