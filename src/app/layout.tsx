import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppShell } from "@/components/shell/app-shell";
import { ThemeProvider } from "@/components/shell/theme-provider";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

const appName = process.env.NEXT_PUBLIC_APP_NAME ?? "LeClaude";
const firmName = process.env.NEXT_PUBLIC_FIRM_NAME ?? "Calloway & Reyes LLP";

export const metadata: Metadata = {
  title: { default: appName, template: `%s · ${appName}` },
  description: `${firmName} internal legal AI platform: research, e-discovery, workflows and an AI-native office suite.`,
  applicationName: appName,
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbfaf8" },
    { media: "(prefers-color-scheme: dark)", color: "#16171d" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
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
            <AppShell appName={appName} firmName={firmName}>{children}</AppShell>
            <Toaster position="bottom-right" richColors closeButton toastOptions={{ className: "font-sans" }} />
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
