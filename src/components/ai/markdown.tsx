"use client";
import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

/** Markdown renderer tuned for legal prose: tight spacing, readable tables, footnote-style links. */
export function Markdown({ children, className, compact }: { children: string; className?: string; compact?: boolean }) {
  return (
    <div className={cn("prose-legal text-sm leading-relaxed [&>*:first-child]:mt-0 [&>*:last-child]:mb-0", compact ? "space-y-1.5" : "space-y-2.5", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h1 className="text-base font-semibold mt-3">{children}</h1>,
          h2: ({ children }) => <h2 className="text-[15px] font-semibold mt-3">{children}</h2>,
          h3: ({ children }) => <h3 className="text-sm font-semibold mt-2">{children}</h3>,
          h4: ({ children }) => <h4 className="text-sm font-medium mt-2">{children}</h4>,
          p: ({ children }) => <p className="my-1.5">{children}</p>,
          ul: ({ children }) => <ul className="my-1.5 list-disc pl-5 space-y-0.5">{children}</ul>,
          ol: ({ children }) => <ol className="my-1.5 list-decimal pl-5 space-y-0.5">{children}</ol>,
          li: ({ children }) => <li className="[&>p]:my-0">{children}</li>,
          blockquote: ({ children }) => <blockquote className="my-2 border-l-2 border-primary/40 pl-3 text-muted-foreground italic">{children}</blockquote>,
          a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2 decoration-primary/40 hover:decoration-primary break-words">{children}</a>,
          code: ({ className, children, ...props }) => {
            const inline = !/language-/.test(className ?? "") && !String(children).includes("\n");
            return inline ? <code className="rounded bg-muted px-1 py-0.5 font-mono text-[12px]" {...props}>{children}</code> : <code className={cn("font-mono text-[12px]", className)} {...props}>{children}</code>;
          },
          pre: ({ children }) => <pre className="my-2 overflow-x-auto rounded-md border bg-muted/60 p-3 text-[12px] scrollbar-thin">{children}</pre>,
          table: ({ children }) => <div className="my-2 overflow-x-auto rounded-md border"><table className="w-full text-xs">{children}</table></div>,
          thead: ({ children }) => <thead className="bg-muted/60">{children}</thead>,
          th: ({ children }) => <th className="px-2 py-1.5 text-left font-medium border-b">{children}</th>,
          td: ({ children }) => <td className="px-2 py-1.5 border-b align-top">{children}</td>,
          hr: () => <hr className="my-3" />,
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
