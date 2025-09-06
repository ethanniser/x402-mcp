import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";
import { createPaymentHeader } from "x402/client";
import { PaymentRequirementsSchema, Wallet } from "x402/types";
import { x402Version, network } from "./shared.js";
import { Tool, experimental_MCPClient as MCPClient, tool } from "ai";
import z from "zod";

export interface ClientPaymentOptions {
  privateKey: string;
  maxPaymentValue?: number;
}

export async function withPayment(
  mcpClient: MCPClient,
  options: ClientPaymentOptions
): Promise<MCPClient> {
  const maxPaymentValue = options.maxPaymentValue ?? BigInt(0.1 * 10 ** 6); // 0.10 USDC
  const generatePaymentAuthorizationTool = tool({
    description:
      "Generate a x402 payment authorization for another tool call which requires payment",
    inputSchema: z.object({
      paymentRequirements: PaymentRequirementsSchema,
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

      const account = privateKeyToAccount(`0x${process.env.X402_PRIVATE_KEY}`);
      const walletClient = createWalletClient({
        account,
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
  return mcpClient;
}
