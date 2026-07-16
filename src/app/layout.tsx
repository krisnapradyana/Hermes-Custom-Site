import type { Metadata } from "next";
import "./globals.css";
import { Sidebar } from "@/components/Sidebar";

export const metadata: Metadata = {
  title: "Hermes",
  description: "Hermes agent interface — chat, projects, artifacts and scheduled jobs.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">
        <div className="flex h-screen overflow-hidden">
          <Sidebar />
          <main className="flex-1 min-w-0 overflow-y-auto">{children}</main>
        </div>
      </body>
    </html>
  );
}
