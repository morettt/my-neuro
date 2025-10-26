import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  EventStore,
  StreamableHTTPServerTransport,
} from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import http from "http";
import { randomUUID } from "node:crypto";

import { InMemoryEventStore } from "./InMemoryEventStore.js";

export type SSEServer = {
  close: () => Promise<void>;
};

type ServerLike = {
  close: Server["close"];
  connect: Server["connect"];
};

export const startHTTPStreamServer = async <T extends ServerLike>({
  createServer,
  endpoint,
  eventStore,
  onClose,
  onConnect,
  onUnhandledRequest,
  port,
}: {
  createServer: (request: http.IncomingMessage) => Promise<T>;
  endpoint: string;
  eventStore?: EventStore;
  onClose?: (server: T) => void;
  onConnect?: (server: T) => void;
  onUnhandledRequest?: (
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ) => Promise<void>;
  port: number;
}): Promise<SSEServer> => {
  const activeTransports: Record<
    string,
    {
      server: T;
      transport: StreamableHTTPServerTransport;
    }
  > = {};

  /**
   * @author https://dev.classmethod.jp/articles/mcp-sse/
   */
  const httpServer = http.createServer(async (req, res) => {
    if (req.headers.origin) {
      try {
        const origin = new URL(req.headers.origin);

        res.setHeader("Access-Control-Allow-Origin", origin.origin);
        res.setHeader("Access-Control-Allow-Credentials", "true");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "*");
      } catch (error) {
        console.error("Error parsing origin:", error);
      }
    }

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === "GET" && req.url === `/ping`) {
      res.writeHead(200).end("pong");
      return;
    }

    if (
      req.method === "POST" &&
      new URL(req.url!, "http://localhost").pathname === endpoint
    ) {
      try {
        const sessionId = Array.isArray(req.headers["mcp-session-id"])
          ? req.headers["mcp-session-id"][0]
          : req.headers["mcp-session-id"];
        let transport: StreamableHTTPServerTransport;
        let server: T;

        const body = await getBody(req);

        if (sessionId && activeTransports[sessionId]) {
          transport = activeTransports[sessionId].transport;
          server = activeTransports[sessionId].server;
        } else if (!sessionId && isInitializeRequest(body)) {
          // Create a new transport for the session
          transport = new StreamableHTTPServerTransport({
            eventStore: eventStore || new InMemoryEventStore(),
            onsessioninitialized: (_sessionId) => {
              // add only when the id Sesison id is generated
              activeTransports[_sessionId] = {
                server,
                transport,
              };
            },
            sessionIdGenerator: randomUUID,
          });

          // Handle the server close event
          transport.onclose = async () => {
            const sid = transport.sessionId;
            if (sid && activeTransports[sid]) {
              onClose?.(server);
              try {
                await server.close();
              } catch (error) {
                console.error("Error closing server:", error);
              }
              delete activeTransports[sid];
            }
          };

          // Create the server
          try {
            server = await createServer(req);
          } catch (error) {
            if (error instanceof Response) {
              res.writeHead(error.status).end(error.statusText);
              return;
            }
            res.writeHead(500).end("Error creating server");
            return;
          }

          server.connect(transport);
          onConnect?.(server);

          await transport.handleRequest(req, res, body);
          return;
        } else {
          // Error if the server is not created but the request is not an initialize request
          res.setHeader("Content-Type", "application/json");
          res.writeHead(400).end(
            JSON.stringify({
              error: {
                code: -32000,
                message: "Bad Request: No valid session ID provided",
              },
              id: null,
              jsonrpc: "2.0",
            }),
          );

          return;
        }

        // Handle ther request if the server is already created
        await transport.handleRequest(req, res, body);
      } catch (error) {
        console.error("Error handling request:", error);
        res.setHeader("Content-Type", "application/json");
        res.writeHead(500).end(
          JSON.stringify({
            error: { code: -32603, message: "Internal Server Error" },
            id: null,
            jsonrpc: "2.0",
          }),
        );
      }
      return;
    }

    if (
      req.method === "GET" &&
      new URL(req.url!, "http://localhost").pathname === endpoint
    ) {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      const activeTransport:
        | {
            server: T;
            transport: StreamableHTTPServerTransport;
          }
        | undefined = sessionId ? activeTransports[sessionId] : undefined;

      if (!sessionId) {
        res.writeHead(400).end("No sessionId");
        return;
      }

      if (!activeTransport) {
        res.writeHead(400).end("No active transport");
        return;
      }

      const lastEventId = req.headers["last-event-id"] as string | undefined;
      if (lastEventId) {
        console.log(`Client reconnecting with Last-Event-ID: ${lastEventId}`);
      } else {
        console.log(`Establishing new SSE stream for session ${sessionId}`);
      }

      await activeTransport.transport.handleRequest(req, res);
      return;
    }

    if (
      req.method === "DELETE" &&
      new URL(req.url!, "http://localhost").pathname === endpoint
    ) {
      console.log("received delete request");
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      if (!sessionId) {
        res.writeHead(400).end("Invalid or missing sessionId");
        return;
      }

      console.log("received delete request for session", sessionId);

      const { server, transport } = activeTransports[sessionId];
      if (!transport) {
        res.writeHead(400).end("No active transport");
        return;
      }

      try {
        await transport.handleRequest(req, res);
        onClose?.(server);
      } catch (error) {
        console.error("Error handling delete request:", error);
        res.writeHead(500).end("Error handling delete request");
      }

      return;
    }

    if (onUnhandledRequest) {
      await onUnhandledRequest(req, res);
    } else {
      res.writeHead(404).end();
    }
  });

  await new Promise((resolve) => {
    httpServer.listen(port, "::", () => {
      resolve(undefined);
    });
  });

  return {
    close: async () => {
      for (const transport of Object.values(activeTransports)) {
        await transport.transport.close();
      }

      return new Promise((resolve, reject) => {
        httpServer.close((error) => {
          if (error) {
            reject(error);

            return;
          }

          resolve();
        });
      });
    },
  };
};

function getBody(request: http.IncomingMessage) {
  return new Promise((resolve) => {
    const bodyParts: Buffer[] = [];
    let body: string;
    request
      .on("data", (chunk) => {
        bodyParts.push(chunk);
      })
      .on("end", () => {
        body = Buffer.concat(bodyParts).toString();
        resolve(JSON.parse(body));
      });
  });
}
