import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";
import type { ConfigSchema } from "@/lib/configPresentation";

export function useConfigQuery(enabled = true) {
  return useQuery({
    queryKey: queryKeys.config.root,
    queryFn: () => api.getConfig(),
    enabled,
    staleTime: 60_000,
  });
}

export function useConfigSchemaQuery(enabled = true) {
  return useQuery({
    queryKey: queryKeys.config.schema,
    queryFn: async () => {
      const schema = await api.getSchema();
      return schema.fields as ConfigSchema;
    },
    enabled,
    staleTime: 120_000,
  });
}
