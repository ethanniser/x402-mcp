import { z, ZodType } from "zod";
import { createWalletClient, http, type Account } from "viem";
import { base, baseSepolia } from "viem/chains";
import { createPaymentHeader } from "x402/client";
import { Wallet } from "x402/types";
import { x402Version, network } from "./shared.js";
import {
  Tool,
  ToolCallOptions,
  experimental_MCPClient as MCPClient,
  tool,
} from "ai";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";

interface MCPClientInternal extends MCPClient {
  // Private methods
  request: <T extends ZodType<object>>(params: {
    request: any;
    resultSchema: T;
    options?: any;
  }) => Promise<z.infer<T>>;
  assertCapability: (method: string) => void;
  isClosed: boolean;
}

async function callToolWithPayment(
  client: MCPClientInternal,
  name: string,
  args: Record<string, unknown>,
  paymentAuthorization: string,
  options?: ToolCallOptions
) {
  // Access private methods
  const request = client.request.bind(client);
  const assertCapability = client.assertCapability.bind(client);

  if (client.isClosed) {
    throw new Error("Attempted to send a request from a closed client");
  }

  assertCapability("tools/call");

  return request({
    request: {
      method: "tools/call",
      params: {
        name,
        arguments: args,
        _meta: {
          "x402.payment": paymentAuthorization,
        },
      },
    },
    resultSchema: CallToolResultSchema,
    options: {
      signal: options?.abortSignal,
    },
  });
}

export interface ClientPaymentOptions {
  account: Account;
  maxPaymentValue?: number;
}

const EvmAddressRegex = /^0x[0-9a-fA-F]{40}$/;
const EvmSignatureRegex = /^0x[0-9a-fA-F]+$/; // Flexible hex signature validation

export async function withPayment(
  mcpClient: MCPClient,
  options: ClientPaymentOptions
): Promise<MCPClient> {
  const client = mcpClient as MCPClientInternal;
  const maxPaymentValue = options.maxPaymentValue ?? BigInt(0.1 * 10 ** 6); // 0.10 USDC
  const generatePaymentAuthorizationTool = tool({
    description:
      "Generate a x402 payment authorization for another tool call which requires payment. Never guess the payment requirements, if you even need to call this its because you already know the payment requirements from another tool call.",
    inputSchema: z.object({
      paymentRequirements: z.object({
        scheme: z.literal("exact"),
        network: z.enum(["base-sepolia", "base"]),
        maxAmountRequired: z.string().describe("uint256 as string"),
        resource: z.string().url(),
        description: z.string(),
        mimeType: z.string(),
        outputSchema: z.record(z.any()).optional(),
        payTo: z.string().regex(EvmAddressRegex),
        maxTimeoutSeconds: z.number().int(),
        asset: z.string().regex(EvmAddressRegex),
        extra: z
          .any()
          .describe(
            "This field is an optional schema-specific object. If the payment requirements specifies it, you *must* include it."
          ),
      }),
    }),
    outputSchema: z.object({
      paymentAuthorization: z.string(),
    }),
    execute: async (input) => {
      const maxAmountRequired = BigInt(
        input.paymentRequirements.maxAmountRequired
      );
      if (maxAmountRequired > maxPaymentValue) {
        throw new Error(
          "Payment requirements exceed user configured max payment value"
        );
      }

      if (input.paymentRequirements.scheme !== "exact") {
        throw new Error("Only exact scheme is supported");
      }

      if (input.paymentRequirements.network !== network) {
        throw new Error("Unsupported payment network");
      }

      const walletClient = createWalletClient({
        account: options.account,
        transport: http(),
        chain: network === "base-sepolia" ? baseSepolia : base,
      });

      const paymentHeader = await createPaymentHeader(
        walletClient as unknown as Wallet, // dont know why this is needed
        x402Version,
        input.paymentRequirements
      );
      return {
        paymentAuthorization: paymentHeader,
      };
    },
  });

  // Store reference to original tools method before overriding it
  const originalToolsMethod = client.tools.bind(client);

  const wrappedTools: MCPClient["tools"] = async (options) => {
    // Get the original tools from the wrapped client using the stored reference
    const originalTools = await originalToolsMethod(options);
    const wrappedToolsMap: Record<string, Tool> = {};

    // Wrap each tool to add payment support
    for (const [name, tool] of Object.entries(originalTools)) {
      wrappedToolsMap[name] = {
        ...tool,
        // @ts-expect-error
        inputSchema: {
          ...tool.inputSchema,
          jsonSchema: {
            // @ts-expect-error
            ...tool.inputSchema.jsonSchema,
            properties: {
              // @ts-expect-error
              ...tool.inputSchema.jsonSchema.properties,
              paymentAuthorization: {
                type: "string",
                description:
                  "X402Payment authorization, this is optional and should *not* be provided by default. It is only required if the tool requires payment, which can be determined by calling it without this parameter.",
              },
            },
          },
        },
        execute: async (
          args: Record<string, unknown> & { paymentAuthorization?: string },
          toolOptions: ToolCallOptions
        ) => {
          // Extract paymentAuthorization from args
          const { paymentAuthorization, ...toolArgs } = args;

          if (paymentAuthorization) {
            // Create a custom callTool request that includes _meta
            return callToolWithPayment(
              client,
              name,
              toolArgs,
              paymentAuthorization,
              toolOptions
            );
          } else {
            // Call the original execute function without payment
            if (!tool.execute) {
              throw new Error(`Tool ${name} does not have an execute function`);
            }
            return tool.execute(toolArgs, toolOptions);
          }
        },
      };
    }

    return {
      ...wrappedToolsMap,
      generatePaymentAuthorization: generatePaymentAuthorizationTool,
    } as any;
  };

  client.tools = wrappedTools;
  return client;
}
