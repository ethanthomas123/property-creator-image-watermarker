import { z } from "zod";
import { processWatermark } from "./infra_client.js";

export const publishRequestSchema = z.object({
  image: z.string().min(1),
  creator: z.string().min(1),
  propertyId: z.string().min(1),
  position: z.enum(["top_left", "top_right", "bottom_left", "bottom_right", "center"]).default("bottom_right"),
  opacity: z.number().min(0).max(1).default(0.65)
});

export type MaintenanceRequest = { id: string; tenantId: string; summary: string; status: "open" | "closed" };
export type TenantDocument = { id: string; tenantId: string; kind: "lease" | "identity" | "insurance" };
export type InspectionReminder = { propertyId: string; dueOn: string; sent: boolean };

export async function publishCreatorImage(raw: unknown) {
  const input = publishRequestSchema.parse(raw);
  const result = await processWatermark({ image: input.image, text: `© ${input.creator}`, position: input.position, opacity: input.opacity });
  return { propertyId: input.propertyId, creator: input.creator, image: result?.image ?? result?.id ?? null, published: true };
}
