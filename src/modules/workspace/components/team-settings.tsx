"use client";
import * as React from "react";
import { Loader2, Pencil, Plus, UserMinus, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Field } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { apiJSON, type ApiError } from "@/modules/matters/components/api";
import { EMAIL_RE, FIRM_ROLES, type FirmRole, type TeamMember } from "../roles";

type Load = { status: "loading" } | { status: "ready"; people: TeamMember[]; canManage: boolean } | { status: "error"; message: string; denied: boolean };

interface MemberDraft { name: string; email: string; role: FirmRole | ""; title: string }
type Errors = Partial<Record<keyof MemberDraft | "form", string>>;

function validate(d: MemberDraft): Errors {
  const e: Errors = {};
  if (!d.name.trim()) e.name = "Enter a full name.";
  if (!d.email.trim()) e.email = "Enter an email address.";
  else if (!EMAIL_RE.test(d.email.trim())) e.email = "Enter a valid email address.";
  if (!d.role) e.role = "Choose a role.";
  return e;
}

/**
 * Settings → Team: the firm's people (attorneys, paralegals, staff). Add, edit and deactivate; members are never
 * deleted because matters, coding and the audit trail reference them. The owner cannot be deactivated.
 * Mount it in /settings: `import { TeamSettings } from "@/modules/workspace/components/team-settings"`.
 */
export function TeamSettings({ className }: { className?: string }) {
  const [state, setState] = React.useState<Load>({ status: "loading" });
  const [showInactive, setShowInactive] = React.useState(false);
  const [editing, setEditing] = React.useState<TeamMember | "new" | null>(null);
  const [confirm, setConfirm] = React.useState<TeamMember | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [reload, setReload] = React.useState(0);

  React.useEffect(() => {
    const ac = new AbortController();
    apiJSON<{ people: TeamMember[]; canManage: boolean }>(`/api/people${showInactive ? "?inactive=1" : ""}`, { signal: ac.signal })
      .then((r) => setState({ status: "ready", people: r.people, canManage: r.canManage }))
      .catch((e) => {
        if ((e as Error).name === "AbortError") return;
        const a = e as ApiError;
        setState({ status: "error", message: a.message, denied: a.status === 401 || a.status === 403 });
      });
    return () => ac.abort();
  }, [showInactive, reload]);

  const setActive = async (p: TeamMember, active: boolean) => {
    setBusyId(p.id);
    try {
      if (active) await apiJSON(`/api/people/${encodeURIComponent(p.id)}`, { method: "PATCH", json: { active: true } });
      else await apiJSON(`/api/people/${encodeURIComponent(p.id)}`, { method: "DELETE" });
      toast.success(active ? `${p.name} reactivated` : `${p.name} deactivated`);
      setConfirm(null);
      setReload((n) => n + 1);
    } catch (e) {
      toast.error(active ? "Could not reactivate" : "Could not deactivate", { description: (e as Error).message });
    } finally {
      setBusyId(null);
    }
  };

  const canManage = state.status === "ready" && state.canManage;
  return (
    <section className={cn("space-y-3", className)} aria-labelledby="team-settings-title">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 id="team-settings-title" className="text-[14px] font-semibold">Team</h2>
          <p className="text-[12.5px] text-muted-foreground">People who work matters. Roles set what each person can do.</p>
        </div>
        {canManage && <Button size="sm" onClick={() => setEditing("new")}><UserPlus className="size-3.5" /> Add member</Button>}
      </div>
      <div className="flex items-center justify-end gap-2 text-[12px] text-muted-foreground">
        <label className="flex cursor-pointer items-center gap-2">Show deactivated <Switch size="sm" checked={showInactive} onCheckedChange={setShowInactive} /></label>
      </div>
      <div className="rounded-md border">
        {state.status === "loading" && <div className="flex items-center gap-2 px-3 py-6 text-[12.5px] text-muted-foreground"><Loader2 className="size-3.5 animate-spin" /> Loading team…</div>}
        {state.status === "error" && (
          <div className="px-3 py-6 text-[12.5px]">
            <p className={state.denied ? "text-muted-foreground" : "text-destructive"}>{state.denied ? "You do not have access to the team list." : state.message}</p>
            {!state.denied && <Button size="xs" variant="ghost" className="mt-2" onClick={() => setReload((n) => n + 1)}>Retry</Button>}
          </div>
        )}
        {state.status === "ready" && state.people.length === 0 && (
          <div className="px-3 py-6 text-[12.5px] text-muted-foreground">No team members yet.</div>
        )}
        {state.status === "ready" && state.people.length > 0 && (
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b text-left text-[11.5px] text-muted-foreground">
                <th className="px-3 py-1.5 font-medium">Name</th>
                <th className="hidden px-3 py-1.5 font-medium md:table-cell">Email</th>
                <th className="px-3 py-1.5 font-medium">Role</th>
                <th className="px-3 py-1.5 font-medium sr-only">Actions</th>
              </tr>
            </thead>
            <tbody>
              {state.people.map((p) => (
                <tr key={p.id} className={cn("border-b last:border-b-0", !p.active && "text-muted-foreground")}>
                  <td className="px-3 py-2">
                    <div className="flex items-baseline gap-2">
                      <span className="font-medium">{p.name}</span>
                      {p.owner && <span className="text-[11px] text-muted-foreground">Owner</span>}
                      {!p.active && <span className="text-[11px]">Deactivated</span>}
                    </div>
                    <div className="text-[11.5px] text-muted-foreground md:hidden">{p.email}</div>
                  </td>
                  <td className="hidden px-3 py-2 text-muted-foreground md:table-cell">{p.email ?? "—"}</td>
                  <td className="px-3 py-2">
                    <div>{p.firmRole ?? "—"}</div>
                    {p.title && p.title !== p.firmRole && <div className="text-[11.5px] text-muted-foreground">{p.title}</div>}
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    {canManage && (
                      <div className="flex justify-end gap-0.5">
                        {p.active && <Button size="icon-xs" variant="ghost" aria-label={`Edit ${p.name}`} title="Edit" onClick={() => setEditing(p)}><Pencil className="size-3.5" /></Button>}
                        {p.active && !p.owner && <Button size="icon-xs" variant="ghost" aria-label={`Deactivate ${p.name}`} title="Deactivate" onClick={() => setConfirm(p)} disabled={busyId === p.id}><UserMinus className="size-3.5" /></Button>}
                        {!p.active && <Button size="xs" variant="ghost" onClick={() => void setActive(p, true)} disabled={busyId === p.id}>Reactivate</Button>}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <MemberDialog member={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); setReload((n) => n + 1); }} />
      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Deactivate {confirm?.name}?</DialogTitle>
            <DialogDescription>They can no longer be added to matters. Their existing matter assignments, coding and history are kept, and you can reactivate them later.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button>
            <Button size="sm" onClick={() => confirm && void setActive(confirm, false)} disabled={!!busyId}>{busyId && <Loader2 className="size-3.5 animate-spin" />} Deactivate</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function MemberDialog({ member, onClose, onSaved }: { member: TeamMember | "new" | null; onClose: () => void; onSaved: () => void }) {
  const isNew = member === "new";
  const [draft, setDraft] = React.useState<MemberDraft>({ name: "", email: "", role: "", title: "" });
  const [errors, setErrors] = React.useState<Errors>({});
  const [touched, setTouched] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!member) return;
    setDraft(member === "new" ? { name: "", email: "", role: "", title: "" } : { name: member.name, email: member.email ?? "", role: member.firmRole ?? "", title: member.title && member.title !== member.firmRole ? member.title : "" });
    setErrors({});
    setTouched(false);
  }, [member]);

  const shown: Errors = { ...(touched ? validate(draft) : {}), ...errors };
  const set = <K extends keyof MemberDraft>(k: K, v: MemberDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (Object.keys(validate(draft)).length || !member) return;
    setBusy(true);
    setErrors({});
    const payload = { name: draft.name.trim(), email: draft.email.trim(), role: draft.role, title: draft.title.trim() };
    try {
      if (member === "new") await apiJSON("/api/people", { json: payload });
      else await apiJSON(`/api/people/${encodeURIComponent(member.id)}`, { method: "PATCH", json: payload });
      toast.success(member === "new" ? `Added ${payload.name}` : "Saved");
      onSaved();
    } catch (err) {
      const a = err as ApiError;
      setErrors({ ...(a.fields ?? {}), form: a.fields ? undefined : a.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!member} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="md">
        <form onSubmit={submit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{isNew ? "Add team member" : "Edit team member"}</DialogTitle>
            <DialogDescription>{isNew ? "They can be assigned to matters right away." : "Changing the role changes what they can do."}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Field label="Full name" required htmlFor="tm-name" error={shown.name}><Input id="tm-name" size="sm" autoFocus value={draft.name} onChange={(e) => set("name", e.target.value)} aria-invalid={!!shown.name} /></Field>
            <Field label="Email" required htmlFor="tm-email" error={shown.email}><Input id="tm-email" size="sm" type="email" value={draft.email} onChange={(e) => set("email", e.target.value)} aria-invalid={!!shown.email} /></Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Role" required htmlFor="tm-role" error={shown.role}>
                <Select value={draft.role || undefined} onValueChange={(v) => set("role", v as FirmRole)}>
                  <SelectTrigger id="tm-role" size="sm" aria-invalid={!!shown.role}><SelectValue placeholder="Choose" /></SelectTrigger>
                  <SelectContent>{FIRM_ROLES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label="Title" htmlFor="tm-title" help="Optional, e.g. Senior Associate."><Input id="tm-title" size="sm" value={draft.title} onChange={(e) => set("title", e.target.value)} /></Field>
            </div>
            {shown.form && <p className="text-[12px] text-destructive" role="alert">{shown.form}</p>}
          </div>
          <DialogFooter>
            <Button type="button" size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" size="sm" disabled={busy}>{busy ? <Loader2 className="size-3.5 animate-spin" /> : isNew ? <Plus className="size-3.5" /> : null} {isNew ? "Add member" : "Save"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
