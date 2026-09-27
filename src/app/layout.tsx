import { pageDb } from "@/lib/db/request";
import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppShell } from "@/components/shell/app-shell";
import { ThemeProvider } from "@/components/shell/theme-provider";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SetupGate } from "@/modules/workspace/components/setup-gate";
import { workspaceView } from "@/modules/workspace/service";
import type { WorkspaceView } from "@/modules/workspace/roles";

const appName = process.env.NEXT_PUBLIC_APP_NAME?.trim() || "LeClaude";
const envFirmName = process.env.NEXT_PUBLIC_FIRM_NAME?.trim() || "Your firm";

// The shell reads the workspace (firm, owner) from the database on every request.
export const dynamic = "force-dynamic";

/** The workspace for the shell; an unreadable or empty database renders the setup state instead of crashing. */
function readWorkspace(): WorkspaceView {
  try {
    return workspaceView();
  } catch (e) {
    console.error("[layout] could not read the workspace", (e as Error).message);
    return { configured: false, firmName: envFirmName, owner: null };
  }
}

export function generateMetadata(): Metadata {
  const { firmName } = readWorkspace();
  return {
    title: { default: appName, template: `%s · ${appName}` },
    description: `${firmName || envFirmName} internal legal AI platform: research, intelligence, e-discovery, workflows and an AI-native office suite.`,
    applicationName: appName,
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#121212" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await pageDb();
  const ws = readWorkspace();
  const firmName = ws.firmName || envFirmName;
  const user = ws.owner ? { id: ws.owner.id, name: ws.owner.name, email: ws.owner.email, role: ws.owner.title || ws.owner.firmRole || undefined } : undefined;
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          // Apply the persisted theme before paint to avoid a flash.
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('leclaude:theme');var d=t==='dark'||(!t||t==='system')&&window.matchMedia('(prefers-color-scheme: dark)').matches;if(d)document.documentElement.classList.add('dark');}catch(e){}})();`,
          }}
        />
      </head>
      <body className="h-full overflow-hidden">
        <ThemeProvider>
          <TooltipProvider delayDuration={250}>
            {ws.configured && user ? (
              <AppShell appName={appName} firmName={firmName} user={user}>{children}</AppShell>
            ) : (
              // Before first-run setup there is no identity to show: render full-page and send every route to /setup.
              <SetupGate configured={false}>{children}</SetupGate>
            )}
            <Toaster position="bottom-right" closeButton toastOptions={{ className: "font-sans text-[12.5px]" }} />
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
