/**
 * The two demo matters. Posture follows the public record at the level of categories of allegations (a consumer
 * class action alleging monopolization of smartphone and app-distribution markets; the related government action
 * tracked for coordination). Parties' internal facts, the case number, the presiding judge and opposing counsel are
 * fictional and marked as demonstration data.
 */
import type { MatterRecord } from "@/modules/matters/types";
import { DEMO_MATTERS, DEMO_TEAM } from "../ids";
import { dayOffset, type DemoBuildContext } from "./context";
import { DEMO_JUDGE_NAME } from "./people";

export type DemoMatter = MatterRecord & { meta?: Record<string, unknown> };

export const DEMO_CONSUMER_NUMBER = "DEMO-APL-001";
export const DEMO_DOJ_NUMBER = "DEMO-APL-002";
export const DEMO_CASE_NUMBER = "5:24-cv-0DEMO";

export function buildDemoMatters(ctx: DemoBuildContext): DemoMatter[] {
  const at = ctx.now.toISOString();
  const rel = (days: number) => dayOffset(ctx.now, days);
  const meta = { demo: "apple-antitrust", synthetic: true };
  return [
    {
      id: DEMO_MATTERS.consumer,
      slug: "demo-apple-smartphone-consumer-class",
      number: DEMO_CONSUMER_NUMBER,
      name: "In re Apple Smartphone Antitrust Litigation (Consumer Class) — Demo",
      shortName: "Apple Antitrust — Consumer Class",
      caption: `Case No. ${DEMO_CASE_NUMBER} (N.D. Cal.) · demonstration data`,
      client: "Putative class of U.S. iPhone purchasers (named plaintiffs fictional)",
      clientSide: "plaintiff",
      practiceArea: "Litigation",
      court: "U.S. District Court for the Northern District of California",
      jurisdiction: "Federal · 9th Cir.",
      judge: `${DEMO_JUDGE_NAME} (fictional)`,
      status: "active",
      stage: "Fact discovery",
      openedAt: "2024-04-02",
      teamIds: [ctx.ownerId, DEMO_TEAM.associate, DEMO_TEAM.paralegal],
      leadAttorneyId: ctx.ownerId,
      description:
        "Consumer class action on behalf of U.S. iPhone purchasers alleging that the defendant monopolized smartphone and app-distribution markets in violation of Sherman Act § 2 through App Store distribution and anti-steering rules, restrictions on super apps and cloud game streaming, limits on third-party messaging, smartwatch interoperability and tap-to-pay wallet access. Plaintiffs seek overcharge damages on App Store purchases and injunctive relief. Everything beyond the public-record posture (documents, emails, testimony, figures, the case number and the presiding judge) is synthetic demonstration data.",
      keyDates: [
        { label: "Rule 26(f) conference", date: "2024-07-18" },
        { label: "Order on motion to dismiss (in part denied)", date: "2025-06-30" },
        { label: "Substantial completion of document production", date: rel(24) },
        { label: "Plaintiffs' class certification motion and expert reports", date: rel(52) },
        { label: "Close of fact discovery", date: rel(95) },
        { label: "Defendant's opposition to class certification", date: rel(110) },
        { label: "Class certification hearing", date: rel(150) },
      ],
      tags: ["demo", "antitrust", "Sherman Act § 2", "class action"],
      createdAt: at,
      updatedAt: at,
      createdById: ctx.ownerId,
      meta,
    },
    {
      id: DEMO_MATTERS.doj,
      slug: "demo-united-states-v-apple-tracked",
      number: DEMO_DOJ_NUMBER,
      name: "United States v. Apple Inc. (tracked for coordination) — Demo",
      shortName: "U.S. v. Apple (tracked)",
      caption: "No. 2:24-cv-04055 (D.N.J.) · tracked matter, not a firm engagement",
      client: "Tracking only — coordination for the consumer class",
      clientSide: "other",
      practiceArea: "Regulatory",
      court: "U.S. District Court for the District of New Jersey",
      jurisdiction: "Federal · 3d Cir.",
      status: "active",
      stage: "Discovery (monitored)",
      openedAt: "2024-03-21",
      teamIds: [ctx.ownerId, DEMO_TEAM.associate],
      leadAttorneyId: ctx.ownerId,
      description:
        "Government monopolization action (filed March 2024 with state co-plaintiffs) addressing overlapping conduct. The firm is not counsel; the matter is tracked to coordinate discovery, avoid duplicative depositions and follow public rulings. Notes and tasks here are synthetic demonstration data; no statements are attributed to any participant.",
      keyDates: [
        { label: "Complaint filed (public record)", date: "2024-03-21" },
        { label: "Next joint status report (tracked)", date: rel(18) },
        { label: "Coordination call with consumer-class co-counsel", date: rel(8) },
      ],
      tags: ["demo", "tracked", "government action"],
      createdAt: at,
      updatedAt: at,
      createdById: ctx.ownerId,
      meta,
    },
  ];
}
