import {
  McpServer,
  type ToolCallback,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpHandler } from "mcp-handler";
import type {
  ConfigWithPayment,
  ExtendedMcpServer,
  PaymentConfig,
} from "./types.js";
import { PaymentPayload, PaymentRequirements } from "x402/types";
import { processPriceToAtomicAmount } from "x402/shared";
import { exact } from "x402/schemes";
import z from "zod";
import { useFacilitator } from "x402/verify";

type ServerOptions = NonNullable<Parameters<typeof createMcpHandler>[1]>;

const network =
  process.env.NODE_ENV === "development" ? "base-sepolia" : "base";

const x402Version = 1;

function createPaidToolMethod(
  server: McpServer,
  config: PaymentConfig
): ExtendedMcpServer["paidTool"] {
  const paidTool: ExtendedMcpServer["paidTool"] = (
    name,
    description,
    options,
    paramsSchema,
    annotations,
    cb
  ) => {
    const cbWithPayment: ToolCallback<any> = async (args, extra) => {
      const { verify, settle } = useFacilitator(config.facilitator);
      const makeErrorResponse = (obj: Record<string, unknown>) => {
        return {
          isError: true,
          structuredContent: obj,
          content: [{ type: "text", text: JSON.stringify(obj) }] as const,
        } as const;
      };
      const payment = extra._meta?.["x402.payment"];

      const atomicAmountForAsset = processPriceToAtomicAmount(
        options.price,
        network
      );
      if ("error" in atomicAmountForAsset) {
        throw new Error("Failed to process price to atomic amount");
      }
      const { maxAmountRequired, asset } = atomicAmountForAsset;
      const paymentRequirements: PaymentRequirements = {
        scheme: "exact",
        network,
        maxAmountRequired,
        payTo: config.recipient,
        asset: asset.address,
        maxTimeoutSeconds: 300,
        resource: `mcp://tool/${name}`,
        mimeType: "text/event-stream",
        description,
        extra: asset.eip712,
      };

      if (!payment) {
        return makeErrorResponse({
          x402Version,
          error: "_meta.x402.payment is required",
          accepts: [paymentRequirements],
        }) as any; // I genuinely dont why this is needed
      }

      let decodedPayment: PaymentPayload;
      try {
        decodedPayment = exact.evm.decodePayment(z.string().parse(payment));
        decodedPayment.x402Version = x402Version;
      } catch (error) {
        return makeErrorResponse({
          x402Version,
          error: "Invalid payment",
          accepts: [paymentRequirements],
        }) as any; // I genuinely dont why this is needed
      }

      const verification = await verify(decodedPayment, paymentRequirements);
      if (!verification.isValid) {
        return makeErrorResponse({
          x402Version,
          error: verification.invalidReason,
          accepts: [paymentRequirements],
          payer: verification.payer,
        }) as any;
      }

      // Execute the tool
      let result: ReturnType<ToolCallback<any>>;
      let executionError = false;
      try {
        result = await cb(args, extra);
        // Check if the result indicates an error
        if (
          result &&
          typeof result === "object" &&
          "isError" in result &&
          result.isError
        ) {
          executionError = true;
        }
      } catch (error) {
        executionError = true;
        result = {
          isError: true,
          content: [{ type: "text", text: `Tool execution failed: ${error}` }],
        };
      }

      // Only settle payment if execution was successful
      if (!executionError) {
        try {
          const settlement = await settle(decodedPayment, paymentRequirements);
          // Add settlement info to result if successful
          if (settlement.success && result) {
            // Safely add settlement info to result metadata
            if (!result._meta) {
              result._meta = {};
            }
            result._meta["x402.payment-response"] = {
              success: true,
              transaction: settlement.transaction,
              network: settlement.network,
              payer: settlement.payer,
            };
          }
        } catch (settlementError) {
          // If settlement fails, we should probably not return the result
          return makeErrorResponse({
            x402Version,
            error: `Settlement failed: ${settlementError}`,
            accepts: [paymentRequirements],
          }) as any;
        }
      }

      return result;
    };
    return server.tool(
      name,
      description,
      paramsSchema,
      {
        ...annotations,
        paymentHint: true,
      },
      cbWithPayment as any // I genuinely dont why this is needed
    );
  };
  return paidTool;
}

export function createPaidMcpHandler(
  initializeServer:
    | ((server: ExtendedMcpServer) => Promise<void>)
    | ((server: ExtendedMcpServer) => void),
  serverOptions: ServerOptions,
  config: ConfigWithPayment
): (request: Request) => Promise<Response> {
  // Create the base paid handler
  const paidHandler = createMcpHandler(
    // Wrap the initialization to use ExtendedMcpServer
    async (server) => {
      const extendedServer = new Proxy(server, {
        get(target, prop, receiver) {
          if (prop === "paidTool") {
            return createPaidToolMethod(target, config);
          }
          return Reflect.get(target, prop, receiver);
        },
      }) as ExtendedMcpServer;

      await initializeServer(extendedServer);
    },
    serverOptions,
    config
  );

  return paidHandler;
}
