import * as z from "zod/v4";

export const placeTypeSchema = z.enum([
  "stop",
  "address",
  "place",
]);

export const searchPlaceTypeSchema = z.enum([
  "all",
  "stop",
  "address",
  "place",
]);

export const searchPlacesInputSchema = z.strictObject({
  query: z.string()
    .trim()
    .min(3)
    .max(200),

  type: searchPlaceTypeSchema.default("all"),

  limit: z.number()
    .int()
    .min(1)
    .max(10)
    .default(5),
});

export const mobilityPlaceSchema = z.strictObject({
  id: z.string().min(1).nullable(),
  name: z.string().min(1),
  type: placeTypeSchema,

  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),

  countryCode: z.string().length(2).optional(),
  postalCode: z.string().optional(),
  street: z.string().optional(),
  houseNumber: z.string().optional(),
  timezone: z.string().optional(),
  locality: z.string().optional(),
  region: z.string().optional(),

  modes: z.array(z.string()),
}).refine(
  place => place.type === "address" || place.id !== null,
  {
    path: ["id"],
    message: "Non-address results require a provider ID",
  },
);

export const searchPlacesResultSchema = z.strictObject({
  provider: z.string().min(1),
  query: z.string(),
  results: z.array(mobilityPlaceSchema).max(10),
  attribution: z.string().url(),
});

export type PlaceType =
  z.infer<typeof placeTypeSchema>;

export type SearchPlacesInput =
  z.infer<typeof searchPlacesInputSchema>;

export type MobilityPlace =
  z.infer<typeof mobilityPlaceSchema>;

export type SearchPlacesResult =
  z.infer<typeof searchPlacesResultSchema>;

export interface MobilityProvider {
  readonly name: string;

  searchPlaces(
    input: SearchPlacesInput,
  ): Promise<SearchPlacesResult>;
}
