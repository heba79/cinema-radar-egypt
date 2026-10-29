import type { Metadata, Viewport } from "next";
import { Inter, Noto_Kufi_Arabic, Outfit } from "next/font/google";
import { Nav } from "@/components/nav";
import { ServiceWorkerRegister } from "@/components/pwa";
import { currentUser } from "@/lib/auth";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const display = Outfit({ subsets: ["latin"], variable: "--font-display", weight: ["600", "700", "800"] });
const arabic = Noto_Kufi_Arabic({ subsets: ["arabic"], variable: "--font-arabic" });

export const metadata: Metadata = {
  title: { default: "Cinema Radar Egypt", template: "%s · Cinema Radar Egypt" },
  description: "Know the moment tickets go on sale at Egyptian cinemas.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Cinema Radar", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = { themeColor: "#09090b", width: "device-width", initialScale: 1, viewportFit: "cover" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser().catch(() => null);
  return (
    <html lang="en" className={`${inter.variable} ${display.variable} ${arabic.variable}`}>
      <body className="min-h-screen pb-20 md:pb-0">
        <ServiceWorkerRegister />
        <Nav user={user} />
        <main className="mx-auto max-w-6xl px-4 py-6 sm:py-10">{children}</main>
        <footer className="mx-auto max-w-6xl px-4 pb-10 text-xs text-zinc-600">
          Showtimes from elCinema.com · Metadata from TMDB (this product uses the TMDB API but is not endorsed or certified by TMDB). Always confirm on
          the cinema&apos;s official booking page.
        </footer>
      </body>
    </html>
  );
}
