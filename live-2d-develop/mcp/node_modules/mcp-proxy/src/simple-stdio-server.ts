import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const server = new Server(
  {
    name: "example-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      resources: { subscribe: true },
    },
  },
);

server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
    resources: [
      {
        name: "Example Resource",
        uri: "file:///example.txt",
      },
    ],
  };
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  if (request.params.uri === "file:///example.txt") {
    return {
      contents: [
        {
          mimeType: "text/plain",
          text: "This is the content of the example resource.",
          uri: "file:///example.txt",
        },
      ],
    };
  } else {
    throw new Error("Resource not found");
  }
});

server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
  return {
    resourceTemplates: [
      {
        description: "Specify the filename to retrieve",
        name: "Example resource template",
        uriTemplate: `file://{filename}`,
      },
    ],
  };
});

server.setRequestHandler(SubscribeRequestSchema, async () => {
  return {};
});

server.setRequestHandler(UnsubscribeRequestSchema, async () => {
  return {};
});

const transport = new StdioServerTransport();

await server.connect(transport);
