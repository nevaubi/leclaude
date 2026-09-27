import type { CodingDecision, DocType } from "@/lib/types/domain";
import { DEMO_ID as D, type DocSpec } from "./doc-spec";
import { CUST, REVIEWER as R, type CustKey } from "./people";

/**
 * Routine documents that give the review set realistic volume: status reports, meeting notes, chats, calendar
 * invitations, spreadsheets and correspondence around each issue, plus non-responsive business noise. Content is
 * deterministic (index-driven), FICTIONAL and written so that no two generated documents are near-duplicates.
 */

type Topic = [subject: string, first: string, second: string];

interface Theme { issue: string; custs: CustKey[]; people: string[]; team: string; topics: Topic[] }

const THEMES: Theme[] = [
  {
    issue: "ASC-01", custs: ["okoro", "marsh"], people: ["Sofia Lindqvist", "Graham Whitaker", "Lena Marsh", "Rachel Okoro"], team: "Services Finance",
    topics: [
      ["Commission revenue flash — month end", "Commission receipts closed the month 4% above plan, driven by games in Asia-Pacific and subscription renewals in Europe.", "The finance close flagged two storefronts where refunds exceeded the reserve; both are timing differences rather than policy issues."],
      ["Rate benchmarking request from strategy", "Strategy asked for a table comparing our commission with console, PC and web storefront fees for the planning offsite.", "We agreed to present published headline rates only and to footnote that the comparisons ignore differences in what each store provides."],
      ["Developer proceeds statement redesign", "The proceeds statement will show commission as a single line rather than a percentage by transaction type, following feedback from the policy team.", "Accounting confirmed the change does not affect tax reporting, and the new template goes live with the next quarterly cycle."],
      ["Year-two subscription tracking", "Share of subscription receipts qualifying for the 15% rate rose to 22% this quarter as older cohorts aged into year two.", "The give-up is tracking within the original model range; no change is needed to the FY forecast."],
      ["Commission question from investor relations", "Investor relations asked whether the commission rate can be described as stable for the next year in the analyst briefing.", "We recommended that the briefing describe services growth without committing to any specific rate language."],
      ["Small Business Program enrollment week one", "About 38,000 developers enrolled in the first week of the program, most with proceeds well under the threshold.", "Associated-developer checks flagged 212 accounts for manual review because they share banking details with larger developers."],
      ["Refund reserve methodology review", "Audit reviewed the refund reserve and asked us to document why the reserve is calculated on gross purchases rather than on developer proceeds.", "The methodology memo will be attached to the quarter-end package and shared with the controller."],
      ["Commission forecast scenarios for planning", "Planning asked for three commission scenarios: current rules, a reduced rate for subscriptions, and a reduced rate on all digital goods.", "Each scenario is indexed to the current year; the reduced-rate case cuts commission by between a sixth and a quarter."],
      ["Storefront currency update", "Twelve storefront currencies move to new price points next month because of exchange-rate changes since the last update.", "Developers will be notified two weeks ahead; proceeds in local currency remain approximately unchanged."],
      ["Top developers by commission — confidential list", "The top 1% of developers by proceeds generated just over two-thirds of commission in the fiscal year, almost all in games and subscriptions.", "The list is restricted to the finance leadership group and should not be forwarded to partner teams."],
      ["Commission accounting for bundled subscriptions", "Bundles that combine our services with third-party subscriptions need an allocation rule so commission applies only to the developer's share.", "We proposed allocating by standalone selling price; the controller asked for two worked examples before approval."],
    ],
  },
  {
    issue: "AST-01", custs: ["marsh", "ames"], people: ["Jae Park", "Victor Ames", "Lena Marsh", "Graham Whitaker"], team: "App Store Policy",
    topics: [
      ["Rejection appeal — fitness subscription app", "A fitness developer appealed a rejection for a support page that mentions its annual plan price on the web.", "The appeal board upheld the rejection and asked the developer to remove pricing references from the support page linked in the app."],
      ["Guideline FAQ refresh for reviewers", "The reviewer FAQ on purchase communications now includes six new examples, including push notifications that mention website promotions.", "Reviewers asked for clarity on emails sent from within the app; policy will add an example in the next revision."],
      ["Escalation log — purchase communications", "Twenty-seven escalations this month concerned statements about other ways to pay; nineteen came from reader and subscription apps.", "Three developers threatened to raise the issue with regulators; developer relations flagged them for follow-up calls."],
      ["Customer email opt-in question", "A developer asked whether it may ask users for an email address inside the app so it can later send offers for its website.", "The current position is that collecting emails is allowed but an in-app statement about the purpose of the collection may be treated as steering."],
      ["Developer conference session review", "The policy session for the developer conference will cover purchase rules at a high level and will not take live questions on pricing.", "Talking points emphasise user trust, refunds and family sharing rather than the commission."],
      ["Reviewer consistency audit — Q3", "A sample of 300 rejections under the purchase-communication guideline found 11 inconsistent decisions, mostly involving music apps.", "Inconsistent cases will be re-reviewed and the affected developers contacted with a corrected explanation."],
      ["Regional regulator question about steering", "A regional regulator asked for the number of apps rejected under the purchase-communication guideline in its country over three years.", "Policy will prepare the count with developer relations; the response itself goes through legal."],
      ["Link entitlement application volume", "Two hundred and forty reader apps applied for the account-link entitlement in its first quarter; 180 were approved.", "Most rejections were for apps that sell content inside the app, which makes them ineligible for the entitlement."],
      ["Guideline change request — music streaming", "A music streaming developer submitted a formal change request asking to show a single sentence about its web pricing.", "The request was logged and declined with the standard explanation; the developer asked for a meeting with policy leadership."],
      ["Anti-steering language in the developer agreement", "The agreement team proposed moving the purchase-communication rule from the guidelines into the agreement schedule for enforceability.", "Policy prefers keeping it in the guidelines so it can be updated without a new agreement version."],
      ["Push notification promotion rejected", "A game developer's push notification advertised a discount available only on its website and was flagged by automated review.", "The developer removed the notification after contact from developer relations; no update rejection was needed."],
    ],
  },
  {
    issue: "IAP-01", custs: ["okoro", "marsh"], people: ["Sofia Lindqvist", "Rachel Okoro", "Lena Marsh", "Victor Ames"], team: "App Store Payments",
    topics: [
      ["Payment method expansion — carrier billing", "Carrier billing will launch in four additional countries, where card penetration is low and in-app purchase conversion lags.", "Carrier fees are higher than card processing, which raises blended payment cost by about a tenth of a point."],
      ["Fraud loss dashboard — monthly", "Fraud losses on in-app purchases were 0.31% of gross this month, within the tolerance band agreed with risk.", "Most losses came from stolen card testing on low-priced consumables; velocity limits were tightened on the affected storefronts."],
      ["Physical goods versus digital goods boundary", "A ride-sharing developer asked whether tips paid to drivers inside the app count as digital goods subject to in-app purchase.", "Tips for real-world services are outside the requirement; the developer was told to keep tip flows separate from any digital add-ons."],
      ["Chargeback process improvements", "Chargeback disputes now resolve in an average of 19 days, down from 31, after automating evidence packages for card networks.", "The team will extend automation to carrier billing disputes next quarter."],
      ["Family sharing refund policy", "Refunds for purchases made by family members will require the organiser's confirmation beginning next month.", "Customer support expects a short-term increase in contacts and has prepared scripted answers."],
      ["Payment processor contract renewal", "The main card processor renewal lowers our blended processing rate by eight basis points in exchange for a three-year volume commitment.", "The savings accrue to payments operations; there is no proposal to reflect them in developer terms."],
      ["In-app purchase conversion benchmark", "Checkout conversion for in-app purchase is roughly twice that of the typical mobile web checkout, according to a partner survey.", "Marketing may use the benchmark in developer materials once the survey methodology is reviewed."],
      ["Developer question on web purchases and restoring content", "A reader app asked whether content bought on its website may be restored in the app for the same account.", "Yes — access to previously purchased content is permitted, but the app may not tell users where the purchase was made."],
      ["Consumable pricing tiers for games", "Games account for most consumable purchases; the top tier used most often by games is the lowest-priced consumable.", "The data supports keeping the current tier table rather than adding finer increments at low prices."],
      ["Alternative payments request from a dating app", "A dating app asked to process subscription payments through its own processor to offer installment plans.", "The request was declined; installment plans are on the payments roadmap but not scheduled."],
      ["Tax remittance update", "We will remit sales tax on in-app purchases in three more states, which changes the proceeds calculation for affected developers.", "Developers will see the change in the next proceeds statement with an explanatory note."],
    ],
  },
  {
    issue: "SUP-01", custs: ["ames", "marsh"], people: ["Jae Park", "Victor Ames", "Lena Marsh", "Mira Solberg"], team: "Developer Relations",
    topics: [
      ["Mini-program partner count — Kitebird", "Kitebird reports 61 live mini-programs submitted individually under the conditions, far fewer than the 400 partners it announced.", "Partners told Kitebird the per-program review requirement made small integrations uneconomic."],
      ["Host app directory screenshot review", "App Review flagged a host app update whose search results list mini-games from several developers in a grid.", "Policy confirmed the grid counts as a catalog; the developer was asked to remove it before approval."],
      ["Chat app with embedded games", "A messaging developer asked whether small HTML5 games shared inside chats need separate review.", "Games that can be launched from a chat and played in the app are treated as mini-apps and require individual submission."],
      ["Regional super app escalation", "A regional super app with payments, rides and food delivery asked to open its mini-program platform on our phones as it has elsewhere.", "Developer relations offered a call on the individual-submission path; the developer said it will keep its platform on the web."],
      ["Mini-app review queue metrics", "Median review time for mini-app submissions is 3.4 days compared with 1.1 days for standard apps.", "Reviewers note most mini-apps are thin wrappers and ask for a lighter template."],
      ["Guideline wording — HTML5 content", "Policy drafted revised wording distinguishing HTML5 content served from the web from mini-apps offered through a directory.", "The draft goes to legal review before the next guideline update."],
      ["Kitebird quarterly business review", "Kitebird's quarterly review focused on the mini-program limits and on its request for a directory for enterprise partners.", "We committed only to respond in writing within 30 days."],
      ["Developer feedback survey — host apps", "Seventeen host-app developers responded to the feedback survey; all ranked the directory restriction as their top concern.", "Most said they would invest more if a reviewed directory were allowed."],
      ["Enterprise mini-app exception request", "An enterprise software developer asked for an exception so employees can access internal mini-apps inside its workplace app.", "Enterprise distribution tools are the recommended path; no exception was granted."],
      ["Super app policy talking points update", "Talking points for regional teams now lead with review and safety, and describe individual submission as a quality measure.", "The update removes references to competing payment systems inside host apps."],
      ["Mini-program payments question", "A host app asked whether purchases inside approved mini-programs may use the host's own wallet.", "No — purchases of digital goods inside mini-programs must use in-app purchase."],
    ],
  },
  {
    issue: "CGM-01", custs: ["lee"], people: ["Graham Whitaker", "Lena Marsh", "Jonah Petrakis", "Jae Park"], team: "Games & Streaming BD",
    topics: [
      ["Streaming provider meeting notes", "The streaming provider presented its catalog model and latency data from other platforms, averaging under 60 milliseconds in major cities.", "We restated the per-title listing requirement and offered engineering support for submissions."],
      ["Per-title submission estimate from a provider", "A provider estimated that listing its 180-game catalog as individual apps would require 14 people and ongoing review for weekly catalog changes.", "The provider said it will not pursue the native path this year."],
      ["Game streaming browser performance", "Browser-based streaming on our phones performs well in testing but lacks controller support in some configurations.", "Engineering asked whether browser controller support should be prioritised; BD had no view."],
      ["Console maker partnership inquiry", "A console maker asked about bringing its cloud catalog to our phones and tablets as a single app.", "BD explained the listing requirement; the partner said it would evaluate web delivery instead."],
      ["Games category revenue review", "Games generated the majority of in-app purchase commission again this year, concentrated in free-to-play titles.", "BD noted that cloud catalogs would compete for the same player spending."],
      ["Streaming guideline FAQ for developers", "The developer FAQ explains that streaming games may be offered, each with its own listing, and that catalog apps may link to them.", "BD asked policy to add an example of a compliant catalog app."],
      ["Game subscription bundle discussion", "A subscription service asked whether its downloadable games could be sold in a bundle with its streamed games.", "Downloadable games are fine under the normal rules; streamed titles still need their own listings."],
      ["Streaming app review queue", "Two streaming catalog submissions were rejected this quarter for listing games inside the app without individual listings.", "Both developers were referred to the FAQ and to BD for follow-up."],
      ["Cloud gaming market update for planning", "Analyst estimates put cloud gaming revenue at a small share of mobile games but growing quickly from a low base.", "Planning asked BD for a view on whether streaming affects device upgrade cycles."],
      ["Controller accessory partner request", "An accessory maker asked for promotion of its controller alongside streaming services in the store.", "Editorial will not feature accessories tied to services that are not available as native apps."],
      ["Streaming provider follow-up call", "The provider asked whether a reduced review scope for games already rated by industry bodies was possible.", "BD said the requirement applies to all streamed games and offered no timeline for changes."],
    ],
  },
  {
    issue: "MSG-01", custs: ["nand"], people: ["Owen Hartley", "Ben Calloway", "Priya Nand"], team: "Messaging Engineering",
    topics: [
      ["Messaging reliability — weekly metrics", "Delivery success for messages between our devices held at 99.97% this week; the fallback path to other phones is not measured.", "Calloway asked whether fallback delivery should be instrumented; the request was added to the backlog."],
      ["Group features sprint review", "The group features team shipped mentions and inline replies for groups made up entirely of our users.", "Mixed-platform groups will continue to use the fallback path without the new features."],
      ["Fallback media compression bug", "A regression increased compression of videos sent to other phones, producing very low-quality clips.", "The fix restores the previous compression level only; no quality improvements are planned."],
      ["Carrier messaging standards meeting", "Carriers presented their timeline for rich messaging interoperability and asked whether we would participate.", "We attended as observers and made no commitments."],
      ["Customer support trends — messaging", "Support contacts about missing group messages rose 18% year over year, most involving mixed-platform groups.", "Support scripts suggest users create groups with only our devices where possible."],
      ["Encryption indicator design review", "Design proposed showing an indicator when a conversation falls back to unencrypted SMS.", "The review kept the existing color distinction and deferred any additional indicator."],
      ["Messaging client scoping follow-up", "An engineer asked whether the 2016 cross-platform client scoping could be refreshed for current platform versions.", "Management said the decision stands and no refresh is needed."],
      ["Messaging team offsite agenda", "The offsite agenda covers group features, spam filtering and the service's scaling plan for the next two years.", "Cross-platform messaging is not on the agenda."],
      ["Spam filtering for unknown senders", "Filtering for unknown senders reduced reported spam by 41% in the pilot countries.", "The filter applies to messages from other phones as well as our own devices."],
      ["Accessibility review of message effects", "Accessibility testing found message effects are not described to screen readers when sent to other phones.", "The finding was logged as expected behaviour on the fallback path."],
      ["Mixed-group bug triage", "Triage grouped 63 open bugs affecting mixed-platform groups under a single known issue.", "Engineers noted most could be fixed with the rich messaging standard."],
    ],
  },
  {
    issue: "SWI-01", custs: ["frey"], people: ["Beatrice Kowal", "Kenji Morita", "Ines Moreau", "Daniel Frey"], team: "Wearables Interoperability",
    topics: [
      ["Accessory maker request log — quarterly", "Eleven accessory makers requested notification actions or background connection this quarter, up from seven.", "All requests were answered with the standard response citing privacy and battery life."],
      ["Watch attach rate — holiday quarter", "Watch attach among new phone buyers reached a record in the holiday quarter, led by the lower-priced model.", "The retention analysis will be refreshed with the new cohort next month."],
      ["Third-party watch connectivity bug report", "A third-party watch maker reported that the system suspends its companion app within minutes of the phone locking.", "The behaviour is expected under current background rules; no bug was filed."],
      ["Health data export question", "An accessory maker asked whether users can export health data from our watch to its service when switching watches.", "Export is available as a file; direct transfer to a competitor's service is not supported."],
      ["Watch connectivity roadmap review", "Watch Connectivity presented a roadmap with improved pairing and faster sync for our watch.", "No items for third-party watches were included."],
      ["Accessory program certification update", "The accessory certification program added new requirements for Bluetooth hearing devices and fitness sensors.", "Smartwatches remain outside the program's scope."],
      ["Pulsewear follow-up meeting", "Pulsewear asked again for quick replies and said its customers blame its hardware for missed notifications.", "We repeated that the current interfaces are what is available."],
      ["Wearables competitive review", "Competitive analysis shows other phone platforms give third-party watches notification actions and persistent connections.", "The review notes our watch's integration is a key differentiator."],
      ["Watch owner survey highlights", "Owners rank health tracking and notifications as the top reasons they use the watch daily.", "Forty-one percent said they would need a new watch if they changed phones."],
      ["Background execution policy change request", "An engineer proposed a background entitlement for certified accessory companion apps.", "The proposal was parked pending a product decision."],
      ["Watch developer program update", "Watch app submissions rose 15% after new workout interfaces were added.", "Third-party watch makers are not eligible for the watch developer interfaces."],
    ],
  },
  {
    issue: "NFC-01", custs: ["reyes"], people: ["Alicia Ferreira", "Tomas Reyes", "Arjun Mehta"], team: "Wallet & NFC",
    topics: [
      ["Issuer onboarding status", "Forty-two issuers went live in the wallet this quarter, including three regional banks and two credit unions.", "Fee terms were standard for all new issuers."],
      ["Transit card integration", "Two more transit systems accept wallet passes, bringing the total to 18 cities.", "Transit agencies asked whether their own apps could use the NFC controller; the answer was no."],
      ["Push provisioning adoption", "Push provisioning from bank apps now accounts for most new cards added to the wallet.", "Banks asked for provisioning analytics; a dashboard is planned."],
      ["Contactless loyalty cards", "Loyalty cards presented in the same tap as payment are live with five retailers.", "Retailers asked whether their own apps could use the NFC controller for loyalty; not currently supported."],
      ["Issuer fee renegotiation request", "A top-ten issuer asked to lower its fee rate at renewal, citing growth in wallet volume.", "The request was declined; the issuer was offered co-marketing support instead."],
      ["NFC tag reading for developers", "Developers can read NFC tags in apps, but card emulation remains limited to the wallet.", "Developer relations receives frequent questions about the difference."],
      ["Wallet security review", "The annual security review found no material issues with tokenisation or the secure element.", "The report recommends continued investment in fraud detection for provisioning."],
      ["Payment app partnership inquiry", "A peer-to-peer payment app asked about offering contactless payments at stores from its own app.", "Partnerships offered wallet provisioning for its debit card as the alternative."],
      ["Wallet expansion plan — new markets", "The wallet will launch in six new markets next year, subject to issuer agreements.", "Local banks in two markets already offer tap-to-pay through their own apps on other phones."],
      ["Merchant acceptance update", "Contactless acceptance at top retailers exceeds 90% in launch markets.", "Remaining gaps are mostly small merchants with older terminals."],
      ["Wallet partner FAQ refresh", "The partner FAQ now explains provisioning options, fee terms and certification requirements.", "Questions about direct NFC access are routed to the partnerships team."],
    ],
  },
  {
    issue: "MKT-01", custs: ["marsh", "okoro", "lee"], people: ["Graham Whitaker", "Sofia Lindqvist", "Lena Marsh", "Rachel Okoro"], team: "Services Strategy",
    topics: [
      ["Installed base update for planning", "Active devices grew 7% year over year, with the fastest growth in markets where the store launched most recently.", "Store spend per active device grew faster than the base itself."],
      ["Switching survey refresh", "The refreshed switching survey shows the same top barriers as the 2017 study: messaging, apps and accessories.", "The share citing repurchasing apps rose four points among owners under 30."],
      ["Web distribution trends", "Progressive web apps remain a small share of time spent on our phones, limited mainly to news and shopping.", "Developers cite lack of push notifications and store visibility as the main constraints."],
      ["Competitor store fee changes", "Two competing platforms announced lower fees for small developers and subscriptions.", "Strategy recommends monitoring developer sentiment rather than responding directly."],
      ["Planning offsite pre-read — services", "The services pre-read frames the store, payments, messaging and wallet as a connected set of reasons customers stay.", "Each business line is asked to describe how it supports retention."],
      ["Developer revenue concentration", "The top 100 developers account for the majority of store revenue; most are game publishers.", "Strategy notes developer concentration increases the risk of coordinated complaints."],
      ["Upgrade cycle analysis", "Average phone replacement cycles lengthened by five months over three years.", "Services revenue per device offsets slower hardware replacement."],
      ["Market share briefing for leadership", "Our share of premium smartphone sales rose in most markets, while overall unit share was stable.", "Premium buyers spend more in the store and adopt more accessories."],
      ["App category growth review", "Subscription apps grew fastest among categories, followed by health and productivity.", "Games remain the largest category by commission."],
      ["Regulatory landscape summary for strategy", "Inquiries into app distribution are open in several jurisdictions, focusing on commissions and purchase communications.", "The summary is factual and does not assess legal risk."],
      ["Consumer research vendor proposal", "A research vendor proposed a longitudinal panel to track reasons for switching over three years.", "Strategy asked for a smaller pilot before committing."],
    ],
  },
  {
    issue: "DMG-01", custs: ["okoro"], people: ["Sofia Lindqvist", "Rachel Okoro"], team: "App Store Payments Finance",
    topics: [
      ["Price tier distribution report", "Most paid apps and in-app purchases are priced at the three lowest tiers; the distribution has been stable for three years.", "Price changes cluster at tier boundaries after proceeds changes."],
      ["Developer price change log — quarter", "Developers made 48,000 price changes this quarter, most in markets with currency adjustments.", "Increases outnumbered decreases roughly two to one."],
      ["Consumer spend per account", "Average annual spend per paying account rose 11% driven by subscriptions and games.", "Spending is highly concentrated: a small share of accounts produces most consumer spend."],
      ["Refund rate by category", "Refund rates are highest in games and lowest in productivity apps.", "Refund policy has not changed this year."],
      ["Proceeds change communication review", "Finance reviewed how proceeds changes are communicated to developers ahead of tier updates.", "Developers get two weeks' notice; many adjust prices on the effective date."],
      ["Subscription price increase consent data", "Subscribers accepted 87% of price increases that required consent.", "Churn after accepted increases was similar to baseline."],
      ["Purchase data retention question", "Finance confirmed transaction-level purchase data is retained for seven years in the payments warehouse.", "Aggregated reports are retained indefinitely."],
      ["Tier table redesign proposal", "A proposal would expand the tier table to allow more price points between existing tiers.", "Finance estimates little effect on average prices."],
      ["Developer pricing survey", "Surveyed developers said they set prices by targeting proceeds after commission.", "Smaller developers were more likely to price at the lowest tier."],
      ["Account-level spend extract request", "The economics team requested an extract of account-level spend by year for an internal study.", "The extract was approved with personal identifiers removed."],
    ],
  },
];

/** Non-responsive business noise (the review protocol codes these Not Responsive). */
const FILLER: [CustKey, DocType, string, string, string][] = [
  ["marsh", "Email", "Team offsite — hotel block", "The hotel block for the team offsite is held until the 12th; please book with the group code.", "Dinner on the first night is at the restaurant next to the hotel."],
  ["ames", "Other", "Invitation: Developer relations all-hands", "Quarterly all-hands with updates on team priorities and new hires.", "Remote dial-in is available for regional staff."],
  ["okoro", "Email", "Expense report reminder", "Expense reports for last month are due Friday; receipts over the limit need a manager's note.", "Finance systems will be down Saturday morning for maintenance."],
  ["lee", "Chat", "#games-bd — conference booth logistics", "Booth shipping arrives Tuesday; badges are at the registration desk.", "Please sign up for booth shifts by Thursday."],
  ["nand", "Email", "On-call rotation swap", "Could someone swap on-call weeks with me in March? I will be travelling.", "I can take any week in April in return."],
  ["frey", "Email", "Lab equipment order", "The replacement Bluetooth test rig was approved and should arrive in two weeks.", "Until then please book the shared rig in building two."],
  ["reyes", "Email", "Holiday coverage schedule", "Please add your holiday coverage days to the shared calendar by the end of the week.", "At least one partnerships manager needs to be reachable each weekday."],
  ["cole", "Other", "Invitation: CLE — ethics hour", "Annual ethics CLE session for the legal department.", "Attendance counts toward the state bar requirement."],
  ["marsh", "Note", "Interview loop feedback — policy analyst", "The candidate showed strong writing skills and good judgement on review scenarios.", "Recommend a second conversation with the policy leadership team."],
  ["ames", "Email", "Badge access for new contractor", "Please grant building access for the new events contractor starting Monday.", "Access should end on the last day of the developer conference."],
  ["okoro", "Chat", "#payments-finance — lunch order", "Ordering lunch for the close meeting, please add your order by 11.", "Vegetarian options are marked on the menu."],
  ["lee", "Email", "Travel approval — trade show", "Requesting approval for travel to the games trade show in August.", "Estimated cost is within the team travel budget."],
  ["nand", "Other", "Invitation: Messaging team social", "End-of-quarter team social at the usual place.", "Partners and families welcome."],
  ["frey", "Note", "1:1 notes — career development", "Discussed goals for next year, including presenting at the internal design review.", "Follow up on the leadership course enrollment."],
  ["reyes", "Email", "Office move — floor plan", "Wallet partnerships moves to the fourth floor on the 20th; boxes will be delivered Wednesday.", "Please label personal items clearly."],
  ["cole", "Email", "Legal department newsletter", "This month's newsletter covers new hires, the records management refresh and upcoming training.", "Submissions for next month are due on the 25th."],
  ["marsh", "Chat", "#app-store-policy — printer", "The printer on the third floor is jammed again.", "Facilities has a ticket open."],
  ["okoro", "Email", "Benefits enrollment window", "Open enrollment for benefits closes on the 15th.", "Changes take effect on January 1."],
  ["lee", "Note", "Vendor evaluation — event photography", "Evaluated three photography vendors for the developer event.", "Recommend the second vendor on price and portfolio."],
  ["ames", "Email", "Parking permit renewal", "Parking permits expire at the end of the month; renew through the facilities portal.", "Carpool permits have a separate process."],
];

const OPENERS = ["Quick update:", "For the record:", "Summary below.", "Following up on this morning:", "As discussed,", "FYI —", "Where things stand:", "Heads up:"];
const ASKS = [
  "Let me know if you want this in the monthly deck.", "Please flag anything that looks off before Friday.", "No action needed unless you disagree.",
  "I'll bring this to the next staff meeting.", "Can we discuss at our 1:1?", "Filed in the team folder.", "Will send the detail separately if useful.",
  "Comments welcome by end of week.", "Adding to the open-items list.", "Happy to walk through it.", "Treat as internal only.",
];

/** Counterparties (letters go to them; internal routing never includes them). */
const EXTERNAL = new Set(["Mira Solberg", "Jonah Petrakis", "Ines Moreau", "Arjun Mehta"]);

const pad = (n: number) => String(n).padStart(2, "0");
/** Deterministic date between 2016-01 and 2023-12 for index i (salted per theme). */
function dateFor(i: number, salt: number): string {
  const y = 2016 + ((i * 3 + salt * 5) % 8);
  const m = ((i * 5 + salt * 7) % 12) + 1;
  const d = ((i * 11 + salt * 3) % 27) + 1;
  return `${y}-${pad(m)}-${pad(d)}`;
}
const timeFor = (i: number) => `${pad(8 + (i * 7) % 10)}:${pad((i * 13) % 60)}`;

const TYPES: DocType[] = ["Email", "Email", "Chat", "Note", "Report", "Spreadsheet", "Other", "Email", "Letter", "Email", "Memo"];

function first(name: string) { return name.split(" ")[0]; }

function render(type: DocType, subject: string, a: string, b: string, i: number, author: string, to: string[], team: string, date: string): { body: string; subject: string; pages: number; tags?: string[] } {
  const opener = OPENERS[i % OPENERS.length];
  const ask = ASKS[(i * 3) % ASKS.length];
  switch (type) {
    case "Chat": {
      const other = to[0] ?? "Team";
      const h = 9 + (i % 8);
      return { subject: `#${team.toLowerCase().replace(/[^a-z]+/g, "-")} — ${subject.toLowerCase()}`, pages: 1, body: `[#${team.toLowerCase().replace(/[^a-z]+/g, "-")} · ${date}]\n${h}:${pad((i * 7) % 50)} ${author}: ${a}\n${h}:${pad((i * 7) % 50 + 3)} ${other}: ${b}\n${h}:${pad((i * 7) % 50 + 6)} ${author}: ${ask}` };
    }
    case "Note":
      return { subject: `Meeting notes — ${subject}`, pages: 1, body: `MEETING NOTES — ${subject.toUpperCase()}\nDate: ${date}   Team: ${team}\nAttendees: ${[author, ...to].join(", ")}\n\n1. ${a}\n2. ${b}\n\nAction: ${ask}` };
    case "Report":
      return { subject: `${team} status — ${subject}`, pages: 2, body: `${team.toUpperCase()} — STATUS REPORT\nPeriod ending ${date} · Prepared by ${author}\n\nHighlights\n${a}\n\fIssues and risks\n${b}\n\nNext period\n${ask}` };
    case "Spreadsheet": {
      const base = 100 + ((i * 37) % 60);
      const rows = [0, 1, 2, 3].map((k) => `${2016 + ((i + k) % 8)}     ${base + k * ((i % 5) + 3)}     ${(((i * 13 + k * 7) % 90) / 10 + 1).toFixed(1)}%`).join("\n");
      return { subject: `${subject} (summary tab)`, pages: 1, body: `${subject.toUpperCase()} — SUMMARY TAB\nOwner: ${author} · ${team}\n\nYear     Index     Change\n${rows}\n\nNote: ${a}\nCaveat: ${b}` };
    }
    case "Other":
      return { subject: `Invitation: ${subject}`, pages: 1, tags: ["calendar-invite"], body: `CALENDAR INVITATION\nTitle: ${subject}\nWhen: ${date} · ${timeFor(i)} (Pacific), 45 minutes\nOrganizer: ${author}\nRequired: ${to.join(", ")}\nAgenda: ${a} ${b}` };
    case "Letter":
      return { subject: `Letter — ${subject}`, pages: 1, body: `${date}\n\nDear ${to[0] ?? "Developer"},\n\nRe: ${subject}\n\n${a} ${b}\n\nIf you have questions, please reply to this letter or contact your developer relations representative.\n\nSincerely,\n${author}\n${team}` };
    case "Memo":
      return { subject, pages: 2, body: `MEMORANDUM\nTO: ${to.join("; ")}\nFROM: ${author}\nDATE: ${date}\nRE: ${subject}\n\n1. ${a}\n\f2. ${b}\n\n3. ${ask}` };
    default:
      return { subject, pages: 1, body: `${to.length ? `${first(to[0])},` : "All,"}\n\n${opener} ${opener.endsWith(",") ? a.charAt(0).toLowerCase() + a.slice(1) : a}\n\n${b}\n\n${ask}\n\n${first(author)}` };
  }
}

function codingFor(i: number, issue: string, responsiveTheme: boolean): Partial<CodingDecision> | undefined {
  const k = i % 10;
  const reviewer = i % 3 === 0 ? R.paralegal : R.associate;
  const at = `2026-09-${pad(1 + (i % 20))}T${pad(9 + (i % 8))}:${pad((i * 17) % 60)}:00Z`;
  if (!responsiveTheme) return k < 5 ? { responsive: false, privileged: false, issues: [], reviewerId: reviewer, reviewedAt: at } : undefined;
  if (k < 3) return { responsive: true, privileged: false, issues: [issue], reviewerId: reviewer, reviewedAt: at, confidentiality: "confidential" };
  if (k === 3) return { responsive: false, privileged: false, issues: [], reviewerId: reviewer, reviewedAt: at, notes: "Tangential; no discussion of the challenged conduct." };
  return undefined; // needs review
}

/** Routine documents (deterministic). */
export function buildGeneratedSpecs(): DocSpec[] {
  const out: DocSpec[] = [];
  let n = 0;
  THEMES.forEach((theme, t) => {
    theme.topics.forEach(([subject, a, b], j) => {
      n += 1;
      const i = n;
      const cust = theme.custs[j % theme.custs.length];
      const author = CUST[cust].name;
      const external = theme.people.find((p) => EXTERNAL.has(p));
      let type = TYPES[(j + t) % TYPES.length];
      if (type === "Letter" && !external) type = "Memo";
      const to = type === "Letter" ? [external!] : theme.people.filter((p) => p !== author && !EXTERNAL.has(p)).slice(0, 1 + (j % 3));
      const date = dateFor(j, t + 1);
      const r = render(type, subject, a, b, i, author, to, theme.team, date);
      const coding = codingFor(i, theme.issue, true);
      const cc = type === "Email" && j % 4 === 1 ? theme.people.filter((p) => p !== author && !to.includes(p) && !EXTERNAL.has(p)).slice(0, 1) : undefined;
      out.push({
        id: D(`g${String(i).padStart(3, "0")}`), date, time: type === "Email" ? timeFor(i) : undefined, cust, type, subject: r.subject,
        from: author,
        to: type === "Chat" || type === "Note" || type === "Report" || type === "Spreadsheet" ? undefined : to.length ? to : undefined, cc: cc?.length ? cc : undefined,
        pages: r.pages, body: r.body, tags: r.tags,
        aiScore: 45 + ((i * 29) % 45), aiIssues: [theme.issue], aiSummary: a,
        coding,
      });
    });
  });
  FILLER.forEach(([cust, type, subject, a, b], j) => {
    n += 1;
    const i = n;
    const author = CUST[cust].name;
    const date = dateFor(j, 11);
    const to = type === "Chat" || type === "Note" ? [] : [["Lena Marsh", "Victor Ames", "Rachel Okoro", "Marcus Lee"].find((x) => x !== author) ?? "Team"];
    const r = render(type, subject, a, b, i, author, to, "Team", date);
    out.push({
      id: D(`g${String(i).padStart(3, "0")}`), date, time: type === "Email" ? timeFor(i) : undefined, cust, type, subject: r.subject, from: author,
      to: to.length && type !== "Chat" && type !== "Note" ? to : undefined, pages: r.pages, body: r.body, tags: r.tags,
      aiScore: 3 + ((i * 7) % 20), aiIssues: [], aiSummary: a,
      coding: codingFor(i, "", false),
    });
  });
  return out;
}
