import { usePcpQueue } from "@/api/hooks/usePcpQueue";

import { PcpColumn } from "./PcpColumn";

interface PcpColumnWrapperProps {
  setor: string;
  filters: Record<string, string[]>;
  nowMs: number;
  onRefresh: () => void;
}

export function PcpColumnWrapper({
  setor,
  filters,
  nowMs,
  onRefresh,
}: PcpColumnWrapperProps) {
  const query = usePcpQueue(setor);

  return (
    <PcpColumn
      setor={setor}
      items={query.data?.items ?? []}
      filters={filters}
      nowMs={nowMs}
      isLoading={query.isFetching}
      onRefresh={onRefresh}
    />
  );
}
