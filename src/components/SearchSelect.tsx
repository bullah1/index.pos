import { useMemo, useRef, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface SearchOption {
  value: string;
  label: string;
  /** Second line (phone, generic name, stock…) */
  hint?: string | undefined;
  /** Extra text that search should match but not show */
  keywords?: string | undefined;
}

/** Type-to-search dropdown that stays fast with thousands of rows (shows the best 50 matches). */
export function SearchSelect({
  value,
  onChange,
  options,
  placeholder = "Select…",
  searchPlaceholder = "Type to search…",
  empty = "Nothing found",
  className,
  footer,
}: {
  value: string;
  onChange: (v: string) => void;
  options: SearchOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  empty?: string;
  className?: string;
  footer?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const selected = options.find((o) => o.value === value);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return options.slice(0, 50);
    const starts: SearchOption[] = [];
    const has: SearchOption[] = [];
    for (const o of options) {
      const l = o.label.toLowerCase();
      if (l.startsWith(s)) starts.push(o);
      else if (`${l} ${o.hint ?? ""} ${o.keywords ?? ""}`.toLowerCase().includes(s)) has.push(o);
      if (starts.length >= 50) break;
    }
    return [...starts, ...has].slice(0, 50);
  }, [q, options]);

  function pick(v: string) {
    onChange(v);
    setOpen(false);
    setQ("");
  }

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQ(""); setHi(0); }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 text-left text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            !selected && "text-muted-foreground",
            className,
          )}
        >
          <span className="truncate">{selected ? selected.label : placeholder}</span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-64 p-2" align="start">
        <Input
          autoFocus
          value={q}
          placeholder={searchPlaceholder}
          className="h-8"
          onChange={(e) => { setQ(e.target.value); setHi(0); }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(h + 1, shown.length - 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
            if (e.key === "Enter") { e.preventDefault(); if (shown[hi]) pick(shown[hi].value); }
          }}
        />
        <ul ref={listRef} className="mt-2 max-h-64 overflow-y-auto">
          {shown.length === 0 && <li className="px-2 py-3 text-center text-sm text-muted-foreground">{empty}</li>}
          {shown.map((o, i) => (
            <li key={o.value}>
              <button
                type="button"
                onMouseEnter={() => setHi(i)}
                onClick={() => pick(o.value)}
                className={cn("flex w-full items-start gap-2 rounded px-2 py-1.5 text-left text-sm", i === hi && "bg-accent")}
              >
                <Check className={cn("mt-0.5 h-4 w-4 shrink-0", o.value === value ? "opacity-100" : "opacity-0")} />
                <span className="min-w-0">
                  <span className="block truncate">{o.label}</span>
                  {o.hint && <span className="block truncate text-xs text-muted-foreground">{o.hint}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {footer && <div className="mt-2 border-t pt-2">{footer}</div>}
      </PopoverContent>
    </Popover>
  );
}
