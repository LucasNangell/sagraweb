import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  addAdminIp,
  deleteAccessRequest,
  deleteAdminIp,
  fetchAccessRequests,
  fetchAdminIpGroups,
  fetchAdminIpList,
  updateAdminIp,
  type AddAdminIpOptions,
} from "@/api/admin-ips";
import { queryKeys } from "@/api/query-keys";
import type {
  IpPermissionPayload,
  IpPermissionUpdatePayload,
} from "@/features/admin-ips/types";

const ACCESS_REQUESTS_POLL_MS = 10_000;

export function useAdminIpList() {
  return useQuery({
    queryKey: queryKeys.adminIps.list,
    queryFn: fetchAdminIpList,
    staleTime: 0,
    placeholderData: (previous) => previous,
  });
}

export function useAdminIpGroups() {
  return useQuery({
    queryKey: queryKeys.adminIps.groups,
    queryFn: fetchAdminIpGroups,
    staleTime: 30_000,
  });
}

export function useAccessRequests() {
  return useQuery({
    queryKey: queryKeys.adminIps.accessRequests,
    queryFn: fetchAccessRequests,
    refetchInterval: ACCESS_REQUESTS_POLL_MS,
    staleTime: 0,
    placeholderData: (previous) => previous,
  });
}

export function useAdminIpsMutations() {
  const qc = useQueryClient();

  const invalidateAll = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: queryKeys.adminIps.list }),
      qc.invalidateQueries({ queryKey: queryKeys.adminIps.groups }),
      qc.invalidateQueries({ queryKey: queryKeys.adminIps.accessRequests }),
    ]);
  };

  const addIpMutation = useMutation({
    mutationFn: ({
      payload,
      options,
    }: {
      payload: IpPermissionPayload;
      options?: AddAdminIpOptions;
    }) => addAdminIp(payload, options),
    onSuccess: () => void invalidateAll(),
  });

  const updateIpMutation = useMutation({
    mutationFn: (payload: IpPermissionUpdatePayload) => updateAdminIp(payload),
    onSuccess: () => void invalidateAll(),
  });

  const deleteIpMutation = useMutation({
    mutationFn: (id: number) => deleteAdminIp(id),
    onSuccess: () => void invalidateAll(),
  });

  const deleteRequestMutation = useMutation({
    mutationFn: (id: number) => deleteAccessRequest(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.adminIps.accessRequests });
    },
  });

  return {
    addIpMutation,
    updateIpMutation,
    deleteIpMutation,
    deleteRequestMutation,
  };
}
