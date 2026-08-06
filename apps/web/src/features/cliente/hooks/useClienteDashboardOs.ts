import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { fetchClienteDashboard, type ClienteOsItem } from "@/api/cliente-portal";

import {
  findOsInDashboard,
  parsePortalLinkFromUrl,
  type ParsedPortalLink,
} from "../utils/pendenciaBridge";

export function useClienteDashboardOs(ano: number, nrOs: number) {
  const dashboardQuery = useQuery({
    queryKey: ["cliente", "dashboard"],
    queryFn: fetchClienteDashboard,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });

  const item: ClienteOsItem | null = useMemo(() => {
    if (!dashboardQuery.data) return null;
    return findOsInDashboard(dashboardQuery.data, ano, nrOs);
  }, [dashboardQuery.data, ano, nrOs]);

  const portalLink: ParsedPortalLink | null = useMemo(() => {
    if (!item?.pendencia_url) return null;
    const parsed = parsePortalLinkFromUrl(item.pendencia_url);
    if (!parsed) return null;
    if (parsed.os !== nrOs || parsed.ano !== ano) return null;
    return parsed;
  }, [item?.pendencia_url, ano, nrOs]);

  return {
    dashboardQuery,
    item,
    portalLink,
    data: dashboardQuery.data,
  };
}
