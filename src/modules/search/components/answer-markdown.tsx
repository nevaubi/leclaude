"use client";
import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import { Tip } from "@/components/ui/tooltip";
import { formatBluebook } from "../normalize";
import { useResearchActions } from "./research-context";

/**
 * Answer renderer: "[n]" markers become citation chips bound to the run's
 * sources; hovering a chip (or a source in the panels/map) highlights every
 * sentence that relies on it. "[VERIFY]" markers render as amber flags.
 */
export function AnswerMarkdown({ text, className, streaming }: { text: string; className?: string; streaming?: boolean }) {
  const prepared = React.useMemo(() => prepare(text), [text]);
  return (
    <div className={cn("prose-legal font-serif text-[15px] leading-[1.7] text-foreground [&>*:first-child]:mt-0 [&>*:last-child]:mb-0", streaming && "answer-streaming", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h2 className="mt-5 mb-1.5 font-sans text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">{children}</h2>,
          h2: ({ children }) => <h2 className="mt-5 mb-1.5 font-sans text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">{children}</h2>,
          h3: ({ children }) => <h3 className="mt-3 mb-1 font-sans text-[13px] font-semibold text-foreground">{children}</h3>,
          h4: ({ children }) => <h4 className="mt-2 font-sans text-[13px] font-medium">{children}</h4>,
          p: ({ children }) => <p className="my-2"><Sentences>{children}</Sentences></p>,
          ul: ({ children }) => <ul className="my-2 list-disc pl-5 space-y-1">{children}</ul>,
          ol: ({ children }) => <ol className="my-2 list-decimal pl-5 space-y-1">{children}</ol>,
          li: ({ children }) => <li className="[&>p]:my-0"><Sentences>{children}</Sentences></li>,
          blockquote: ({ children }) => <blockquote className="my-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 font-sans text-[12.5px] not-italic text-foreground [&_p]:my-0">{children}</blockquote>,
          a: ({ href, children }) => {
            if (href?.startsWith("#cite-")) return <CiteChip n={Number(href.slice(6))} />;
            if (href === "#verify") return <VerifyFlag />;
            return <a href={href} target="_blank" rel="noreferrer" className="font-sans text-[13px] text-primary underline underline-offset-2 decoration-primary/40 hover:decoration-primary break-words">{children}</a>;
          },
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
          code: ({ children }) => <code className="rounded bg-muted px-1 py-0.5 font-mono text-[12px]">{children}</code>,
          table: ({ children }) => <div className="my-2 overflow-x-auto rounded-md border font-sans"><table className="w-full text-xs">{children}</table></div>,
          thead: ({ children }) => <thead className="bg-muted/60">{children}</thead>,
          th: ({ children }) => <th className="px-2 py-1.5 text-left font-medium border-b">{children}</th>,
          td: ({ children }) => <td className="px-2 py-1.5 border-b align-top">{children}</td>,
          hr: () => <hr className="my-3" />,
        }}
      >
        {prepared}
      </ReactMarkdown>
    </div>
  );
}

/** Turn "[3]" into a link the renderer can intercept; "[VERIFY]" likewise. Skips fenced code. */
export function prepare(text: string): string {
  return text
    .replace(/\[VERIFY\]/g, "[VERIFY](#verify)")
    .replace(/\[(\d{1,2})\](?!\()/g, (_m, n: string) => `[${n}](#cite-${n})`)
    // "[1][2]" → keep both; "[1], [2]" already fine.
    .replace(/\]\(#cite-(\d+)\)\[(\d{1,2})\](?!\()/g, "](#cite-$1)[$2](#cite-$2)");
}

function CiteChip({ n }: { n: number }) {
  const a = useResearchActions();
  const s = a.sourceByN(n);
  const active = a.hoverN === n;
  const label = s ? formatBluebook(s.hit) : `Source ${n}`;
  const chip = (
    <button
      type="button"
      data-cite={n}
      onMouseEnter={() => a.setHoverN(n)}
      onMouseLeave={() => a.setHoverN(null)}
      onFocus={() => a.setHoverN(n)}
      onBlur={() => a.setHoverN(null)}
      onClick={(e) => { e.preventDefault(); if (s) a.openSource(s); }}
      className={cn(
        "mx-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded px-1 align-[2px] font-sans text-[10.5px] font-semibold tabular transition-colors cursor-pointer",
        s ? (active ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary hover:bg-primary/20") : "bg-muted text-muted-foreground",
        s && !s.read && "ring-1 ring-inset ring-warning/60",
      )}
      aria-label={label}
    >
      {n}
    </button>
  );
  return <Tip label={<span className="block max-w-xs">{label}{s && !s.read && <span className="block opacity-80">Cited from a search excerpt (not read)</span>}</span>}>{chip}</Tip>;
}

function VerifyFlag() {
  return <Tip label="Not confirmed against a source read in this run. Verify before relying on it."><span className="mx-0.5 inline-flex h-[18px] items-center rounded border border-warning/50 bg-warning/15 px-1 align-[2px] font-sans text-[10px] font-semibold tracking-wide text-warning-foreground dark:text-warning cursor-help">VERIFY</span></Tip>;
}

/**
 * Group a paragraph's children into sentences so a hovered citation lights up
 * exactly the sentence(s) that rely on it. Text nodes are split at sentence
 * boundaries; inline elements travel with the sentence they appear in.
 */
function Sentences({ children }: { children: React.ReactNode }) {
  const a = useResearchActions();
  const groups = React.useMemo(() => groupSentences(React.Children.toArray(children)), [children]);
  if (a.hoverN == null || groups.length <= 1 && !groups[0]?.cites.size) return <>{children}</>;
  return (
    <>
      {groups.map((g, i) => (
        <span key={i} className={cn("rounded-sm transition-colors", g.cites.has(a.hoverN!) && "bg-primary/10 box-decoration-clone px-0.5 -mx-0.5")}>{g.nodes}</span>
      ))}
    </>
  );
}

interface Group { nodes: React.ReactNode[]; cites: Set<number> }

const BOUNDARY = /(?<=[.!?][”")\]]?)\s+(?=[A-Z“"(\[])/;

export function groupSentences(nodes: React.ReactNode[]): Group[] {
  const out: Group[] = [];
  let cur: Group = { nodes: [], cites: new Set() };
  const flush = () => { if (cur.nodes.length) out.push(cur); cur = { nodes: [], cites: new Set() }; };
  let key = 0;
  for (const node of nodes) {
    if (typeof node === "string") {
      const parts = node.split(BOUNDARY);
      parts.forEach((part, i) => {
        if (i > 0) { cur.nodes.push(" "); flush(); }
        if (part) cur.nodes.push(<React.Fragment key={key++}>{part}</React.Fragment>);
      });
      continue;
    }
    if (React.isValidElement(node)) {
      const props = node.props as { href?: string; children?: React.ReactNode };
      const m = typeof props.href === "string" ? props.href.match(/^#cite-(\d+)$/) : null;
      if (m) cur.cites.add(Number(m[1]));
      cur.nodes.push(React.cloneElement(node, { key: key++ }));
      continue;
    }
    cur.nodes.push(<React.Fragment key={key++}>{node}</React.Fragment>);
  }
  flush();
  return out;
}
