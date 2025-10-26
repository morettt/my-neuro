import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

type TransportEvent =
  | {
      error: Error;
      type: "onerror";
    }
  | {
      message: JSONRPCMessage;
      type: "onmessage";
    }
  | {
      message: JSONRPCMessage;
      type: "send";
    }
  | {
      type: "close";
    }
  | {
      type: "onclose";
    }
  | {
      type: "start";
    };

export const tapTransport = (
  transport: Transport,
  eventHandler: (event: TransportEvent) => void,
): Transport => {
  const originalClose = transport.close.bind(transport);
  const originalOnClose = transport.onclose?.bind(transport);
  const originalOnError = transport.onerror?.bind(transport);
  const originalOnMessage = transport.onmessage?.bind(transport);
  const originalSend = transport.send.bind(transport);
  const originalStart = transport.start.bind(transport);

  transport.close = async () => {
    eventHandler({
      type: "close",
    });

    return originalClose?.();
  };

  transport.onclose = async () => {
    eventHandler({
      type: "onclose",
    });

    return originalOnClose?.();
  };

  transport.onerror = async (error: Error) => {
    eventHandler({
      error,
      type: "onerror",
    });

    return originalOnError?.(error);
  };

  transport.onmessage = async (message: JSONRPCMessage) => {
    eventHandler({
      message,
      type: "onmessage",
    });

    return originalOnMessage?.(message);
  };

  transport.send = async (message: JSONRPCMessage) => {
    eventHandler({
      message,
      type: "send",
    });

    return originalSend?.(message);
  };

  transport.start = async () => {
    eventHandler({
      type: "start",
    });

    return originalStart?.();
  };

  return transport;
};
