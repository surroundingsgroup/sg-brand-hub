import { hubIcon } from "@/lib/pwa-icon";

// PNG app icons for the web manifest: /pwa-icon/192, /pwa-icon/512.
export function GET(_req: Request, { params }: { params: { size: string } }) {
  const size = params.size === "192" ? 192 : 512;
  return hubIcon(size);
}
