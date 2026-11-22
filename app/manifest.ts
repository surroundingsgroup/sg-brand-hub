import type { MetadataRoute } from "next";

// Lets Surroundings be added to a phone's home screen and launch full-screen,
// like a native app.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Surroundings",
    short_name: "Surroundings",
    description: "The Surroundings Group workspace: your clients, your team, your processes.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f4f3f0",
    theme_color: "#ffffff",
    icons: [
      { src: "/pwa-icon/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/pwa-icon/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/pwa-icon/512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
