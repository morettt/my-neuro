#!/usr/bin/env node

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { EventSource } from "eventsource";
import { setTimeout } from "node:timers";
import util from "node:util";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { InMemoryEventStore } from "../InMemoryEventStore.js";
import { proxyServer } from "../proxyServer.js";
import { startHTTPStreamServer } from "../startHTTPStreamServer.js";
import { startSSEServer } from "../startSSEServer.js";
import { StdioClientTransport } from "../StdioClientTransport.js";

util.inspect.defaultOptions.depth = 8;

if (!("EventSource" in global)) {
  // @ts-expect-error - figure out how to use --experimental-eventsource with vitest
  global.EventSource = EventSource;
}

const argv = await yargs(hideBin(process.argv))
  .scriptName("mcp-proxy")
  .command("$0 <command> [args...]", "Run a command with MCP arguments")
  .positional("command", {
    demandOption: true,
    describe: "The command to run",
    type: "string",
  })
  .positional("args", {
    array: true,
    describe: "The arguments to pass to the command",
    type: "string",
  })
  .env("MCP_PROXY")
  .options({
    debug: {
      default: false,
      describe: "Enable debug logging",
      type: "boolean",
    },
    endpoint: {
      describe: "The endpoint to listen on",
      type: "string",
    },
    port: {
      default: 8080,
      describe: "The port to listen on",
      type: "number",
    },
    server: {
      choices: ["sse", "stream"],
      default: "sse",
      describe: "The server type to use (sse or stream)",
      type: "string",
    },
  })
  .help()
  .parseAsync();

const connect = async (client: Client) => {
  const transport = new StdioClientTransport({
    args: argv.args,
    command: argv.command,
    env: process.env as Record<string, string>,
    onEvent: (event) => {
      if (argv.debug) {
        console.debug("transport event", event);
      }
    },
    stderr: "pipe",
  });

  await client.connect(transport);
};

const proxy = async () => {
  const client = new Client(
    {
      name: "mcp-proxy",
      version: "1.0.0",
    },
    {
      capabilities: {},
    },
  );

  await connect(client);

  const serverVersion = client.getServerVersion() as {
    name: string;
    version: string;
  };

  const serverCapabilities = client.getServerCapabilities() as {
    capabilities: Record<string, unknown>;
  };

  console.info("starting the %s server on port %d", argv.server, argv.port);

  const createServer = async () => {
    const server = new Server(serverVersion, {
      capabilities: serverCapabilities,
    });

    proxyServer({
      client,
      server,
      serverCapabilities,
    });

    return server;
  };

  if (argv.server === "sse") {
    await startSSEServer({
      createServer,
      endpoint: argv.endpoint || ("/sse" as `/${string}`),
      port: argv.port,
    });
  } else {
    await startHTTPStreamServer({
      createServer,
      endpoint: argv.endpoint || ("/stream" as `/${string}`),
      eventStore: new InMemoryEventStore(),
      port: argv.port,
    });
  }
};

const main = async () => {
  process.on("SIGINT", () => {
    console.info("SIGINT received, shutting down");

    setTimeout(() => {
      process.exit(0);
    }, 1000);
  });

  try {
    await proxy();
  } catch (error) {
    console.error("could not start the proxy", error);

    setTimeout(() => {
      process.exit(1);
    }, 1000);
  }
};

await main();
