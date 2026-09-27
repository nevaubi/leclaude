import type { Deposition } from "@/lib/types/domain";
import { DEMO_DEPOSITIONS } from "../ids";
import { CUST, DEFENDED_BY, M, TAKEN_BY, tagged } from "./people";
import { assemble, DEFENSE_ATTORNEY as DA, EXAMINING_ATTORNEY as EA, obj, type DocIndex, type ExhibitSpec, type RawQA } from "./depo-helpers";

/** Deposition of Daniel Frey (FICTIONAL), Product Manager, Wearables Interoperability. */

export const FREY_CITES = {
  onlyReasons: { page: 23, line: 8 },
  kowalReason: { page: 51, line: 4 },
  standsBy: { page: 58, line: 6 },
  deckAdmission: { page: 81, line: 3 },
  noBatteryTest: { page: 141, line: 5 },
} as const;

const EXHIBITS: ExhibitSpec[] = [
  { id: "Frey-1", slug: "w01", page: 14, description: "Frey memo, 'Third-party watch connectivity: API access requests' (14 Mar 2017)", recognize: "Yes. I wrote it." },
  { id: "Frey-2", slug: "w02", page: 26, description: "Frey email to Kenji Morita on notification actions (15 Mar 2017)", recognize: "Yes." },
  { id: "Frey-3", slug: "w03", page: 27, description: "Morita reply, 'policy, not physics' (16 Mar 2017)", recognize: "Yes, I received it." },
  { id: "Frey-4", slug: "w04", page: 40, description: "Pulsewear request from Ines Moreau (22 May 2018)", recognize: "Yes." },
  { id: "Frey-5", slug: "w05", page: 44, description: "Frey email, 'Pulsewear request — recommendation' (29 May 2018)", recognize: "Yes, my email to Beatrice." },
  { id: "Frey-6", slug: "w06", page: 50, description: "Kowal reply declining the Pulsewear requests (30 May 2018)", recognize: "Yes." },
  { id: "Frey-7", slug: "w07", page: 80, description: "'Wearables ecosystem strategy — attach and retention' deck (Aug. 2019)", recognize: "Yes. I prepared it for Beatrice.", author: "I did." },
  { id: "Frey-8", slug: "w08", page: 88, description: "watch owner phone-retention cohort summary (18 Feb 2020)", recognize: "Yes.", author: "I did, with the analytics team." },
  { id: "Frey-9", slug: "x01", page: 102, description: "consumer switching research summary (30 Aug 2017)", recognize: "I've seen it. It came from the services side.", recipients: "I don't know the distribution. It was used at the planning offsite." },
  { id: "Frey-10", slug: "pr01", page: 108, description: "services planning offsite deck (Sept. 2017)", recognize: "I think I saw it later. I didn't attend." },
];

const RAW: RawQA[] = [
  [5, 2, "(The witness was sworn.) State your name, please.", "Daniel Frey."],
  [6, 14, "Where do you work?", "Apple. I'm a product manager for wearables interoperability."],
  [7, 2, "Who do you report to?", "Beatrice Kowal, Senior Director, Wearables Product."],
  [8, 9, "What does wearables interoperability cover?", "How our watch and other accessories work with the phone, and requests from third-party accessory makers."],
  [9, 17, "How long have you been in that role?", "Since 2016."],
  [11, 4, "What did you review to prepare?", "Some of my emails and a deck. I met with counsel.", { objection: obj(DA, "privilege", "No content of communications with counsel.") }],
  [15, 10, "Paragraph 4 of Exhibit Frey-1: 'Our own watch maintains a persistent connection with acceptable phone battery impact; a third-party connection using the same stack would have similar impact.' Did you write that?", "Yes."],
  [16, 3, "Was that accurate?", "It was my understanding at the time."],
  [17, 18, "Paragraph 3 says notification actions and background connection 'are engineering work, not hard limits.' Accurate?", "That was the technical view I had then."],
  [23, 8, "Why can't third-party watches act on notifications or keep a background connection with the phone?", "Battery life and privacy. Those are the reasons. Nothing else.", { flags: ["key"], note: "Contradicted by Frey-3 ({B:w03}) and Frey-6 ({B:w06}); see 51:4 and 58:6." }],
  [24, 3, "No business reason?", "Not that I'm aware of."],
  [24, 16, "Have you ever discussed with anyone whether third-party watches should work as well as your company's watch?", "It's come up.", { objection: obj(DA, "form") }],
  [28, 5, "Mr. Morita wrote that 'the background limits on third-party watches are policy, not physics.' Did you disagree with him?", "Kenji is an engineer. Engineers see what's possible. There are other considerations.", { flags: ["evasive"] }],
  [28, 19, "Such as?", "Privacy."],
  [29, 12, "He said the battery cost of a background entitlement 'is the same as ours, which we already accept.' Did anyone dispute that?", "Not in writing that I've seen."],
  [32, 6, "Did the 2017 estimate go to Ms. Kowal?", "Kenji copied her."],
  [41, 9, "Ms. Moreau wrote that Pulsewear's users assume the missed notifications are Pulsewear's hardware fault. Were you aware of that perception?", "Yes. Several makers said the same."],
  [45, 3, "In Exhibit Frey-5 you recommended granting quick replies behind a consent screen. Correct?", "Yes, I recommended that."],
  [45, 17, "A consent screen would address the privacy concern with message content?", "It would address some of it."],
  [51, 4, "Ms. Kowal wrote: 'The watch is one of the best reasons people stay on the phone; a third-party watch that works just as well removes that reason.' Did you understand that to be her reason for declining?", "I understood it was part of her thinking.", { flags: ["admission", "key"] }],
  [51, 20, "She wrote: 'When you respond to Ines, cite privacy and battery. Both are true enough.' Did you then cite privacy and battery to Pulsewear?", "Yes.", { flags: ["admission", "key"] }],
  [53, 2, "Did you tell Pulsewear that retention of phone customers played any role?", "No."],
  [54, 9, "Before you responded to Ms. Moreau, you asked Ms. Cole how to word the response. What did she tell you?", "(Instructed not to answer.)", { objection: obj(DA, "privilege", "Instruct the witness not to answer; the request for advice is logged."), flags: ["privilege"] }],
  [58, 6, "Earlier, at page 23, you said battery and privacy were the only reasons and there was nothing else. Do you want to change that answer?", "I stand by the fact that those are real reasons.", { flags: ["contradiction", "evasive", "key"], note: "Refuses to withdraw 23:8 after Frey-6." }],
  [58, 21, "Were they the only reasons?", "They were the reasons I gave.", { flags: ["evasive"] }],
  [61, 4, "Did you ever tell any accessory maker that a business reason played a role in the limits?", "No."],
  [66, 13, "How many accessory makers asked for notification actions between 2017 and 2021?", "Something like thirty, counting repeat requests."],
  [70, 9, "Were any granted?", "Not the notification actions or background connection, no."],
  [81, 3, "Slide 6 of Exhibit Frey-7 says 'Differentiated watch integration supports phone retention. Opening watch interfaces to third parties would reduce this advantage.' Your words?", "Yes. I prepared the deck for Beatrice.", { flags: ["admission", "key"] }],
  [82, 10, "Slide 5 says owners of third-party watches switch phones at rates similar to non-owners. So the retention benefit came from your company's watch, not watches in general?", "That's what the data showed.", { flags: ["admission"] }],
  [84, 1, "Slide 8 recommends maintaining the current third-party scope 'revisit if regulatory requirements change.' Was it revisited?", "Not while I was in the role, other than responding to inquiries."],
  [89, 2, "Exhibit Frey-8 shows 24-month retention of about 94 percent for watch owners versus 83 percent for non-owners and 83 to 84 percent for third-party watch owners. Correct?", "Yes."],
  [90, 15, "Did anyone use that data to argue for opening the interfaces?", "No."],
  [103, 5, "Exhibit Frey-9 reports 22 percent of owners cite the watch or accessories as a major reason not to switch. Were you aware of that research in 2018?", "I was aware there was research. I don't remember the number."],
  [109, 7, "Slide 4 of Exhibit Frey-10 says 'Features that work best between our own devices are a reason to stay; parity elsewhere reduces that reason.' Is that consistent with Ms. Kowal's email?", "I think it's a similar idea.", { objection: obj(DA, "foundation") }],
  [115, 1, "(Examination by counsel for defendant.)", "(Mr. Mercer examining.)"],
  [120, 4, "Mr. Frey, are there genuine privacy concerns with giving third-party watches access to message content?", "Yes. Message content is sensitive, and some accessory makers had weak security practices."],
  [125, 9, "Did battery testing ever show impacts from third-party connections?", "Some third-party watches drained the phone faster in testing in 2016."],
  [127, 2, "Were those watches using the same connection stack Mr. Morita described?", "No, they used older approaches.", { objection: obj(EA, "form") }],
  [131, 14, "Is the company's watch reviewed for privacy the same way?", "It goes through internal privacy review."],
  [140, 1, "(Further examination by Ms. Castell.)", "(Ms. Castell examining.)"],
  [141, 5, "Mr. Morita said the battery cost of the background entitlement is the same as for your own watch. Did anyone test that after 2017?", "Not to my knowledge.", { flags: ["admission", "key"] }],
  [142, 11, "And the 2016 testing you mentioned involved older connection methods, not the entitlement?", "Yes."],
  [145, 3, "Did privacy review ever evaluate the consent-screen proposal in your 2018 email?", "I don't believe it got that far."],
  [160, 8, "Nothing further. (Whereupon, at 3:52 p.m., the deposition was adjourned.)", "(Signature reserved.)"],
];

export function buildFreyDeposition(ix: DocIndex): Deposition {
  const { transcript, exhibits } = assemble(RAW, EXHIBITS, ix);
  return tagged<Deposition>({
    id: DEMO_DEPOSITIONS.wearables, matterId: M, witnessId: CUST.frey.id, witnessName: CUST.frey.name, witnessTitle: `${CUST.frey.title} (fictional witness)`,
    date: "2026-07-09", takenBy: TAKEN_BY, defendingBy: DEFENDED_BY, location: "Class Counsel offices (demo), Oakland, CA", volume: 1, pages: 162,
    status: "transcribed", transcript, exhibits,
    aiDigest: {
      summary: "Wearables interoperability PM. Testified battery and privacy were the only reasons for limits on third-party watches (23:8), then acknowledged his director's retention rationale and instruction to cite privacy and battery (51:4, 51:20), and adopted his own deck's statement that opening interfaces would reduce the retention advantage (81:3). Refused to withdraw the 'only reasons' answer (58:6).",
      keyAdmissions: ["Kowal's retention rationale was 'part of her thinking' (51:4).", "Cited privacy and battery to Pulsewear as instructed (51:20).", "Deck: opening interfaces would reduce the retention advantage (81:3).", "No battery test of the entitlement after 2017 (141:5)."],
      themes: ["Smartwatch interoperability", "Stated vs. actual rationale", "Retention"],
      credibilityNotes: ["Stood by 'only reasons' after Frey-6 (58:6–58:21)."],
      followUps: ["Depose Beatrice Kowal.", "Depose Kenji Morita on the 2017 estimate.", "Request 2016 battery test data referenced at 125:9."],
    },
  });
}
