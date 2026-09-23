import { PageHeader, EmptyState } from "@/components/ui/misc";
import { Construction } from "lucide-react";

export default function Page() {
  return (
    <div className="h-full overflow-auto p-6 space-y-6">
      <PageHeader title="Search" description="Case law, statutes, regulations, dockets and internal knowledge." />
      <EmptyState icon={Construction} title="Search module is being assembled" description="This route is a placeholder from the platform foundation." />
    </div>
  );
}
