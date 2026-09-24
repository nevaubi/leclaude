import type { Person } from "@/lib/types/domain";

/** External people referenced in seeded email headers and testimony (stable ids). */
export const EXTRA_PEOPLE_IDS = {
  merrick: "x_afff_pmerrick",
  liu: "x_afff_kliu",
  ferris: "x_afff_dferris",
  whitcomb: "x_afff_dwhitcomb",
  rourke: "x_afff_jrourke",
  ferrante: "x_afff_lferrante",
  duffy: "x_afff_rduffy",
  feld: "x_afff_mfeld",
  nunez: "x_afff_cnunez",
  bello: "x_afff_ybello",
} as const;

const X = EXTRA_PEOPLE_IDS;

export const EXTRA_PEOPLE: Person[] = [
  { id: X.merrick, name: "Paul Merrick", title: "SVP Operations", organization: "Meridian Fluorochem Corp.", role: "witness", tags: ["non-custodian"] },
  { id: X.liu, name: "Karen Liu", title: "Director of Marketing, Fire Suppression", organization: "Meridian Fluorochem Corp.", role: "witness", tags: ["non-custodian"] },
  { id: X.ferris, name: "Douglas Ferris", title: "Chief Executive Officer (2001)", organization: "Meridian Fluorochem Corp.", role: "witness", tags: ["non-custodian"] },
  { id: X.whitcomb, name: "Cmdr. Dale Whitcomb", title: "NAVSEA qualification program", organization: "U.S. Navy (NAVSEA)", role: "other" },
  { id: X.rourke, name: "Janet Rourke", title: "Bureau of Water", organization: "Illinois EPA", role: "other" },
  { id: X.ferrante, name: "Lisa Ferrante", title: "Director, Water Management Services", organization: "City of Decatur", role: "other" },
  { id: X.duffy, name: "Chief Raymond Duffy", title: "Fire Chief", organization: "Macon County Fire Protection District", role: "other" },
  { id: X.feld, name: "Marcus Feld", title: "Office of Pollution Prevention and Toxics", organization: "U.S. EPA", role: "other" },
  { id: X.nunez, name: "Carla Nunez", title: "Project hydrogeologist", organization: "Beacon Environmental", role: "other" },
  { id: X.bello, name: "Dr. Yusuf Bello", title: "Study pathologist", organization: "Whitfield Laboratories", role: "expert" },
];
