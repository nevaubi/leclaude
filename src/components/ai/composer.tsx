"use client";
import * as React from "react";
import { ArrowUp, ImagePlus, Mic, MicOff, Square, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/tooltip";
import { filesToAttachments, type AgentAttachment } from "@/hooks/use-agent";

interface SpeechRecognitionLike { start(): void; stop(): void; continuous: boolean; interimResults: boolean; lang: string; onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null; onend: (() => void) | null; onerror: (() => void) | null }

export interface ComposerProps {
  placeholder?: string;
  disabled?: boolean;
  streaming?: boolean;
  onSend: (text: string, attachments: AgentAttachment[]) => void;
  onStop?: () => void;
  leading?: React.ReactNode; // chips above the textarea (scope selectors etc.)
  trailing?: React.ReactNode; // extra buttons in the action row
  autoFocus?: boolean;
  className?: string;
  value?: string;
  onValueChange?: (v: string) => void;
  minRows?: number;
}

export function Composer({ placeholder = "Ask anything…", disabled, streaming, onSend, onStop, leading, trailing, autoFocus, className, value, onValueChange, minRows = 1 }: ComposerProps) {
  const [inner, setInner] = React.useState("");
  const text = value ?? inner;
  const setText = onValueChange ?? setInner;
  const [attachments, setAttachments] = React.useState<AgentAttachment[]>([]);
  const [listening, setListening] = React.useState(false);
  const recRef = React.useRef<SpeechRecognitionLike | null>(null);
  const taRef = React.useRef<HTMLTextAreaElement>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(220, Math.max(minRows * 22 + 16, ta.scrollHeight)) + "px";
  }, [text, minRows]);

  const submit = () => {
    if (streaming) { onStop?.(); return; }
    if (!text.trim() && !attachments.length) return;
    onSend(text, attachments);
    setText("");
    setAttachments([]);
  };

  const toggleMic = () => {
    if (listening) { recRef.current?.stop(); setListening(false); return; }
    const w = window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionLike; SpeechRecognition?: new () => SpeechRecognitionLike };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) { toast.error("Voice input is not supported in this browser."); return; }
    const rec = new Ctor();
    rec.continuous = true; rec.interimResults = true; rec.lang = "en-US";
    const base = text ? text + " " : "";
    rec.onresult = (e) => {
      let finalText = "", interim = "";
      for (let i = 0; i < e.results.length; i++) { const r = e.results[i]; if (r.isFinal) finalText += r[0].transcript + " "; else interim += r[0].transcript; }
      setText((base + finalText + interim).replace(/\s+/g, " "));
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    rec.start();
    setListening(true);
  };

  const onFiles = async (files: FileList | File[]) => {
    const atts = await filesToAttachments(files);
    if (atts.length) setAttachments((a) => [...a, ...atts]);
  };

  return (
    <div
      className={cn("rounded-xl border bg-background shadow-xs focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30 transition-shadow", disabled && "opacity-60", className)}
      onDragOver={(e) => { e.preventDefault(); }}
      onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files?.length) void onFiles(e.dataTransfer.files); }}
      onPaste={(e) => { const files = Array.from(e.clipboardData.files ?? []); if (files.length) { e.preventDefault(); void onFiles(files); } }}
    >
      {leading && <div className="flex flex-wrap items-center gap-1.5 px-3 pt-2.5">{leading}</div>}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 px-3 pt-2">
          {attachments.map((a, i) => (
            <div key={i} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={a.dataUrl} alt={a.name} className="h-14 w-14 rounded-md border object-cover" />
              <button onClick={() => setAttachments((as) => as.filter((_, j) => j !== i))} className="absolute -right-1.5 -top-1.5 rounded-full border bg-background p-0.5 shadow cursor-pointer" aria-label={`Remove ${a.name}`}><X className="size-3" /></button>
            </div>
          ))}
        </div>
      )}
      <textarea
        ref={taRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        rows={minRows}
        className="block w-full resize-none bg-transparent px-3 py-2.5 text-sm outline-none placeholder:text-muted-foreground scrollbar-thin"
      />
      <div className="flex items-center gap-1 px-2 pb-2">
        <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { if (e.target.files) void onFiles(e.target.files); e.target.value = ""; }} />
        <Tip label="Attach image or screenshot (transcribed with vision)"><Button variant="ghost" size="icon-sm" onClick={() => fileRef.current?.click()} disabled={disabled} aria-label="Attach image"><ImagePlus className="size-4" /></Button></Tip>
        <Tip label={listening ? "Stop dictation" : "Dictate"}><Button variant="ghost" size="icon-sm" onClick={toggleMic} disabled={disabled} className={cn(listening && "text-destructive")} aria-label={listening ? "Stop dictation" : "Dictate"} aria-pressed={listening}>{listening ? <MicOff className="size-4" /> : <Mic className="size-4" />}</Button></Tip>
        {trailing}
        <div className="flex-1" />
        <Button size="icon-sm" onClick={submit} disabled={disabled || (!streaming && !text.trim() && !attachments.length)} className="rounded-lg" aria-label={streaming ? "Stop" : "Send"}>
          {streaming ? <Square className="size-3.5 fill-current" /> : <ArrowUp className="size-4" />}
        </Button>
      </div>
    </div>
  );
}
