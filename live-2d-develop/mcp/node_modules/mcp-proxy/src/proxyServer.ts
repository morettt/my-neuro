import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  CompleteRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  LoggingMessageNotificationSchema,
  ReadResourceRequestSchema,
  ResourceUpdatedNotificationSchema,
  ServerCapabilities,
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

export const proxyServer = async ({
  client,
  server,
  serverCapabilities,
}: {
  client: Client;
  server: Server;
  serverCapabilities: ServerCapabilities;
}): Promise<void> => {
  if (serverCapabilities?.logging) {
    server.setNotificationHandler(
      LoggingMessageNotificationSchema,
      async (args) => {
        return client.notification(args);
      },
    );
    client.setNotificationHandler(
      LoggingMessageNotificationSchema,
      async (args) => {
        return server.notification(args);
      },
    );
  }

  if (serverCapabilities?.prompts) {
    server.setRequestHandler(GetPromptRequestSchema, async (args) => {
      return client.getPrompt(args.params);
    });

    server.setRequestHandler(ListPromptsRequestSchema, async (args) => {
      return client.listPrompts(args.params);
    });
  }

  if (serverCapabilities?.resources) {
    server.setRequestHandler(ListResourcesRequestSchema, async (args) => {
      return client.listResources(args.params);
    });

    server.setRequestHandler(
      ListResourceTemplatesRequestSchema,
      async (args) => {
        return client.listResourceTemplates(args.params);
      },
    );

    server.setRequestHandler(ReadResourceRequestSchema, async (args) => {
      return client.readResource(args.params);
    });

    if (serverCapabilities?.resources.subscribe) {
      server.setNotificationHandler(
        ResourceUpdatedNotificationSchema,
        async (args) => {
          return client.notification(args);
        },
      );

      server.setRequestHandler(SubscribeRequestSchema, async (args) => {
        return client.subscribeResource(args.params);
      });

      server.setRequestHandler(UnsubscribeRequestSchema, async (args) => {
        return client.unsubscribeResource(args.params);
      });
    }
  }

  if (serverCapabilities?.tools) {
    server.setRequestHandler(CallToolRequestSchema, async (args) => {
      return client.callTool(args.params);
    });

    server.setRequestHandler(ListToolsRequestSchema, async (args) => {
      return client.listTools(args.params);
    });
  }

  server.setRequestHandler(CompleteRequestSchema, async (args) => {
    return client.complete(args.params);
  });
};
