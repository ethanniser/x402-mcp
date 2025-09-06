import { convertToModelMessages, stepCountIs, streamText, UIMessage } from "ai";

export const maxDuration = 30;

import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { experimental_createMCPClient as createMCPClient } from "ai";

const url = new URL(
  "/mcp",
  process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "http://localhost:3000"
);

export const POST = async (request: Request) => {
  const {
    messages,
    model,
    paymentEnabled,
  }: { messages: UIMessage[]; model: string; paymentEnabled: boolean } =
    await request.json();

  const mcpClient = await createMCPClient({
    transport: new StreamableHTTPClientTransport(url),
  });
  const tools = await mcpClient.tools();

  const result = streamText({
    model,
    tools,
    messages: convertToModelMessages(messages),
    stopWhen: stepCountIs(5),
    onFinish: async () => {
      await mcpClient.close();
    },
  });
  return result.toUIMessageStreamResponse({
    sendSources: true,
    sendReasoning: true,
  });
};
