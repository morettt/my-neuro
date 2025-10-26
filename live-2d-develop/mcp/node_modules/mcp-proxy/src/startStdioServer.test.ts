import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  CallToolResultSchema,
  LoggingMessageNotificationSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { EventSource } from "eventsource";
import { ChildProcess, fork } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ServerType } from "./startStdioServer.js";

if (!("EventSource" in global)) {
  // @ts-expect-error - figure out how to use --experimental-eventsource with vitest
  global.EventSource = EventSource;
}

describe("startStdioServer.test.ts", () => {
  let proc: ChildProcess;

  beforeEach(async () => {
    const serverPath = require.resolve(
      "@modelcontextprotocol/sdk/examples/server/sseAndStreamableHttpCompatibleServer.js",
    );
    proc = fork(serverPath, [], {
      stdio: "pipe",
    });
    await new Promise((resolve) => {
      proc.stdout?.on("data", (data) => {
        console.log(data.toString());
        data
          .toString()
          .includes("Backwards compatible MCP server listening on port");
        resolve(null);
      });
    });
  });

  afterEach(async () => {
    proc.kill();
  });

  it("proxies messages between stdio and sse servers", async () => {
    const stdioTransport = new StdioClientTransport({
      args: [
        "src/simple-stdio-proxy-server.ts",
        JSON.stringify({
          serverType: ServerType.SSE,
          url: "http://127.0.0.1:3000/sse",
        }),
      ],
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

    let notificationCount = 0;

    stdioClient.setNotificationHandler(
      LoggingMessageNotificationSchema,
      (notification) => {
        console.log(
          `Notification: ${notification.params.level} - ${notification.params.data}`,
        );
        notificationCount++;
      },
    );

    await stdioClient.connect(stdioTransport);

    const result = await stdioClient.listTools();

    expect(result).toEqual({
      tools: [
        {
          description:
            "Starts sending periodic notifications for testing resumability",
          inputSchema: {
            $schema: "http://json-schema.org/draft-07/schema#",
            additionalProperties: false,
            properties: {
              count: {
                default: 50,
                description: "Number of notifications to send (0 for 100)",
                type: "number",
              },
              interval: {
                default: 100,
                description: "Interval in milliseconds between notifications",
                type: "number",
              },
            },
            type: "object",
          },
          name: "start-notification-stream",
        },
      ],
    });
    const request = {
      method: "tools/call",
      params: {
        arguments: {
          count: 2, // Send 5 notifications
          interval: 1000, // 1 second between notifications
        },
        name: "start-notification-stream",
      },
    };
    const notificationResult = await stdioClient.request(
      request,
      CallToolResultSchema,
    );

    expect(notificationResult).toEqual({
      content: [
        {
          text: "Started sending periodic notifications every 1000ms",
          type: "text",
        },
      ],
    });

    expect(notificationCount).toEqual(2);

    await stdioClient.close();
  });

  it("proxies messages between stdio and stream able servers", async () => {
    const stdioTransport = new StdioClientTransport({
      args: [
        "src/simple-stdio-proxy-server.ts",
        JSON.stringify({
          serverType: ServerType.HTTPStream,
          url: "http://127.0.0.1:3000/mcp",
        }),
      ],
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

    let notificationCount = 0;

    stdioClient.setNotificationHandler(
      LoggingMessageNotificationSchema,
      (notification) => {
        console.log(
          `Notification: ${notification.params.level} - ${notification.params.data}`,
        );
        notificationCount++;
      },
    );

    await stdioClient.connect(stdioTransport);

    const result = await stdioClient.listTools();

    expect(result).toEqual({
      tools: [
        {
          description:
            "Starts sending periodic notifications for testing resumability",
          inputSchema: {
            $schema: "http://json-schema.org/draft-07/schema#",
            additionalProperties: false,
            properties: {
              count: {
                default: 50,
                description: "Number of notifications to send (0 for 100)",
                type: "number",
              },
              interval: {
                default: 100,
                description: "Interval in milliseconds between notifications",
                type: "number",
              },
            },
            type: "object",
          },
          name: "start-notification-stream",
        },
      ],
    });
    const request = {
      method: "tools/call",
      params: {
        arguments: {
          count: 2, // Send 5 notifications
          interval: 1000, // 1 second between notifications
        },
        name: "start-notification-stream",
      },
    };
    const notificationResult = await stdioClient.request(
      request,
      CallToolResultSchema,
    );

    expect(notificationResult).toEqual({
      content: [
        {
          text: "Started sending periodic notifications every 1000ms",
          type: "text",
        },
      ],
    });

    expect(notificationCount).toEqual(2);

    await stdioClient.close();
  });
});
