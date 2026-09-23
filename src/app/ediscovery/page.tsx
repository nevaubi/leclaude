import { PageHeader, EmptyState } from "@/components/ui/misc";
import { Construction } from "lucide-react";

export default function Page() {
  return (
    <div className="h-full overflow-auto p-6 space-y-6">
      <PageHeader title="E-Discovery" description="Review, depositions, chronologies, people graph and privilege." />
      <EmptyState icon={Construction} title="E-Discovery module is being assembled" description="This route is a placeholder from the platform foundation." />
    </div>
  );
}
