# MCP Proxy

A TypeScript SSE proxy for [MCP](https://modelcontextprotocol.io/) servers that use `stdio` transport.

> [!NOTE]
> CORS is enabled by default.

> [!NOTE]
> For a Python implementation, see [mcp-proxy](https://github.com/sparfenyuk/mcp-proxy).

> [!NOTE]
> MCP Proxy is what [FastMCP](https://github.com/punkpeye/fastmcp) uses to enable SSE.

## Installation

```bash
npm install mcp-proxy
```

## Quickstart

### Command-line

```bash
npx mcp-proxy --port 8080 --endpoint /sse tsx server.js
```

This starts a server and `stdio` server (`tsx server.js`). The server listens on port 8080 and endpoint `/sse` by default, and forwards messages to the `stdio` server.

options:

- `--port`: Specify the port to listen on (default: 8080)
- `--endpoint`: Specify the endpoint to listen on (default: `/sse` for SSE server, `/stream` for stream server)
- `--server`: Specify the server type to use (default: `sse`)
- `--debug`: Enable debug logging

### Node.js SDK

The Node.js SDK provides several utilities that are used to create a proxy.

#### `proxyServer`

Sets up a proxy between a server and a client.

```ts
const transport = new StdioClientTransport();
const client = new Client();

const server = new Server(serverVersion, {
  capabilities: {},
});

proxyServer({
  server,
  client,
  capabilities: {},
});
```

In this example, the server will proxy all requests to the client and vice versa.

#### `startSSEServer`

Starts a proxy that listens on a `port` and `endpoint`, and sends messages to the attached server via `SSEServerTransport`.

```ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { startSSEServer } from "mcp-proxy";

const { close } = await startSSEServer({
  port: 8080,
  endpoint: "/sse",
  createServer: async () => {
    return new Server();
  },
});

close();
```

#### `startHTTPStreamServer`

Starts a proxy that listens on a `port` and `endpoint`, and sends messages to the attached server via `StreamableHTTPServerTransport`.

```ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { startHTTPStreamServer, InMemoryEventStore } from "mcp-proxy";

const { close } = await startHTTPStreamServer({
  port: 8080,
  endpoint: "/stream",
  createServer: async () => {
    return new Server();
  },
  eventStore: new InMemoryEventStore(), // optional you can provide your own event store
});

close();
```

#### `startStdioServer`

Starts a proxy that listens on a `stdio`, and sends messages to the attached `sse` or `streamable` server.

```ts
import { ServerType, startStdioServer } from "./startStdioServer.js";

await startStdioServer({
  serverType: ServerType.SSE,
  url: "http://127.0.0.1:3000/sse",
});
```

#### `tapTransport`

Taps into a transport and logs events.

```ts
import { tapTransport } from "mcp-proxy";

const transport = tapTransport(new StdioClientTransport(), (event) => {
  console.log(event);
});
```
