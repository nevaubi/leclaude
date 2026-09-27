import { DEMO_ID as D, type DocSpec } from "./doc-spec";
import { coded } from "./docs-key-a";
import { REVIEWER as R } from "./people";

/**
 * Hand-authored key documents, block B: cloud gaming, messaging, smartwatch interoperability, NFC & Wallet,
 * market definition and damages. FICTIONAL: invented for the demonstration and authored by fictional people.
 */

const T_STREAM = "demo_apl_thr_streamforge";
const T_ANDROID = "demo_apl_thr_msg_client";
const T_RCS = "demo_apl_thr_rcs_2022";
const T_WATCH = "demo_apl_thr_watch_actions";
const T_PULSE = "demo_apl_thr_pulsewear";
const T_TANDEM = "demo_apl_thr_tandem_nfc";
const T_TIER = "demo_apl_thr_price_tiers";

export const KEY_DOCS_B: DocSpec[] = [
  // ---------------------------------------------------------------- Cloud gaming
  {
    id: D("g01"), date: "2019-11-18", time: "18:05", cust: "lee", type: "Email", subject: "Streamforge — catalog streaming app submission", from: "Marcus Lee",
    to: ["Lena Marsh"], cc: ["Jae Park"], thread: T_STREAM,
    aiScore: 78, aiIssues: ["CGM-01"], coding: coded(true, ["CGM-01"], "2026-08-19T09:00:00Z"),
    body: `Lena,

Streamforge submitted their catalog app today: one app, ~250 streamed games, subscription through In-App Purchase. App Review is holding it under the guideline that each game be reviewed individually.

Jonah (their partnerships lead) says per-title submission is not workable because the catalog changes weekly and the games run on their servers, not on the device. They are asking for a meeting. Can we align on a position before I respond?

Marcus`,
  },
  {
    id: D("g02"), date: "2019-11-19", cust: "lee", type: "Memo", subject: "Game streaming: per-title review vs. catalog apps", pages: 3, from: "Marcus Lee",
    to: ["Lena Marsh", "Graham Whitaker"], thread: T_STREAM,
    aiScore: 94, aiIssues: ["CGM-01", "MKT-01", "ASC-01"], aiSummary: "Options memo on game streaming; notes that per-title review would make catalog streaming impractical and that several internal stakeholders see that as a benefit because streamed games reduce the importance of the device and the store.",
    coding: coded(true, ["CGM-01", "MKT-01", "ASC-01"], "2026-08-19T09:20:00Z", { hot: true }),
    tags: ["key-doc", "exhibit-candidate"],
    body: `GAME STREAMING — OPTIONS
Marcus Lee, Games & Streaming BD · 19 November 2019

1. What streaming changes. Streamed games run on the provider's servers. A player with a mid-range phone of any brand gets the same game. The value of the device's hardware, and of the store as the place games are bought, both go down.

2. Options.
A. Catalog app allowed, subscription via In-App Purchase. Simple; commission on the subscription only; no per-game review.
B. Per-title review: each streamed game submitted as its own app, with a store listing and review. Catalog app may exist only as a launcher linking to those listings.
C. Browser-only: no native app; providers use web apps.
\f3. Assessment. Option B is operationally unworkable for providers whose catalog changes weekly. Several people here see that as a feature, not a bug: it keeps streaming as a web experience while games that are sold through the store remain native.

4. Risk. Option B will be read by developers and regulators as designed to keep catalog streaming off the platform. The safety rationale (content review) is real but thin for games already rated elsewhere.
\f5. Recommendation. I recommend A with content-rating requirements. If the decision is B, we should expect escalations from all three major streaming providers within a year.`,
  },
  {
    id: D("g03"), date: "2020-01-09", cust: "lee", type: "Other", subject: "Invitation: Streaming policy review (Lee / Marsh / Whitaker)", from: "Marcus Lee",
    to: ["Lena Marsh", "Graham Whitaker"],
    aiScore: 52, aiIssues: ["CGM-01"], coding: coded(true, ["CGM-01"], "2026-08-19T09:30:00Z", {}, R.paralegal),
    tags: ["calendar-invite"],
    body: `CALENDAR INVITATION
Title: Streaming policy review
When: Thursday, January 16, 2020 · 2:00 PM – 3:00 PM (Pacific)
Where: Conference room 4-West / video bridge
Organizer: Marcus Lee
Required: Lena Marsh, Graham Whitaker
Agenda: (1) Options A/B/C from the November memo; (2) Streamforge meeting request; (3) timing of guideline update.`,
  },
  {
    id: D("g04"), date: "2020-09-11", time: "10:30", cust: "lee", type: "Email", subject: "Updated guidelines — streaming games", from: "Marcus Lee",
    to: ["Jonah Petrakis"], thread: T_STREAM,
    aiScore: 73, aiIssues: ["CGM-01"], body: `Jonah,

Following up on our call. The updated guidelines published today permit game-streaming services, with each streamed game offered as a separate app that goes through review and has its own store listing. A catalog app may help users find and launch those games.

I understand this is not the single-app model Streamforge proposed. Happy to talk through the submission process with your team.

Marcus`,
  },
  {
    id: D("g05"), date: "2020-09-14", cust: "lee", type: "Chat", subject: "#games-bd — streaming reaction", from: "Marcus Lee",
    aiScore: 88, aiIssues: ["CGM-01", "MKT-01"], aiSummary: "BD chat after the streaming guideline update; a colleague notes providers will stay on the web and 'that was the idea'.",
    coding: coded(true, ["CGM-01", "MKT-01"], "2026-08-19T09:45:00Z", { hot: true }),
    body: `[#games-bd · 14 Sep 2020]
11:02 Marcus Lee: Streamforge: "per-title is a non-starter". they're going browser-only
11:03 Graham Whitaker: expected
11:05 Marcus Lee: two others said the same off the record
11:06 Graham Whitaker: web is fine. streamed games in a browser don't change why people buy the phone
11:07 Marcus Lee: that was the idea I guess
11:07 Graham Whitaker: that was the idea`,
  },

  // ---------------------------------------------------------------- Messaging
  {
    id: D("m01"), date: "2016-10-20", time: "12:10", cust: "nand", type: "Email", subject: "Messaging client for other platforms — scoping", from: "Priya Nand",
    to: ["Owen Hartley"], cc: ["Ben Calloway"], thread: T_ANDROID,
    aiScore: 80, aiIssues: ["MSG-01"], coding: coded(true, ["MSG-01"], "2026-08-20T09:00:00Z"),
    body: `Owen,

Ben and I did a first pass on what it would take to ship our messaging service as a client on the other major smartphone platform. Short answer: it is buildable. Encryption, identity and sync reuse the existing service; the client is new work.

Rough estimate: two teams, about nine months to a beta, assuming we reuse the protocol unchanged. Full estimate and open questions to follow in a memo this week.

Priya`,
  },
  {
    id: D("m02"), date: "2016-10-25", cust: "nand", type: "Memo", subject: "Messaging on other platforms: engineering estimate and strategic considerations", pages: 3, from: "Priya Nand",
    to: ["Owen Hartley"], thread: T_ANDROID,
    aiScore: 96, aiIssues: ["MSG-01", "MKT-01"], aiSummary: "Engineering memo concluding a cross-platform client is feasible in ~9 months and recording leadership's concern that it would remove a switching cost tied to group messaging.",
    entities: { people: ["Priya Nand", "Owen Hartley", "Ben Calloway"], orgs: [], places: [] },
    coding: coded(true, ["MSG-01", "MKT-01"], "2026-08-20T09:20:00Z", { hot: true }),
    tags: ["key-doc", "exhibit-candidate"],
    body: `MESSAGING ON OTHER PLATFORMS — ENGINEERING ESTIMATE AND CONSIDERATIONS
Priya Nand, Engineering Manager, Messaging · October 25, 2016

1. Feasibility. A client for the other major platform can reuse the service's identity, key exchange and sync. Estimated effort: two teams, 9 months to beta, 12 to general availability. No protocol changes required.

2. Quality today. Messages between our users and users on other platforms fall back to SMS/MMS: no encryption, no typing indicators, compressed media, unreliable group threads. These gaps are visible to users and are the main complaint in cross-platform groups.
\f3. Strategic considerations (from the October 21 review). Leadership's view is that the messaging experience is one of the strongest reasons families and friend groups stay on our phones, and that a client on the other platform would remove that reason. Owen summarised it as: "shipping this makes switching easier, and we would be paying for it."

4. Engineering view. Our job is to scope, not decide. I note that the SMS fallback quality gaps would remain for everyone who does not install a client.
\f5. Decision requested. Proceed / defer. If deferred, I recommend we at least improve fallback media quality (low effort).`,
  },
  {
    id: D("m03"), date: "2017-01-12", time: "09:40", cust: "nand", type: "Email", subject: "RE: Messaging on other platforms — decision", from: "Owen Hartley",
    to: ["Priya Nand"], cc: ["Ben Calloway"], thread: T_ANDROID,
    aiScore: 91, aiIssues: ["MSG-01", "MKT-01"], coding: coded(true, ["MSG-01", "MKT-01"], "2026-08-20T09:30:00Z", { hot: true }),
    body: `Priya,

Decision from the staff meeting: deferred indefinitely. Please move the two teams to the group-features work. No fallback quality changes this cycle either — the view was that improving the cross-platform experience undercuts the reason not to ship the client.

Thanks for the thorough scoping. Keep the memo; it may come back.

Owen`,
  },
  {
    id: D("m04"), date: "2019-06-05", cust: "nand", type: "Chat", subject: "#messaging-eng — cross-platform group quality", from: "Priya Nand",
    aiScore: 70, aiIssues: ["MSG-01"],
    body: `[#messaging-eng · 5 Jun 2019]
10:11 Ben Calloway: bug triage: 40+ reports this month about mixed-platform group threads splitting
10:12 Priya Nand: same root cause as last year — MMS group fallback
10:14 Ben Calloway: fix is ~2 sprints if we're allowed to touch it
10:15 Priya Nand: not on the roadmap. mark as known issue
10:16 Ben Calloway: users think it's the other phone's fault btw
10:18 Priya Nand: I know. known issue.`,
  },
  {
    id: D("m05"), date: "2019-06-06", cust: "nand", type: "Report", subject: "Cross-platform messaging quality — known gaps (v2)", pages: 2, from: "Priya Nand",
    aiScore: 82, aiIssues: ["MSG-01"], coding: coded(true, ["MSG-01"], "2026-08-20T10:00:00Z"),
    body: `CROSS-PLATFORM MESSAGING QUALITY — KNOWN GAPS
Messaging Engineering · 6 June 2019 · v2

Gap                                   User impact                         Effort to fix     Status
Group threads split on reply          Missed messages in mixed groups     2 sprints         Not planned
Media compression on fallback         Low-resolution photos and video     1 sprint          Not planned
No read/typing indicators             Perceived unreliability             N/A (protocol)    Not planned
No encryption on fallback             Security exposure                   N/A (protocol)    Not planned
Reactions render as text              Clutter in mixed groups             1 sprint          Not planned
\fNote: all items were raised in the 2016 scoping memo. Industry-standard rich messaging (RCS) would address items 3–5; not on the roadmap.`,
  },
  {
    id: D("m05v1"), date: "2019-06-05", cust: "nand", type: "Report", subject: "Cross-platform messaging quality — known gaps (v1)", pages: 2, from: "Priya Nand",
    aiScore: 80, aiIssues: ["MSG-01"],
    tags: ["draft"],
    body: `CROSS-PLATFORM MESSAGING QUALITY — KNOWN GAPS
Messaging Engineering · 5 June 2019 · v1 draft

Gap                                   User impact                         Effort to fix     Status
Group threads split on reply          Missed messages in mixed groups     2 sprints         Not planned
Media compression on fallback         Low-resolution photos and video     1 sprint          Not planned
No read/typing indicators             Perceived unreliability             N/A (protocol)    Not planned
No encryption on fallback             Security exposure                   N/A (protocol)    Not planned
\fNote: all items were raised in the 2016 scoping memo. Industry-standard rich messaging (RCS) would address items 3–4; not on the roadmap.`,
  },
  {
    id: D("m06"), date: "2022-09-08", time: "15:18", cust: "nand", type: "Email", subject: "RCS — revisit for next cycle?", from: "Priya Nand",
    to: ["Owen Hartley"], thread: T_RCS,
    aiScore: 78, aiIssues: ["MSG-01"], body: `Owen,

Carriers and the other platform have now standardised on RCS for rich messaging. Supporting it for cross-platform threads would fix typing indicators, media quality and group reliability without shipping a client anywhere. Estimate: one team, two releases.

Is this worth raising for next cycle?

Priya`,
  },
  {
    id: D("m07"), date: "2022-09-09", time: "08:02", cust: "nand", type: "Email", subject: "RE: RCS — revisit for next cycle?", from: "Owen Hartley",
    to: ["Priya Nand"], thread: T_RCS,
    aiScore: 93, aiIssues: ["MSG-01", "MKT-01"], aiSummary: "Hartley declines RCS for the next cycle, noting users see the messaging distinction as a feature and the company is 'not in a hurry to erase it'.",
    coding: coded(true, ["MSG-01", "MKT-01"], "2026-08-20T10:25:00Z", { hot: true }),
    tags: ["key-doc"],
    body: `Not this cycle. Our users see the difference as a feature, and we're not in a hurry to erase it. If regulators make it a requirement we'll do the minimum the standard requires.

O.`,
  },

  // ---------------------------------------------------------------- Smartwatch interoperability
  {
    id: D("w01"), date: "2017-03-14", cust: "frey", type: "Memo", subject: "Third-party watch connectivity: API access requests", pages: 3, from: "Daniel Frey",
    to: ["Beatrice Kowal"],
    aiScore: 84, aiIssues: ["SWI-01"], coding: coded(true, ["SWI-01"], "2026-08-21T09:00:00Z"),
    body: `THIRD-PARTY WATCH CONNECTIVITY — API ACCESS REQUESTS
Daniel Frey, Wearables Interoperability · 14 March 2017

1. Requests received (last 12 months): 9 accessory makers. Most common asks:
(a) reply and action buttons on notifications (today third-party watches can display notifications but not act on them);
(b) reliable background connection (today the companion app is suspended and the watch loses connection);
(c) access to message content for quick replies.
\f2. Our own watch has all three through private interfaces.

3. Technical view (pending Watch Connectivity input). (a) and (b) are engineering work, not hard limits. (c) raises genuine privacy questions that could be handled with user consent screens.

4. Battery. Our own watch maintains a persistent connection with acceptable phone battery impact; a third-party connection using the same stack would have similar impact.
\f5. Next step. Ask Kenji Morita's team for an estimate on (a) and (b).`,
  },
  {
    id: D("w02"), date: "2017-03-15", time: "11:26", cust: "frey", type: "Email", subject: "Notification actions for third-party watches — feasibility", from: "Daniel Frey",
    to: ["Kenji Morita"], thread: T_WATCH,
    aiScore: 75, aiIssues: ["SWI-01"], coding: coded(true, ["SWI-01"], "2026-08-21T09:10:00Z", {}, R.paralegal),
    body: `Kenji,

Could your team estimate what it would take to (a) expose notification actions to third-party watches and (b) keep their companion apps' Bluetooth connection alive in the background, using the same mechanisms our watch uses? No commitment — Beatrice wants to know the real constraints before we answer the accessory makers.

Daniel`,
  },
  {
    id: D("w03"), date: "2017-03-16", time: "16:48", cust: "frey", type: "Email", subject: "RE: Notification actions for third-party watches — feasibility", from: "Kenji Morita",
    to: ["Daniel Frey"], cc: ["Beatrice Kowal"], thread: T_WATCH,
    aiScore: 95, aiIssues: ["SWI-01"], aiSummary: "Watch Connectivity lead says both capabilities are feasible in about two releases and that the background limits are 'policy, not physics'.",
    coding: coded(true, ["SWI-01"], "2026-08-21T09:15:00Z", { hot: true, notes: "Contradicts Frey 23:8 (battery and privacy are the only reasons)." }),
    tags: ["key-doc", "exhibit-candidate"],
    body: `Daniel,

Both are doable. (a) is a public wrapper around the action interface our watch already uses — one release. (b) needs an entitlement so the system does not suspend the companion app's connection; the battery cost is the same as ours, which we already accept. Call it two releases for both.

To be clear for Beatrice: the background limits on third-party watches are policy, not physics. If the answer is no, it should be because we decided it, not because it can't be done.

Kenji`,
  },
  {
    id: D("w04"), date: "2018-05-22", time: "09:05", cust: "frey", type: "Email", subject: "Pulsewear — request for notification replies and background connection", from: "Ines Moreau",
    to: ["Daniel Frey"], thread: T_PULSE,
    aiScore: 72, aiIssues: ["SWI-01"], coding: coded(true, ["SWI-01"], "2026-08-21T09:30:00Z"),
    body: `Daniel,

Following our meeting, Pulsewear formally requests: (1) the ability for our watch to send quick replies to messages and act on notifications; (2) a background connection mode that is not suspended by the system. Our users tell us our watch "forgets" the phone several times a day, and they assume it is our hardware.

We would accept any consent screen or review process you require.

Ines Moreau
VP Product, Pulsewear`,
  },
  {
    id: D("w05"), date: "2018-05-29", time: "13:12", cust: "frey", type: "Email", subject: "Pulsewear request — recommendation", from: "Daniel Frey",
    to: ["Beatrice Kowal"], thread: T_PULSE,
    aiScore: 81, aiIssues: ["SWI-01"], coding: coded(true, ["SWI-01"], "2026-08-21T09:40:00Z"),
    body: `Beatrice,

My recommendation on Pulsewear: grant (1) quick replies behind a consent screen, defer (2). Kenji's estimate from last year still holds. Granting at least (1) would answer the most visible complaint and costs one release.

Daniel`,
  },
  {
    id: D("w06"), date: "2018-05-30", time: "07:58", cust: "frey", type: "Email", subject: "RE: Pulsewear request — recommendation", from: "Beatrice Kowal",
    to: ["Daniel Frey"], thread: T_PULSE,
    aiScore: 97, aiIssues: ["SWI-01", "MKT-01"], aiSummary: "Kowal declines both Pulsewear requests, explaining that the watch keeps customers on the phone and that third-party watches should remain second-class; privacy is to be the external explanation.",
    entities: { people: ["Beatrice Kowal", "Daniel Frey", "Ines Moreau"], orgs: ["Pulsewear Ltd."], places: [] },
    coding: coded(true, ["SWI-01", "MKT-01"], "2026-08-21T09:45:00Z", { hot: true, notes: "Business rationale for limits — contradicts Frey 23:8 and 61:4." }),
    tags: ["key-doc", "exhibit-candidate"],
    body: `Daniel,

No on both, for now. The watch is one of the best reasons people stay on the phone; a third-party watch that works just as well removes that reason. Keeping third-party watches a step behind supports both businesses.

When you respond to Ines, cite privacy and battery. Both are true enough.

B.`,
  },
  {
    id: D("w07e"), date: "2019-08-12", time: "18:22", cust: "frey", type: "Email", subject: "Wearables strategy deck — for Thursday", from: "Daniel Frey",
    to: ["Beatrice Kowal"], attachments: [D("w07")],
    aiScore: 72, aiIssues: ["SWI-01", "MKT-01"], aiSummary: "Frey sends Kowal the attach-and-retention strategy deck ahead of the Thursday review.",
    coding: coded(true, ["SWI-01", "MKT-01"], "2026-08-21T10:05:00Z", {}, R.paralegal),
    body: `Beatrice,

Deck for Thursday attached. Slides 2 and 5 are the new cohort numbers; slide 6 is the recommendation we discussed. I kept the Pulsewear detail to one line on slide 7.

Daniel`,
  },
  {
    id: D("w07"), date: "2019-08-12", cust: "frey", type: "Presentation", subject: "Wearables ecosystem strategy — attach and retention", pages: 8, from: "Daniel Frey", parent: D("w07e"),
    aiScore: 93, aiIssues: ["SWI-01", "MKT-01", "DMG-01"], aiSummary: "Strategy deck showing watch owners retain their phones at higher rates and presenting third-party watch limits as supporting attach.",
    coding: coded(true, ["SWI-01", "MKT-01", "DMG-01"], "2026-08-21T10:10:00Z", { hot: true, confidentiality: "highly confidential" }),
    tags: ["key-doc", "expert-reliance"],
    body: `WEARABLES ECOSYSTEM STRATEGY — ATTACH AND RETENTION
Wearables Product · August 2019 · Prepared by D. Frey for B. Kowal

Slide 1 — Summary
Watch owners are the most loyal phone customers we have.
\fSlide 2 — Retention
24-month phone retention: watch owners 94%; non-owners 83% (matched cohorts, 2016–2018).
\fSlide 3 — Attach
Watch attach among new phone buyers rising 2–3 points per year.
\fSlide 4 — Why owners stay
Survey: 41% of watch owners say they would need a new watch if they changed phones; 28% cite health history.
\fSlide 5 — Third-party watches
Third-party watches work with our phones with limited notifications and connectivity. Owners of third-party watches switch phones at rates similar to non-owners.
\fSlide 6 — Implication
Differentiated watch integration supports phone retention. Opening watch interfaces to third parties would reduce this advantage.
\fSlide 7 — Requests pending
Pulsewear and 7 others (notification actions, background connection).
\fSlide 8 — Recommendation
Maintain current third-party interface scope through FY2020; revisit if regulatory requirements change.`,
  },
  {
    id: D("w08"), date: "2020-02-18", cust: "frey", type: "Spreadsheet", subject: "Watch owner phone-retention cohort summary", pages: 2, from: "Daniel Frey",
    aiScore: 86, aiIssues: ["SWI-01", "MKT-01", "DMG-01"], coding: coded(true, ["SWI-01", "MKT-01", "DMG-01"], "2026-08-21T10:20:00Z", { hot: true, confidentiality: "highly confidential" }),
    tags: ["expert-reliance"],
    body: `WATCH OWNER PHONE-RETENTION — COHORT SUMMARY (matched on age of phone, region, plan type)
Cohort          Watch owners 24-mo retention     Non-owners     Third-party watch owners
2016            93.8%                           83.4%          84.1%
2017            94.2%                           82.9%          83.5%
2018            94.6%                           83.1%          83.0%
\fNotes: third-party watch owners identified from companion-app installs; retention = same-brand phone purchase within 24 months of prior purchase. Prepared for the FY2020 planning cycle.`,
  },

  // ---------------------------------------------------------------- NFC & Wallet
  {
    id: D("n01"), date: "2016-11-08", cust: "reyes", type: "Memo", subject: "NFC controller access for third-party payment apps", pages: 3, from: "Tomas Reyes",
    aiScore: 95, aiIssues: ["NFC-01", "MKT-01"], aiSummary: "Wallet memo: security is a real reason to limit NFC access, but issuer-fee economics depend on the wallet being the only tap-to-pay option.",
    coding: coded(true, ["NFC-01", "MKT-01"], "2026-08-22T09:00:00Z", { hot: true }),
    tags: ["key-doc", "exhibit-candidate"],
    body: `NFC CONTROLLER ACCESS — THIRD-PARTY PAYMENT APPS
Tomas Reyes, Wallet & NFC · 8 November 2016

1. Requests. Banks and payment apps want to use the phone's NFC controller for contactless payments from their own apps (host card emulation or secure-element access), as they can on the other major platform.

2. Security. The secure element and our tokenisation model are strong; opening the controller requires careful design. This is a real consideration and the one we explain externally.
\f3. Economics. Issuer fees on wallet transactions depend on the wallet being the only way to tap to pay. If banks could offer tap-to-pay in their own apps, the largest issuers would do so and would stop paying the fee.

4. Stickiness. Users with cards in the wallet and transit passes set up are less likely to switch phones; a bank's own app works on any phone.
\f5. Recommendation. Keep the controller closed to third-party payments. Offer banks deeper provisioning integration (push provisioning) instead.`,
  },
  {
    id: D("n02"), date: "2017-04-04", time: "10:15", cust: "reyes", type: "Email", subject: "Tandem Pay — contactless access request", from: "Arjun Mehta",
    to: ["Tomas Reyes"], thread: T_TANDEM,
    aiScore: 70, aiIssues: ["NFC-01"], coding: coded(true, ["NFC-01"], "2026-08-22T09:10:00Z"),
    body: `Tomas,

Tandem Pay would like to offer tap-to-pay from our own app for our 3 million cardholders, as we do on the other platform. We are prepared to meet any security certification you require, including hardware-backed key storage.

Can we schedule a technical session?

Arjun Mehta
Head of Mobile, Tandem Pay`,
  },
  {
    id: D("n03"), date: "2017-04-06", time: "17:30", cust: "reyes", type: "Email", subject: "RE: Tandem Pay — response draft", from: "Tomas Reyes",
    to: ["Alicia Ferreira"], thread: T_TANDEM,
    aiScore: 83, aiIssues: ["NFC-01"], coding: coded(true, ["NFC-01"], "2026-08-22T09:15:00Z", { hot: true }),
    body: `Alicia,

Draft reply to Tandem below. Keep it to security and the provisioning alternative; do not discuss fees or timing.

"Thank you for your interest. For security reasons contactless payments are provided through the wallet, which Tandem Pay cardholders can use today through in-app provisioning. We would be glad to help your team integrate provisioning."

They will escalate. That's fine; the answer does not change.

Tomas`,
  },
  {
    id: D("n04"), date: "2018-09-25", cust: "reyes", type: "Spreadsheet", subject: "Issuer fee revenue — FY2018 summary", pages: 2, from: "Tomas Reyes",
    aiScore: 80, aiIssues: ["NFC-01", "DMG-01"], coding: coded(true, ["NFC-01", "DMG-01"], "2026-08-22T09:30:00Z", { hot: true, confidentiality: "highly confidential" }),
    tags: ["expert-reliance"],
    body: `ISSUER FEE REVENUE — FY2018 SUMMARY (indexed, FY2016 = 100)
Region        FY2016    FY2017    FY2018
US            100       164       241
Europe        —         100       188
APAC          —         —         100
\fNotes: fee is a share of transaction value paid by card issuers on wallet transactions; top 10 issuers account for 72% of fee revenue. No issuer has tap-to-pay from its own app on our phones.`,
  },
  {
    id: D("n05"), date: "2019-10-15", cust: "reyes", type: "Chat", subject: "#wallet-partnerships — bank asks for tap-to-pay in own app", from: "Alicia Ferreira",
    aiScore: 66, aiIssues: ["NFC-01"],
    body: `[#wallet-partnerships · 15 Oct 2019]
14:01 Alicia Ferreira: regional bank #4 this quarter asking for tap-to-pay in their own app
14:02 Tomas Reyes: same answer. provisioning offer
14:03 Alicia Ferreira: they asked if the fee is negotiable if they stay in wallet
14:05 Tomas Reyes: not in writing. set up a call
14:05 Alicia Ferreira: ok`,
  },
  {
    id: D("n07"), date: "2020-04-14", cust: "reyes", type: "Other", subject: "Invitation: Wallet access review — Q2", from: "Tomas Reyes",
    to: ["Alicia Ferreira"],
    aiScore: 45, aiIssues: ["NFC-01"],
    tags: ["calendar-invite"],
    body: `CALENDAR INVITATION
Title: Wallet access review — Q2
When: Tuesday, April 21, 2020 · 10:00 AM – 11:00 AM (Pacific)
Where: Video bridge
Organizer: Tomas Reyes
Required: Alicia Ferreira
Agenda: pending access requests (5 issuers, 2 payment apps); provisioning roadmap; talking points refresh.`,
  },

  // ---------------------------------------------------------------- Market definition
  {
    id: D("x01"), date: "2017-08-30", cust: "marsh", type: "Report", subject: "Why users stay — consumer switching research (summary)", pages: 4, from: "Lena Marsh",
    aiScore: 92, aiIssues: ["MKT-01", "MSG-01", "SWI-01"], aiSummary: "Summary of internal consumer research ranking the reasons users do not switch phones: group messaging, repurchasing apps, the watch and stored cards.",
    coding: coded(true, ["MKT-01", "MSG-01", "SWI-01"], "2026-08-23T09:00:00Z", { hot: true, confidentiality: "highly confidential" }),
    tags: ["key-doc", "expert-reliance"],
    body: `WHY USERS STAY — CONSUMER SWITCHING RESEARCH (SUMMARY)
Circulated by App Store Policy for the services planning offsite · August 2017

Method. Online survey of 6,000 current smartphone owners in five countries (fielded June 2017) plus 40 in-home interviews.

Top reasons given for not switching phone platform (share citing as "major reason")
Group messaging with friends/family would not work the same       47%
Would have to repurchase apps and in-app content                  39%
Watch or other accessories would not work                          22%
Stored payment cards, passes and transit                           18%
Learning a new interface                                           31%
\fSegments. Among owners under 25, messaging was cited by 62%.
Among owners who had considered switching in the past year, apps/content (44%) and messaging (41%) were the top two barriers.
\fImplications for services (App Store Policy view)
1. Purchases that live inside our store travel with the user only within our platform; purchases made on the web travel anywhere.
2. Features that work only between our devices raise the cost of leaving.
\fSource: Consumer Insights study CI-2017-06 (full deck on request).`,
  },
  {
    id: D("x01d"), date: "2017-08-24", cust: "marsh", type: "Report", subject: "DRAFT — Why users stay — consumer switching research (summary)", pages: 4, from: "Lena Marsh",
    aiScore: 90, aiIssues: ["MKT-01", "MSG-01", "SWI-01"],
    coding: coded(true, ["MKT-01", "MSG-01", "SWI-01"], "2026-08-23T09:05:00Z", { confidentiality: "highly confidential" }),
    tags: ["draft"],
    body: `WHY USERS STAY — CONSUMER SWITCHING RESEARCH (SUMMARY) — DRAFT
Circulated by App Store Policy for the services planning offsite · August 2017

Method. Online survey of 6,000 current smartphone owners in five countries (fielded June 2017) plus 40 in-home interviews.

Top reasons given for not switching phone platform (share citing as "major reason")
Group messaging with friends/family would not work the same       47%
Would have to repurchase apps and in-app content                  39%
Watch or other accessories would not work                          22%
Stored payment cards, passes and transit                           18%
Learning a new interface                                           31%
\fSegments. Among owners under 25, messaging was cited by 62%.
Among owners who had considered switching in the past year, apps/content (44%) and messaging (41%) were the top two barriers.
\fImplications for services (App Store Policy view)
1. Purchases that live inside our store travel with the user only within our platform; purchases made on the web travel anywhere. Keeping purchases in the store is a retention strategy as well as a revenue strategy.
2. Features that work only between our devices raise the cost of leaving.
\fSource: Consumer Insights study CI-2017-06 (full deck on request).`,
  },
  {
    id: D("x02"), date: "2019-01-15", cust: "okoro", type: "Spreadsheet", subject: "Installed base and switching rates — summary", pages: 2, from: "Rachel Okoro",
    aiScore: 77, aiIssues: ["MKT-01", "DMG-01"], coding: coded(true, ["MKT-01", "DMG-01"], "2026-08-23T09:20:00Z", { hot: true, confidentiality: "highly confidential" }),
    tags: ["expert-reliance"],
    body: `INSTALLED BASE AND SWITCHING — SUMMARY (US, indexed)
Year     Active devices (2014 = 100)     Outbound switching rate     Inbound switching rate
2015     112                             6.1%                        14.8%
2016     121                             5.4%                        13.9%
2017     129                             4.9%                        12.2%
2018     136                             4.4%                        11.6%
\fNote: outbound switching has declined every year; store spend per device rose 19% CAGR over the same period.`,
  },
  {
    id: D("x03"), date: "2021-05-10", time: "14:44", cust: "lee", type: "Email", subject: "Competitive landscape — alternative stores and web distribution", from: "Marcus Lee",
    to: ["Graham Whitaker"],
    aiScore: 64, aiIssues: ["MKT-01", "CGM-01"], body: `Graham,

For the planning doc: on our phones there is no alternative store to compare against, so the relevant competition for game distribution is the web (browser games and streaming) and developers' own sites for account purchases. Neither reaches users at the point of purchase inside apps. Console and PC stores do not compete for phone users' purchases in any practical sense.

Marcus`,
  },

  // ---------------------------------------------------------------- Damages / pass-through
  {
    id: D("d01"), date: "2020-03-03", cust: "okoro", type: "Report", subject: "Commission pass-through: price-tier analysis", pages: 2, from: "Rachel Okoro",
    aiScore: 94, aiIssues: ["DMG-01", "ASC-01"], aiSummary: "Finance analysis of the 2019 price-tier change showing developers adjusted consumer prices at tier points within one to two quarters.",
    coding: coded(true, ["DMG-01", "ASC-01"], "2026-08-24T09:00:00Z", { hot: true, confidentiality: "highly confidential" }),
    tags: ["key-doc", "expert-reliance"],
    body: `COMMISSION PASS-THROUGH — PRICE-TIER ANALYSIS
App Store Payments Finance · 3 March 2020

Question. When developer proceeds change (tax or tier adjustments), do consumer prices move?

Data. Top 2,000 grossing apps; 2019 price-tier adjustments in four markets where proceeds changed without a change in the commission rate.

Findings.
1. 71% of affected apps moved their consumer price to a different tier within two quarters; median lag 5 weeks.
2. Where proceeds fell, prices rose in 64% of cases; where proceeds rose, prices fell in only 18%.
\f3. Pricing clusters at tier points; developers treat proceeds, not the consumer price, as the target.

Implication. Changes in the effective commission are likely to be reflected in consumer prices at tier points, asymmetrically.
Caveat. Top-grossing apps only; subscriptions under-represented.`,
  },
  {
    id: D("d02"), date: "2022-06-15", time: "11:05", cust: "okoro", type: "Email", subject: "Price tier update — expected consumer price effects", from: "Rachel Okoro",
    to: ["Sofia Lindqvist"], thread: T_TIER,
    aiScore: 79, aiIssues: ["DMG-01"], body: `Sofia,

For the tier update: based on the 2020 pass-through work, expect most top-grossing apps to reprice within two quarters in markets where proceeds fall. We should not describe the update as price-neutral for consumers.

Rachel`,
  },
  // ---------------------------------------------------------------- Agreements, board and planning materials
  {
    id: D("c01"), date: "2020-11-18", cust: "marsh", type: "Contract", subject: "Developer agreement — Small Business Program schedule (excerpt)", pages: 3, from: "Lena Marsh",
    aiScore: 74, aiIssues: ["ASC-01"], coding: coded(true, ["ASC-01"], "2026-08-24T10:00:00Z", {}, R.paralegal),
    body: `DEVELOPER PROGRAM AGREEMENT — SCHEDULE 2, SMALL BUSINESS PROGRAM (EXCERPT, paraphrased for the review set)

1. Eligibility. A developer whose total proceeds, together with those of its associated developers, did not exceed the program threshold in the prior calendar year may enroll for the following year.
2. Commission. For enrolled developers the commission on paid apps and in-app purchases is 15% of the customer price, net of taxes.
\f3. Associated developers. Developers under common control, or sharing banking or tax identity, are treated as one developer for eligibility.
4. Exceeding the threshold. A developer whose proceeds exceed the threshold during the year pays the standard commission for the remainder of the year.
\f5. Standard commission unchanged. Nothing in this schedule changes the commission for developers who are not enrolled.`,
  },
  {
    id: D("c02"), date: "2016-03-01", cust: "reyes", type: "Contract", subject: "Wallet issuer agreement — fee schedule (Exhibit B, excerpt)", pages: 2, from: "Tomas Reyes",
    aiScore: 82, aiIssues: ["NFC-01", "DMG-01"], coding: coded(true, ["NFC-01", "DMG-01"], "2026-08-24T10:10:00Z", { confidentiality: "highly confidential" }),
    tags: ["expert-reliance"],
    body: `WALLET ISSUER AGREEMENT — EXHIBIT B: FEE SCHEDULE (EXCERPT; figures replaced with placeholders in the review set)

B.1 Transaction fee. Issuer pays a fee equal to a fixed number of basis points of the value of each purchase made with a card provisioned to the wallet.
B.2 Exclusivity of contactless presentment. Issuer shall not enable contactless presentment of provisioned cards on the device other than through the wallet.
\fB.3 Fee review. Fees are fixed for the initial term and reviewed on renewal.
B.4 Reporting. Issuer receives monthly transaction reports for provisioned cards.`,
  },
  {
    id: D("b02"), date: "2021-04-19", cust: "okoro", type: "Presentation", subject: "Board of Directors — Audit & Finance Committee: services economics (excerpt)", pages: 4, from: "Sofia Lindqvist",
    aiScore: 85, aiIssues: ["ASC-01", "MKT-01"], coding: coded(true, ["ASC-01", "MKT-01"], "2026-08-24T10:30:00Z", { confidentiality: "highly confidential" }),
    tags: ["board-materials"],
    body: `AUDIT & FINANCE COMMITTEE — SERVICES ECONOMICS (EXCERPT)
April 2021 · Presented by Services Finance

Page 1 — Services revenue mix
Store commission remains the largest single contributor to services gross margin.
\fPage 2 — Small Business Program
Program reaches most developers; commission impact in line with the September 2020 scenarios.
\fPage 3 — Regulatory and litigation
Inquiries and private litigation focus on the commission and purchase communications. Legal update presented separately.
\fPage 4 — Outlook
Commission growth expected to moderate; no change to the standard rate assumed.`,
  },
  {
    id: D("pr01"), date: "2017-09-12", cust: "marsh", type: "Presentation", subject: "Services planning offsite — retention and the platform", pages: 6, from: "Graham Whitaker",
    aiScore: 90, aiIssues: ["MKT-01", "MSG-01", "SWI-01", "ASC-01"], coding: coded(true, ["MKT-01", "MSG-01", "SWI-01", "ASC-01"], "2026-08-24T10:45:00Z", { hot: true, confidentiality: "highly confidential" }),
    tags: ["key-doc"],
    body: `SERVICES PLANNING OFFSITE — RETENTION AND THE PLATFORM
September 2017 · Services leadership

Slide 1 — The question
What keeps customers on our phones, and how do services reinforce it?
\fSlide 2 — Research recap
Messaging with friends and family, apps and content already bought, the watch, and cards in the wallet (consumer switching research, August 2017).
\fSlide 3 — Store
Purchases made in the store stay with the platform. Web purchases travel.
\fSlide 4 — Messaging and watch
Features that work best between our own devices are a reason to stay; parity elsewhere reduces that reason.
\fSlide 5 — Wallet
Cards and passes set up in the wallet add to the cost of leaving.
\fSlide 6 — Asks
Each services team to identify how its roadmap supports retention.`,
  },
];
