import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Radar } from "lucide-react";
import { PageTopbar } from "@/components/shell/page-topbar";
import { currentUser } from "@/lib/current-user";
import { db } from "@/lib/db";
import { intelAnalysisBootstrap } from "@/modules/intel/analysis/bootstrap";
import { entityProfile } from "@/modules/intel/analysis/profiles";
import { ENTITY_TYPES, ENTITY_TYPE_LABEL, entityHref } from "@/modules/intel/analysis/pure";
import { EntityProfileView } from "@/modules/intel/components/entity-profile";
import { intelEntities } from "@/modules/intel/store";
import type { IntelEntityType } from "@/modules/intel/types";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ type: string; id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const e = intelEntities().get(decodeURIComponent(id));
  return { title: e ? `${e.name} · Intelligence` : "Intelligence" };
}

/**
 * Entity profile: attributes, monthly activity, motion tendencies where the
 * record states outcomes, related entities from the graph, an evidence-linked
 * timeline, the records themselves, insights and the watch toggle.
 */
export default async function EntityPage({ params }: Props) {
  intelAnalysisBootstrap();
  const { type, id } = await params;
  if (type === "documents") notFound();
  const me = currentUser();
  const profile = entityProfile(decodeURIComponent(id), { userId: me.id });
  if (!profile) notFound();
  if (profile.entity.type !== type && ENTITY_TYPES.includes(type as IntelEntityType)) redirect(entityHref(profile.entity));
  if (profile.entity.type !== type) notFound();
  const matterNames = Object.fromEntries(db().matters.all().map((m) => [m.id, m.shortName]));
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageTopbar icon={<Radar />} title="Intelligence" context={`${ENTITY_TYPE_LABEL[profile.entity.type]} · ${profile.entity.name}`} />
      <EntityProfileView profile={profile} userId={me.id} matterNames={matterNames} />
    </div>
  );
}
