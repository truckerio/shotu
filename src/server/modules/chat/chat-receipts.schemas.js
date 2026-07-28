import { z } from "zod";

export const acknowledgeChatReceiptsSchema = z.object({
  throughMessageId: z.uuid(),
  status: z.enum(["delivered", "read"]),
}).strict();
