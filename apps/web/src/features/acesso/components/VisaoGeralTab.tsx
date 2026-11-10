import { ManutencaoClients } from "./ManutencaoClients";

export function VisaoGeralTab() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain p-1 pb-4 md:p-2">
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-slate-800">Como o acesso é resolvido</h2>
        <ol className="mt-2 space-y-1.5 text-sm text-slate-700">
          <li>
            <strong>Terminal MASTER / servidor</strong> — acesso total.
          </li>
          <li>
            <strong>Internet (login com senha)</strong> — só as permissões do usuário; sem
            permissões próprias, nada é liberado.
          </li>
          <li>
            <strong>Rede local</strong> — permissões do terminal (IP); se o usuário tiver
            permissões próprias, elas substituem as do terminal.
          </li>
        </ol>
      </section>
      <ManutencaoClients />
    </div>
  );
}
