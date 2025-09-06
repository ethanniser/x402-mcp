import {
  McpServer,
  type RegisteredTool,
  type ToolCallback,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { type ZodRawShape } from "zod";
import type { createMcpHandler } from "mcp-handler";
import type { Address } from "viem";
import { FacilitatorConfig } from "x402/types";

type Config = NonNullable<Parameters<typeof createMcpHandler>[2]>;

export interface PaymentOptions {
  price: number; // in USD
}

export interface ConfigWithPayment extends Config {
  recipient: Address;
  facilitator: FacilitatorConfig;
}

export interface ExtendedServerMethods {
  paidTool<Args extends ZodRawShape>(
    name: string,
    description: string,
    options: PaymentOptions,
    paramsSchema: Args,
    annotations: ToolAnnotations,
    cb: ToolCallback<Args>,
  ): RegisteredTool;
}

export type ExtendedMcpServer = McpServer & ExtendedServerMethods;
