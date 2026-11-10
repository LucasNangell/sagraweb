import { ClienteCadastroForm } from "./ClienteCadastroForm";
import { useFeedback } from "./Feedback";

export function ClientesPortalTab() {
  const feedback = useFeedback();
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain p-1 pb-4 md:p-2">
      <ClienteCadastroForm onSuccess={feedback.success} onError={feedback.error} />
    </div>
  );
}
