/**
 * Forked from https://github.com/modelcontextprotocol/typescript-sdk/blob/66e1508162d37c0b83b0637ebcd7f07946e3d210/src/client/stdio.ts#L90
 */

import {
  ReadBuffer,
  serializeMessage,
} from "@modelcontextprotocol/sdk/shared/stdio.js";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { ChildProcess, IOType, spawn } from "node:child_process";
import { Stream } from "node:stream";

export type StdioServerParameters = {
  /**
   * Command line arguments to pass to the executable.
   */
  args?: string[];

  /**
   * The executable to run to start the server.
   */
  command: string;

  /**
   * The working directory to use when spawning the process.
   *
   * If not specified, the current working directory will be inherited.
   */
  cwd?: string;

  /**
   * The environment to use when spawning the process.
   *
   * If not specified, the result of getDefaultEnvironment() will be used.
   */
  env: Record<string, string>;

  /**
   * A function to call when an event occurs.
   */
  onEvent?: (event: TransportEvent) => void;

  /**
   * How to handle stderr of the child process. This matches the semantics of Node's `child_process.spawn`.
   *
   * The default is "inherit", meaning messages to stderr will be printed to the parent process's stderr.
   */
  stderr?: IOType | number | Stream;
};

type TransportEvent =
  | {
      chunk: string;
      type: "data";
    }
  | {
      error: Error;
      type: "error";
    }
  | {
      message: JSONRPCMessage;
      type: "message";
    }
  | {
      type: "close";
    };

/**
 * Client transport for stdio: this will connect to a server by spawning a process and communicating with it over stdin/stdout.
 *
 * This transport is only available in Node.js environments.
 */
export class StdioClientTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  /**
   * The stderr stream of the child process, if `StdioServerParameters.stderr` was set to "pipe" or "overlapped".
   *
   * This is only available after the process has been started.
   */
  get stderr(): null | Stream {
    return this.process?.stderr ?? null;
  }
  private abortController: AbortController = new AbortController();

  private onEvent?: (event: TransportEvent) => void;
  private process?: ChildProcess;
  private readBuffer: ReadBuffer = new ReadBuffer();

  private serverParams: StdioServerParameters;

  constructor(server: StdioServerParameters) {
    this.serverParams = server;
    this.onEvent = server.onEvent;
  }

  async close(): Promise<void> {
    this.onEvent?.({
      type: "close",
    });

    this.abortController.abort();
    this.process = undefined;
    this.readBuffer.clear();
  }

  send(message: JSONRPCMessage): Promise<void> {
    return new Promise((resolve) => {
      if (!this.process?.stdin) {
        throw new Error("Not connected");
      }

      const json = serializeMessage(message);
      if (this.process.stdin.write(json)) {
        resolve();
      } else {
        this.process.stdin.once("drain", resolve);
      }
    });
  }

  /**
   * Starts the server process and prepares to communicate with it.
   */
  async start(): Promise<void> {
    if (this.process) {
      throw new Error(
        "StdioClientTransport already started! If using Client class, note that connect() calls start() automatically.",
      );
    }

    return new Promise((resolve, reject) => {
      this.process = spawn(
        this.serverParams.command,
        this.serverParams.args ?? [],
        {
          cwd: this.serverParams.cwd,
          env: this.serverParams.env,
          shell: false,
          signal: this.abortController.signal,
          stdio: ["pipe", "pipe", this.serverParams.stderr ?? "inherit"],
        },
      );

      this.process.on("error", (error) => {
        if (error.name === "AbortError") {
          // Expected when close() is called.
          this.onclose?.();
          return;
        }

        reject(error);
        this.onerror?.(error);
      });

      this.process.on("spawn", () => {
        resolve();
      });

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      this.process.on("close", (_code) => {
        this.onEvent?.({
          type: "close",
        });

        this.process = undefined;
        this.onclose?.();
      });

      this.process.stdin?.on("error", (error) => {
        this.onEvent?.({
          error,
          type: "error",
        });

        this.onerror?.(error);
      });

      this.process.stdout?.on("data", (chunk) => {
        this.onEvent?.({
          chunk: chunk.toString(),
          type: "data",
        });

        this.readBuffer.append(chunk);
        this.processReadBuffer();
      });

      this.process.stdout?.on("error", (error) => {
        this.onEvent?.({
          error,
          type: "error",
        });

        this.onerror?.(error);
      });
    });
  }

  private processReadBuffer() {
    while (true) {
      try {
        const message = this.readBuffer.readMessage();

        if (message === null) {
          break;
        }

        this.onEvent?.({
          message,
          type: "message",
        });

        this.onmessage?.(message);
      } catch (error) {
        this.onEvent?.({
          error: error as Error,
          type: "error",
        });

        this.onerror?.(error as Error);
      }
    }
  }
}
