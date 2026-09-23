import { PageHeader, EmptyState } from "@/components/ui/misc";
import { Construction } from "lucide-react";

export default function Page() {
  return (
    <div className="h-full overflow-auto p-6 space-y-6">
      <PageHeader title="Home" description="News, team updates, calendar and tasks." />
      <EmptyState icon={Construction} title="Home module is being assembled" description="This route is a placeholder from the platform foundation." />
    </div>
  );
}
