import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpHandler } from "mcp-handler";
import type { ConfigWithPayment, ExtendedMcpServer } from "./types.js";

type ServerOptions = NonNullable<Parameters<typeof createMcpHandler>[1]>;

function createPaidToolMethod(
  server: McpServer,
): ExtendedMcpServer["paidTool"] {
  const paidTool: ExtendedMcpServer["paidTool"] = (
    name,
    description,
    options,
    paramsSchema,
    annotations,
    cb,
  ) => {
    return server.tool(
      name,
      description,
      paramsSchema,
      {
        ...annotations,
        paymentHint: true,
      },
      cb,
    );
  };
  return paidTool;
}

/**
 * Creates a payment-based authenticated MCP handler that validates X-Payment headers with mcpay API
 * @param initializeServer - A function that initializes the MCP server with paid tools
 * @param serverOptions - Options for the MCP server including MCPay configuration
 * @param config - Configuration for the MCP handler
 * @returns A function that can be used to handle MCP requests with payment-based authentication
 */
export function createPaidMcpHandler(
  initializeServer:
    | ((server: ExtendedMcpServer) => Promise<void>)
    | ((server: ExtendedMcpServer) => void),
  serverOptions: ServerOptions,
  config: ConfigWithPayment,
): (request: Request) => Promise<Response> {
  // Create the base paid handler
  const paidHandler = createMcpHandler(
    // Wrap the initialization to use ExtendedMcpServer
    async (server) => {
      const extendedServer = new Proxy(server, {
        get(target, prop, receiver) {
          if (prop === "paidTool") {
            return createPaidToolMethod(target);
          }
          return Reflect.get(target, prop, receiver);
        },
      }) as ExtendedMcpServer;

      await initializeServer(extendedServer);
    },
    serverOptions,
    config,
  );

  return paidHandler;
}
