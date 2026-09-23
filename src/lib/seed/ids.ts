/** Stable identifiers shared across module seeds so cross-references line up. */
export const PEOPLE = {
  jordanWhitfield: "p_jwhitfield", // Partner (current user)
  priyaRaman: "p_praman", // Partner, products liability
  danielOkafor: "p_dokafor", // Senior associate
  elenaMarsh: "p_emarsh", // Associate
  samuelChen: "p_schen", // Associate
  mariaLopez: "p_mlopez", // Litigation paralegal
  tomBradley: "p_tbradley", // E-discovery project manager
  aishaKhan: "p_akhan", // Knowledge management / library
  // Client-side custodians (Meridian Fluorochem)
  gregoryHale: "c_ghale",
  helenVoss: "c_hvoss",
  nadiaBrooks: "c_nbrooks",
  alanPryce: "c_apryce",
  robertKaine: "c_rkaine",
  martinSuarez: "c_msuarez",
  // Experts / opposing
  drLindaWhitfieldTox: "x_lwhitfield",
  drRajPatelHydro: "x_rpatel",
  opposingCounselKlein: "o_klein",
  judgeGergel: "j_gergel",
} as const;

export const MATTERS = {
  afff: "m_afff_2873",
  depo: "m_depo_provera_3140",
  northgate: "m_northgate_v_apex",
  harbor: "m_project_harbor",
  sterling: "m_sterling_employment",
} as const;
