import type { Metadata } from "next";
import { headers } from "next/headers";
import "@fontsource-variable/plus-jakarta-sans";
import "./globals.css";
import { Sidebar } from "@/components/Sidebar";
import { Providers, AuthGate, PublicRouteSwitch } from "@/components/Providers";
import { StatusBar } from "@/components/StatusBar";
import { UpdateGuard } from "@/components/UpdateGuard";

export const metadata: Metadata = {
  title: "SuperPixel Assistant",
  description: "SuperPixel Assistant — chat, projects, artifacts and scheduled jobs.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The directory subdomain serves pages bare (no sidebar/shell). The client
  // router still sees "/" there (middleware rewrites are invisible to it), so
  // PublicRouteSwitch can't detect this case — the HOST is the truth, and
  // only the server sees it before first paint.
  const host = (await headers()).get("host") ?? "";
  const bareHost = host.startsWith("directory.");
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          // Apply saved theme before paint to avoid a flash of the wrong theme.
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('hermes-theme')||'system';var d=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);if(d)document.documentElement.classList.add('dark');}catch(e){}})();`,
          }}
        />
      </head>
      <body className="antialiased">
        <Providers>
          {bareHost ? (
            children
          ) : (
            <>
          <UpdateGuard />
          <PublicRouteSwitch
            app={
              <AuthGate>
                <div className="app-canvas flex flex-col h-screen overflow-hidden">
                  <div className="flex flex-1 min-h-0">
                    <Sidebar />
                    <main className="flex-1 min-w-0 overflow-y-auto">{children}</main>
                  </div>
                  <StatusBar />
                </div>
              </AuthGate>
            }
          >
            {children}
          </PublicRouteSwitch>
            </>
          )}
        </Providers>
      </body>
    </html>
  );
}
