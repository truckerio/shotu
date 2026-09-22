import { z } from 'zod';
export const inboundQuerySchema=z.object({locationId:z.string().uuid().optional(),view:z.enum(['my_work','expected','attention','complete']).default('my_work'),q:z.string().trim().max(160).optional(),page:z.coerce.number().int().positive().max(100000).default(1)}).strict();
export const inboundIdSchema=z.string().uuid();
