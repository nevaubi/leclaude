"use client";
/**
 * E-discovery analysis tabs. The prop contract is fixed by review-page.tsx:
 * { matterId: string; onOpenDocument?: (docId: string) => void }.
 */
export type { AnalysisTabProps } from "./types";
export { DepositionsTab } from "./components/depositions-tab";
export { CrossAnalysisTab } from "./components/cross-tab";
export { TimelineTab } from "./components/timeline-tab";
export { PeopleGraphTab } from "./components/people-tab";
export { ConflictsTab } from "./components/conflicts-tab";
