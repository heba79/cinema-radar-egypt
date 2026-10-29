import { ExternalLink } from "lucide-react";
import { IntegrationBadge } from "@/components/status";
import { Badge, Card, SectionTitle } from "@/components/ui";
import { providerCoverage } from "@/lib/queries";
import { formatCairo } from "@/lib/time";

export const dynamic = "force-dynamic";
export const metadata = { title: "Provider coverage" };

function health(p: { integration_status: string; last_success_at: string | null; consecutive_failures: number; covered_by: string | null }) {
  if (p.covered_by) return { tone: "blue" as const, label: `Via ${p.covered_by}` };
  if (p.integration_status === "not_integrated") return { tone: "zinc" as const, label: "—" };
  if (p.consecutive_failures >= 3) return { tone: "red" as const, label: `Failing (${p.consecutive_failures}×)` };
  if (p.consecutive_failures > 0) return { tone: "amber" as const, label: "Degraded" };
  if (p.last_success_at && Date.now() - new Date(p.last_success_at).getTime() < 30 * 60_000) return { tone: "green" as const, label: "Healthy" };
  if (p.integration_status === "unavailable") return { tone: "red" as const, label: "Unreachable" };
  return { tone: "zinc" as const, label: "No recent check" };
}

export default async function ProvidersPage() {
  const providers = await providerCoverage();
  return (
    <div>
      <SectionTitle>Egyptian cinema coverage</SectionTitle>
      <p className="mb-6 max-w-3xl text-sm text-muted">
        We only call a movie <b>bookable</b> when a supported provider shows a real online booking action. If a provider check fails, the movie shows
        &ldquo;Provider temporarily unavailable&rdquo; — never &ldquo;no tickets&rdquo;.
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        {providers.map((p) => {
          const h = health(p);
          return (
            <Card key={p.id} className="p-5" data-provider={p.id}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-lg font-semibold">{p.name}</p>
                  <p className="text-xs uppercase tracking-wide text-zinc-500">{p.kind.replace("_", " ")}</p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <IntegrationBadge status={p.integration_status} />
                  <Badge tone={h.tone}>{h.label}</Badge>
                </div>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-zinc-300">{p.notes}</p>
              <dl className="mt-4 grid grid-cols-2 gap-2 text-xs">
                <div>
                  <dt className="text-zinc-500">Branches seen</dt>
                  <dd className="font-medium">
                    {p.branches} ({p.bookable_branches} online)
                  </dd>
                </div>
                <div>
                  <dt className="text-zinc-500">Check interval</dt>
                  <dd className="font-medium">{p.integration_status === "not_integrated" ? "—" : `${Math.round(p.poll_interval_seconds / 60)} min`}</dd>
                </div>
                <div>
                  <dt className="text-zinc-500">Last success</dt>
                  <dd className="font-medium">{p.last_success_at ? formatCairo(p.last_success_at) : "—"}</dd>
                </div>
                <div>
                  <dt className="text-zinc-500">Last failure</dt>
                  <dd className="font-medium" title={p.last_error ?? ""}>
                    {p.last_failure_at ? formatCairo(p.last_failure_at) : "—"}
                  </dd>
                </div>
              </dl>
              {p.website && (
                <a href={p.website} target="_blank" rel="noopener" className="mt-3 inline-flex items-center gap-1 text-xs text-muted hover:text-foreground">
                  {p.website.replace(/^https?:\/\//, "")} <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
