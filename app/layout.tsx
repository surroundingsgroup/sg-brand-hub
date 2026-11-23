import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { Toaster } from "@/components/ui/toaster";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Surroundings",
  description: "The Surroundings Group workspace: your clients, your team, your processes.",
  // Add-to-Home-Screen: launch full-screen like an app.
  appleWebApp: { capable: true, title: "Surroundings", statusBarStyle: "default" },
  formatDetection: { telephone: false },
};

// viewport-fit=cover lets the layout run edge to edge; the shell pads itself
// with the safe-area insets. Zoom is left enabled for accessibility.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#ffffff",
};

const THEME_SCRIPT = `(function(){try{if(/^\\/(intake|thanks|share|login)(\\/|$)/.test(location.pathname))return;if(localStorage.getItem("sg-theme")==="dark")document.documentElement.classList.add("dark")}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        {/* Apply the saved dark theme before the page paints. Team pages only:
            client-facing pages (intake, share links, sign-in) stay light. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
