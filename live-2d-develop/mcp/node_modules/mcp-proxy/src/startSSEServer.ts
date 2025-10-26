import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import http from "http";

export type SSEServer = {
  close: () => Promise<void>;
};

type ServerLike = {
  close: Server["close"];
  connect: Server["connect"];
};

export const startSSEServer = async <T extends ServerLike>({
  createServer,
  endpoint,
  onClose,
  onConnect,
  onUnhandledRequest,
  port,
}: {
  createServer: (request: http.IncomingMessage) => Promise<T>;
  endpoint: string;
  onClose?: (server: T) => void;
  onConnect?: (server: T) => void;
  onUnhandledRequest?: (
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ) => Promise<void>;
  port: number;
}): Promise<SSEServer> => {
  const activeTransports: Record<string, SSEServerTransport> = {};

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

    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "Content-Type": "text/plain" }).end("OK");
      return;
    }

    if (req.method === "GET" && req.url === `/ping`) {
      res.writeHead(200).end("pong");

      return;
    }

    if (
      req.method === "GET" &&
      new URL(req.url!, "http://localhost").pathname === endpoint
    ) {
      const transport = new SSEServerTransport("/messages", res);

      let server: T;

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

      activeTransports[transport.sessionId] = transport;

      let closed = false;

      res.on("close", async () => {
        closed = true;

        try {
          await server.close();
        } catch (error) {
          console.error("Error closing server:", error);
        }

        delete activeTransports[transport.sessionId];

        onClose?.(server);
      });

      try {
        await server.connect(transport);

        await transport.send({
          jsonrpc: "2.0",
          method: "sse/connection",
          params: { message: "SSE Connection established" },
        });

        onConnect?.(server);
      } catch (error) {
        if (!closed) {
          console.error("Error connecting to server:", error);

          res.writeHead(500).end("Error connecting to server");
        }
      }

      return;
    }

    if (req.method === "POST" && req.url?.startsWith("/messages")) {
      const sessionId = new URL(
        req.url,
        "https://example.com",
      ).searchParams.get("sessionId");

      if (!sessionId) {
        res.writeHead(400).end("No sessionId");

        return;
      }

      const activeTransport: SSEServerTransport | undefined =
        activeTransports[sessionId];

      if (!activeTransport) {
        res.writeHead(400).end("No active transport");

        return;
      }

      await activeTransport.handlePostMessage(req, res);

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
        await transport.close();
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
