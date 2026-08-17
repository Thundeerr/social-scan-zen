import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { listProviderServicesFn } from "@/lib/monitor.functions";

export type ProviderService = {
  service: string;
  name: string;
  category: string;
  rate: string;
  min: number;
  max: number;
};

type ServicePickerProps = {
  onSelect: (service: ProviderService) => void;
  selectedService?: string | null;
  autoLoad?: boolean;
};

export function ServicePicker({ onSelect, selectedService, autoLoad = false }: ServicePickerProps) {
  const listServices = useServerFn(listProviderServicesFn);
  const [search, setSearch] = useState("");

  const servicesQuery = useQuery({
    queryKey: ["provider-services", search],
    queryFn: () => listServices({ data: { search } }),
    enabled: autoLoad,
  });

  const results = servicesQuery.data;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-8 pl-8 text-xs"
            placeholder="Search services (e.g. followers)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") servicesQuery.refetch();
            }}
          />
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => servicesQuery.refetch()}
          disabled={servicesQuery.isFetching}
        >
          {servicesQuery.isFetching ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          Load
        </Button>
      </div>

      {results && !results.ok && (
        <p className="text-xs text-destructive">{results.error}</p>
      )}

      {results?.ok && (
        <ul className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-border/60 bg-muted/20 p-2">
          {results.services.length === 0 ? (
            <li className="px-2 py-1.5 text-xs text-muted-foreground">No matching services.</li>
          ) : (
            results.services.map((s) => {
              const active = selectedService === s.service;
              return (
                <li key={s.service}>
                  <button
                    type="button"
                    className={`
                      w-full rounded-md px-2 py-1.5 text-left text-xs transition-colors
                      ${active ? "bg-primary/10 text-primary" : "hover:bg-muted"}
                    `}
                    onClick={() => {
                      onSelect(s);
                      toast.success(`Service ${s.service} selected`);
                    }}
                  >
                    <span className="font-mono text-muted-foreground">#{s.service}</span>{" "}
                    {s.name}
                    <span className="block text-[11px] text-muted-foreground">
                      {s.category} · rate {s.rate}/1000 · min {s.min} · max {s.max}
                    </span>
                  </button>
                </li>
              );
            })
          )}
        </ul>
      )}

      {!results && !servicesQuery.isFetching && (
        <p className="text-[11px] text-muted-foreground">
          Read-only catalogue lookup — never places an order.
        </p>
      )}
    </div>
  );
}
