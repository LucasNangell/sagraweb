import { useQuery } from "@tanstack/react-query";

import { fetchProvaWebCropMeta } from "@/api/provaWeb";

import type { ProvaWebCropSource } from "./provaWebCropSource";

export function useProvaWebCropMeta(
  ano: number,
  osId: number,
  relativePath: string | null,
  opts?: {
    detectMarks?: boolean;
    enabled?: boolean;
    cropSource?: ProvaWebCropSource;
  },
) {
  const detectMarks = Boolean(opts?.detectMarks);
  const cropSource = opts?.cropSource;
  const keyPrefix = cropSource?.keyPrefix ?? "prova-web-crop-meta";

  return useQuery({
    queryKey: [keyPrefix, ano, osId, relativePath, detectMarks],
    queryFn: () => {
      if (cropSource) {
        return cropSource.fetchMeta(relativePath!, { detectMarks });
      }
      return fetchProvaWebCropMeta(ano, osId, relativePath!, {
        detectMarks,
      });
    },
    enabled: Boolean(relativePath) && (opts?.enabled ?? true),
    staleTime: 60_000,
    retry: 1,
  });
}
