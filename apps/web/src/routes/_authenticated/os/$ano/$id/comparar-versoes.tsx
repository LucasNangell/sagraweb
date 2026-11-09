import { createFileRoute } from "@tanstack/react-router";

import { AuthGuard } from "@/components/auth/AuthGuard";
import { OsPdfComparePage } from "@/features/os-pdf-compare/OsPdfComparePage";
import { searchParamAsString } from "@/lib/search-params";

type CompararVersoesSearch = {
  previous?: string;
  current?: string;
  auto?: boolean;
};

export const Route = createFileRoute(
  "/_authenticated/os/$ano/$id/comparar-versoes",
)({
  validateSearch: (search: Record<string, unknown>): CompararVersoesSearch => {
    const autoRaw = search.auto;
    const auto =
      autoRaw === true ||
      autoRaw === 1 ||
      autoRaw === "1" ||
      autoRaw === "true";
    return {
      previous: searchParamAsString(search.previous) || undefined,
      current: searchParamAsString(search.current) || undefined,
      auto: auto || undefined,
    };
  },
  component: CompararVersoesRoute,
});

function CompararVersoesRoute() {
  const { ano, id } = Route.useParams();
  const search = Route.useSearch();
  const anoNum = Number.parseInt(ano, 10);
  const idNum = Number.parseInt(id, 10);

  return (
    <AuthGuard requiredPermission="ctx_comparar_versoes">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <OsPdfComparePage
          ano={anoNum}
          osId={idNum}
          initialPreviousRelative={search.previous ?? null}
          initialCurrentRelative={search.current ?? null}
          autoStart={Boolean(search.auto && search.previous && search.current)}
        />
      </div>
    </AuthGuard>
  );
}
