import { createPaidMcpHandler } from "@vercel/x402";
import { z } from "zod";

const handler = createPaidMcpHandler(
  (server) => {
    server.paidTool(
      "roll_dice",
      {
        price: 0.01,
      },
      {
        sides: z.number().int().min(2),
      },
      {},
      async ({ sides }) => {
        const value = 1 + Math.floor(Math.random() * sides);
        return {
          content: [
            {
              type: "text",
              text: `You rolled a ${value}!`,
            },
          ],
        };
      }
    );
  },
  {},
  {
    verboseLogs: true,
    recipient: "0x0000000000000000000000000000000000000000",
    facilitator: {
      url: "https://x402.org/facilitator",
    },
  }
);
export { handler as GET, handler as POST };
