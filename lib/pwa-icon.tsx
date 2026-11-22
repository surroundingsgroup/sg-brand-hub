import { ImageResponse } from "next/og";

// One drawing for every app-icon size: charcoal tile, ivory "S" (Surroundings),
// amber rule (SG brand kit: #0F0F0F / #F7F4F0 / #FFBD83). Content stays inside
// the middle ~60% so Android's maskable crop never clips it.
export function hubIcon(size: number): ImageResponse {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#0F0F0F",
        }}
      >
        <div
          style={{
            display: "flex",
            color: "#F7F4F0",
            fontSize: size * 0.52,
            fontWeight: 700,
            lineHeight: 1,
          }}
        >
          S
        </div>
        <div style={{ display: "flex", width: size * 0.3, height: Math.max(2, size * 0.035), marginTop: size * 0.03, borderRadius: size, background: "#FFBD83" }} />
      </div>
    ),
    { width: size, height: size }
  );
}
