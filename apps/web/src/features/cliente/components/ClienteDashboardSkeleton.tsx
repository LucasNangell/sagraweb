export function ClienteDashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="overflow-hidden rounded-2xl border border-sagra-border bg-white shadow-sm">
        <div className="border-b border-sagra-border/70 bg-slate-50 px-4 py-5 sm:px-6">
          <div className="h-7 w-48 rounded bg-gradient-to-r from-neutral-200 via-neutral-100 to-neutral-200 bg-[length:200%_100%] motion-safe:animate-[shimmer_1.8s_linear_infinite]" />
          <div className="mt-2 h-4 w-72 max-w-full rounded bg-gradient-to-r from-neutral-100 via-neutral-50 to-neutral-100 bg-[length:200%_100%] motion-safe:animate-[shimmer_1.8s_linear_infinite]" />
        </div>
        <div className="grid gap-5 p-4 sm:p-6 lg:grid-cols-2">
          <div className="space-y-3">
            <div className="h-5 w-40 rounded bg-gradient-to-r from-neutral-200 via-neutral-100 to-neutral-200 bg-[length:200%_100%] motion-safe:animate-[shimmer_1.8s_linear_infinite]" />
            <div className="h-4 w-full rounded bg-gradient-to-r from-neutral-100 via-neutral-50 to-neutral-100 bg-[length:200%_100%] motion-safe:animate-[shimmer_1.8s_linear_infinite]" />
            <div className="h-4 w-3/4 rounded bg-gradient-to-r from-neutral-100 via-neutral-50 to-neutral-100 bg-[length:200%_100%] motion-safe:animate-[shimmer_1.8s_linear_infinite]" />
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="h-[88px] rounded-xl border border-sagra-border bg-gradient-to-r from-neutral-100 via-neutral-50 to-neutral-100 bg-[length:200%_100%] motion-safe:animate-[shimmer_1.8s_linear_infinite]"
              />
            ))}
          </div>
        </div>
      </div>

      {[1, 2, 3].map((section) => (
        <div
          key={section}
          className="rounded-2xl border border-sagra-border bg-white p-4 shadow-sm sm:p-5"
        >
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-xl bg-gradient-to-r from-neutral-200 via-neutral-100 to-neutral-200 bg-[length:200%_100%] motion-safe:animate-[shimmer_1.8s_linear_infinite]" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-36 rounded bg-gradient-to-r from-neutral-200 via-neutral-100 to-neutral-200 bg-[length:200%_100%] motion-safe:animate-[shimmer_1.8s_linear_infinite]" />
              <div className="h-3 w-56 rounded bg-gradient-to-r from-neutral-100 via-neutral-50 to-neutral-100 bg-[length:200%_100%] motion-safe:animate-[shimmer_1.8s_linear_infinite]" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
