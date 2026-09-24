"use client";
/**
 * Placeholder analysis tabs. The analysis agent replaces this module; the
 * prop contract is fixed: { matterId: string; onOpenDocument?: (docId: string) => void }.
 */
import { createElement, type ReactElement } from "react";
import { Activity, GitBranch, Network, ScrollText, Users } from "lucide-react";
import { EmptyState } from "@/components/ui/misc";

export interface AnalysisTabProps {
  matterId: string;
  onOpenDocument?: (docId: string) => void;
}

function placeholder(title: string, description: string, icon: typeof Activity) {
  const Tab = ({ matterId }: AnalysisTabProps): ReactElement =>
    createElement(
      "div",
      { className: "flex h-full items-center justify-center p-8" },
      createElement(EmptyState, { icon, title, description: `${description} (matter ${matterId})`, className: "max-w-md" }),
    );
  Tab.displayName = title.replace(/\s+/g, "");
  return Tab;
}

export const DepositionsTab = placeholder("Depositions coming online", "Transcript viewer, AI digests, key admissions and exhibit links are being assembled.", ScrollText);
export const CrossAnalysisTab = placeholder("Cross-analysis coming online", "Testimony-versus-document comparison and contradiction finder are being assembled.", GitBranch);
export const TimelineTab = placeholder("Timeline coming online", "The matter chronology with sourced events is being assembled.", Activity);
export const PeopleGraphTab = placeholder("People & graph coming online", "Custodian relationship graph and communication analysis are being assembled.", Network);
export const ConflictsTab = placeholder("Conflicts coming online", "Detected inconsistencies between testimony and documents are being assembled.", Users);
