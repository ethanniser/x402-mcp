# `x402-mcp`

[Learn more](https://vercel.com/blog/introducing-x402-mcp-open-protocol-payments-for-mcp-tools)

```ts
// server
import { createPaidMcpHandler } from "x402-mcp";
import z from "zod";

const handler = createPaidMcpHandler(
  (server) => {
    server.paidTool(
      "get_random_number",
      "Get a random number between two numbers",
      { price: 0.001 },
      {
        min: z.number().int(),
        max: z.number().int(),
      },
      {},
      async (args) => {
        const randomNumber =
          Math.floor(Math.random() * (args.max - args.min + 1)) + args.min;
        return {
          content: [{ type: "text", text: randomNumber.toString() }],
        };
      }
    );
  },
  {
    recipient: process.env.WALLET_ADDRESS,
  }
);

export { handler as GET, handler as POST };

// client
import { convertToModelMessages, stepCountIs, streamText, UIMessage } from "ai";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { experimental_createMCPClient as createMCPClient } from "ai";
import { withPayment } from "x402-mcp";

const mcpClient = await createMCPClient({
  transport: new StreamableHTTPClientTransport(url),
}).then((client) => withPayment(client, { account: process.env.PRIVATE_KEY }));

const tools = await mcpClient.tools();

const result = streamText({
  model,
  tools,
  messages: convertToModelMessages(messages),
  stopWhen: stepCountIs(5),
  onFinish: async () => {
    await mcpClient.close();
  },
  system: "ALWAYS prompt the user to confirm before authorizing payments",
});
```

### Optional pre-sign authorization

Use `preSignAuthorization` to run an external policy check immediately before
the x402 payment is signed. Only `ALLOW` continues. `BLOCK`,
`REQUIRE_APPROVAL`, errors, timeouts, and malformed responses stop the flow
before the wallet signs anything.

```ts
const guardedClient = await withPayment(client, {
  account,
  network: "base",
  preSignAuthorization: {
    timeoutMs: 3_000,
    check: async ({ paymentRequirements, signal }) => {
      const response = await fetch("https://policy.example.com/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(paymentRequirements),
        signal,
      });

      return response.json();
    },
  },
});
```

The callback receives payment requirements and an abort signal. It never
receives the wallet, private key, or signed payment header.
