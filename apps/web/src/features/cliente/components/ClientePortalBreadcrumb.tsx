import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";

export interface BreadcrumbItem {
  label: string;
  to?: string;
  params?: Record<string, string>;
}

interface ClientePortalBreadcrumbProps {
  items: BreadcrumbItem[];
}

export function ClientePortalBreadcrumb({ items }: ClientePortalBreadcrumbProps) {
  return (
    <nav aria-label="Navegação" className="mb-4 text-sm text-neutral-600">
      <ol className="flex flex-wrap items-center gap-1">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <li key={`${item.label}-${index}`} className="flex items-center gap-1">
              {index > 0 ? (
                <ChevronRight className="size-3.5 text-neutral-400" aria-hidden />
              ) : null}
              {item.to && !isLast ? (
                <Link
                  to={item.to}
                  params={item.params}
                  className="font-medium text-secondary-blue hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary-blue"
                >
                  {item.label}
                </Link>
              ) : (
                <span
                  className={isLast ? "font-semibold text-neutral-800" : undefined}
                  aria-current={isLast ? "page" : undefined}
                >
                  {item.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
