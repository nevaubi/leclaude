import Link from "next/link";
import { FileQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground"><FileQuestion className="size-6" /></div>
      <h1 className="text-lg font-semibold">Page not found</h1>
      <p className="max-w-sm text-sm text-muted-foreground">The page or document you are looking for does not exist or was moved.</p>
      <Button asChild variant="outline"><Link href="/">Back to Home</Link></Button>
    </div>
  );
}
