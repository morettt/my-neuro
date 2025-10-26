import { startStdioServer } from "./startStdioServer.js";

await startStdioServer(JSON.parse(process.argv[2]));
