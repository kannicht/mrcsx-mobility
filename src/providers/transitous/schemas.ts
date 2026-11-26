import * as z from "zod/v4";

export const transitousAreaSchema = z.object({
  name: z.string().min(1),
  adminLevel: z.number(),
  matched: z.boolean().optional(),
  unique: z.boolean().optional(),
  default: z.boolean().optional(),
});

export const transitousPlaceSchema = z.object({
  id: z.string().default(""),
  name: z.string().min(1),

  type: z.enum([
    "STOP",
    "ADDRESS",
    "PLACE",
  ]),

  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),

  country: z.string().length(2).optional(),
  zip: z.string().optional(),
  street: z.string().optional(),
  houseNumber: z.string().optional(),
  tz: z.string().optional(),

  areas: z.array(transitousAreaSchema).default([]),
  modes: z.array(z.string()).default([]),
}).refine(
  place => place.type === "ADDRESS" || place.id.trim().length > 0,
  {
    path: ["id"],
    message: "Non-address results require a provider ID",
  },
);

export const transitousGeocodeResponseSchema =
  z.array(transitousPlaceSchema);

export type TransitousArea =
  z.infer<typeof transitousAreaSchema>;

export type TransitousPlace =
  z.infer<typeof transitousPlaceSchema>;
