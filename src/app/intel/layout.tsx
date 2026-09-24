import * as React from "react";
import { IntelNav } from "@/modules/intel/components/intel-nav";

/**
 * /intel shell: the section navigation under the 44px top bar, then the page.
 * Each page renders its own PageTopbar (title + context) and owns its scroll.
 */
export default function IntelLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <IntelNav />
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
