import type { McpServer } from "@modelcontextprotocol/server";
import { ProviderError } from "../providers/errors.ts";

import {
  searchPlacesInputSchema,
  searchPlacesResultSchema,
} from "../providers/types.ts";

import type {
  MobilityProvider,
  SearchPlacesInput,
} from "../providers/types.ts";

export const searchPlacesTool = {
  name: "mobility_search_places",

  title: "Search public transport stops and places",

  description: [
    "Search for public transport stops, railway stations,",
    "addresses and geographic places using Transitous.",
    "Include the city or locality in the search query",
    "to improve result relevance.",
    "Use type 'stop' when searching for a public transport",
    "stop or railway station.",
    "Results include provider-specific identifiers,",
    "coordinates and available transport modes.",
    "Preserve non-null identifiers exactly as returned.",
    "Addresses may have a null identifier.",
    "Use their coordinates to reference geographic positions.",
    "Never invent provider-specific identifiers.",
    "This tool does not return departures, routes,",
    "timetables or real-time journey information.",
    "Search queries are sent to an external data provider.",
    "Do not include unnecessary personal information.",
    "When presenting results to users, include visible attribution:",
    "Data: Transitous (https://transitous.org/sources/),",
    "© OpenStreetMap contributors",
    "(https://www.openstreetmap.org/copyright).",
  ].join(" "),

  inputSchema: searchPlacesInputSchema,

  outputSchema: searchPlacesResultSchema,

  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
} as const;

export function createSearchPlacesHandler(
  provider: MobilityProvider,
) {
  return async (input: SearchPlacesInput) => {
    try {
      const result =
        searchPlacesResultSchema.parse(
          await provider.searchPlaces(input),
        );

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result),
          },
        ],

        structuredContent: result,
      };
    } catch (error) {
      const details =
        error instanceof ProviderError
          ? {
              code: error.code,
              message: error.message,
              retryable: error.retryable,
            }
          : {
              code: "INTERNAL_ERROR",
              message: "Mobility search failed",
              retryable: false,
            };

      return {
        isError: true,

        content: [
          {
            type: "text" as const,
            text: JSON.stringify(details),
          },
        ],
      };
    }
  };
}

export function registerSearchPlaces(
  server: McpServer,
  provider: MobilityProvider,
): void {
  const { name, ...definition } = searchPlacesTool;

  server.registerTool(
    name,
    definition,
    createSearchPlacesHandler(provider),
  );
}
