import { PageHeader, EmptyState } from "@/components/ui/misc";
import { Construction } from "lucide-react";

export default function Page() {
  return (
    <div className="h-full overflow-auto p-6 space-y-6">
      <PageHeader title="Library" description="Shared folders, templates, clause bank and knowledge." />
      <EmptyState icon={Construction} title="Library module is being assembled" description="This route is a placeholder from the platform foundation." />
    </div>
  );
}
