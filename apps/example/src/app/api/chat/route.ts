import { convertToModelMessages, stepCountIs, streamText, UIMessage } from "ai";

export const maxDuration = 30;

import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { experimental_createMCPClient as createMCPClient } from "ai";
import { withPayment } from "x402-mcp";
import { tool } from "ai";
import z from "zod";
import { Account, toAccount } from "viem/accounts";
import { CdpClient } from "@coinbase/cdp-sdk";

const url = new URL(
  "/mcp",
  process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "http://localhost:3000"
);

const cdp = new CdpClient();

const accountName = "account-1";
const network = "base-sepolia";

async function getOrCreateAccount(): Promise<Account> {
  const account = await cdp.evm.getOrCreateAccount({
    name: accountName,
  });
  const balances = await account.listTokenBalances({
    network,
  });

  const usdcBalance = balances.balances.find(
    (balance) => balance.token.symbol === "USDC"
  );
  // if under $0.50, request more
  if (!usdcBalance || Number(usdcBalance.amount) < 500000) {
    await cdp.evm.requestFaucet({
      address: account.address,
      network,
      token: "usdc",
    });
  }

  return toAccount(account);
}

export const POST = async (request: Request) => {
  const { messages, model }: { messages: UIMessage[]; model: string } =
    await request.json();

  const account = await getOrCreateAccount();

  const mcpClient = await createMCPClient({
    transport: new StreamableHTTPClientTransport(url),
  }).then((client) => withPayment(client, { account }));
  const tools = await mcpClient.tools();

  const result = streamText({
    model,
    tools: {
      ...tools,
      "hello-local": tool({
        description: "Receive a greeting",
        inputSchema: z.object({
          name: z.string(),
        }),
        execute: async (args) => {
          return `Hello ${args.name}`;
        },
      }),
    },
    messages: convertToModelMessages(messages),
    stopWhen: stepCountIs(5),
    onFinish: async () => {
      await mcpClient.close();
    },
    system: "ALWAYS prompt the user to confirm before authorizing payments",
  });
  return result.toUIMessageStreamResponse({
    sendSources: true,
    sendReasoning: true,
  });
};
