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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
