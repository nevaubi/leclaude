import { PageHeader, EmptyState } from "@/components/ui/misc";
import { Construction } from "lucide-react";

export default function Page() {
  return (
    <div className="h-full overflow-auto p-6 space-y-6">
      <PageHeader title="Office" description="Documents, workbooks, decks and PDFs with drafting agents." />
      <EmptyState icon={Construction} title="Office module is being assembled" description="This route is a placeholder from the platform foundation." />
    </div>
  );
}
