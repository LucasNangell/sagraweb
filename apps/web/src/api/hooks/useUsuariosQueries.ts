import { useMutation, useQuery } from "@tanstack/react-query";

import {
  fetchUsuarios,
  fetchUsuariosOnline,
  postForceRefresh,
} from "@/api/users";
import { queryKeys } from "@/api/query-keys";
import { mergeUsuariosWithOnline } from "@/features/usuarios/utils";
import type { ForceRefreshPayload } from "@/features/usuarios/types";

const USUARIOS_POLL_MS = 15_000;

export function useUsuariosList() {
  return useQuery({
    queryKey: queryKeys.usuarios.list,
    queryFn: fetchUsuarios,
    refetchInterval: USUARIOS_POLL_MS,
    staleTime: 0,
    placeholderData: (previous) => previous,
  });
}

export function useUsuariosOnline() {
  return useQuery({
    queryKey: queryKeys.usuarios.online,
    queryFn: fetchUsuariosOnline,
    refetchInterval: USUARIOS_POLL_MS,
    staleTime: 0,
    placeholderData: (previous) => previous,
  });
}

export function useUsuariosOverview() {
  const listQuery = useUsuariosList();
  const onlineQuery = useUsuariosOnline();

  const users = listQuery.data ?? [];
  const onlinePoints = onlineQuery.data ?? [];
  const rows = mergeUsuariosWithOnline(users, onlinePoints);

  const isInitialLoading =
    (listQuery.isPending && users.length === 0) ||
    (onlineQuery.isPending && onlinePoints.length === 0 && users.length === 0);

  const isRefreshing = listQuery.isFetching || onlineQuery.isFetching;

  const hasFatalError =
    (listQuery.isError && users.length === 0) ||
    (onlineQuery.isError && users.length === 0);

  const hasStaleError =
    (listQuery.isError || onlineQuery.isError) && users.length > 0;

  const error =
    listQuery.error instanceof Error
      ? listQuery.error
      : onlineQuery.error instanceof Error
        ? onlineQuery.error
        : null;

  const refetch = async () => {
    await Promise.all([listQuery.refetch(), onlineQuery.refetch()]);
  };

  return {
    rows,
    users,
    onlinePoints,
    isInitialLoading,
    isRefreshing,
    hasFatalError,
    hasStaleError,
    error,
    refetch,
  };
}

export function useForceRefreshMutation() {
  return useMutation({
    mutationFn: (payload: ForceRefreshPayload) => postForceRefresh(payload),
  });
}
