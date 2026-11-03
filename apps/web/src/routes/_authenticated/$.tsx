import { createFileRoute, redirect } from "@tanstack/react-router";
import { Construction } from "lucide-react";

import { normalizeAppRedirect } from "@/lib/normalizeRedirect";

export const Route = createFileRoute("/_authenticated/$")({
  beforeLoad: ({ params }) => {
    const raw = `/${params._splat ?? ""}`;
    const normalized = normalizeAppRedirect(raw);
    if (normalized && normalized !== raw) {
      throw redirect({ to: normalized, replace: true });
    }
  },
  component: ModulePlaceholderPage,
});

function ModulePlaceholderPage() {
  const { _splat } = Route.useParams();

  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-sagra-border bg-white py-16">
      <Construction className="size-12 text-primary-green" />
      <h2 className="text-lg font-semibold text-secondary-blue">
        Módulo em migração
      </h2>
      <p className="max-w-md text-center text-sm text-neutral-600">
        A rota <code className="rounded bg-sagra-bg px-1">/{_splat}</code> será
        implementada na próxima fase do plano React + TypeScript.
      </p>
    </div>
  );
}
