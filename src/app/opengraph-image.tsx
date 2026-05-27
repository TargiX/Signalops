import { ImageResponse } from "next/og";

export const size = {
  width: 1200,
  height: 630,
};

export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: "#FAFAF8",
          color: "#1F2230",
          fontFamily: "Inter, Arial, sans-serif",
          padding: 56,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            border: "1px solid #E7E5E0",
            borderRadius: 18,
            background: "#fff",
            padding: 28,
            boxShadow: "0 8px 24px rgba(20,20,30,0.08)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: 14,
                background: "#E0E0FA",
                color: "#4338CA",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 28,
                fontWeight: 700,
              }}
            >
              S
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: -1 }}>
                SignalOps
              </div>
              <div style={{ fontSize: 18, color: "#5A5E70" }}>
                AI generation operations cockpit
              </div>
            </div>
          </div>
          <div
            style={{
              display: "flex",
              padding: "8px 14px",
              borderRadius: 999,
              background: "#E0E0FA",
              color: "#4338CA",
              fontSize: 16,
              fontWeight: 600,
            }}
          >
            React + TanStack
          </div>
        </div>

        <div style={{ display: "flex", gap: 20, marginTop: 26 }}>
          {[
            ["10,000", "generation rows"],
            ["20", "virtual rows mounted"],
            ["3", "saved ops views"],
            ["Rules", "simulated routing"],
          ].map(([value, label]) => (
            <div
              key={label}
              style={{
                flex: 1,
                minHeight: 128,
                border: "1px solid #E7E5E0",
                borderRadius: 16,
                background: "#fff",
                padding: 22,
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
              }}
            >
              <div style={{ fontSize: 40, fontWeight: 700, letterSpacing: -1 }}>
                {value}
              </div>
              <div
                style={{
                  fontSize: 16,
                  color: "#878B9D",
                  textTransform: "uppercase",
                  letterSpacing: 1.2,
                }}
              >
                {label}
              </div>
            </div>
          ))}
        </div>

        <div
          style={{
            marginTop: 26,
            flex: 1,
            display: "flex",
            gap: 20,
          }}
        >
          <div
            style={{
              flex: 1.5,
              border: "1px solid #E7E5E0",
              borderRadius: 16,
              background: "#fff",
              padding: 26,
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
            }}
          >
            <div style={{ fontSize: 18, fontWeight: 700 }}>Incident triage + provider risk</div>
            <div style={{ display: "flex", gap: 10, alignItems: "flex-end", height: 120 }}>
              {[80, 58, 70, 42, 88, 51, 64, 72, 45, 92, 66, 38].map((height, index) => (
                <div
                  key={index}
                  style={{
                    flex: 1,
                    height,
                    borderRadius: 5,
                    background:
                      index % 4 === 0
                        ? "#F7E0DD"
                        : index % 3 === 0
                          ? "#F5EBD3"
                          : "#DFF1E7",
                  }}
                />
              ))}
            </div>
          </div>
          <div
            style={{
              flex: 1,
              border: "1px solid #E7E5E0",
              borderRadius: 16,
              background: "#fff",
              padding: 26,
              display: "flex",
              flexDirection: "column",
              gap: 14,
            }}
          >
            <div style={{ fontSize: 18, fontWeight: 700 }}>Custom virtualized grid</div>
            {[1, 2, 3, 4].map((row) => (
              <div
                key={row}
                style={{
                  height: 34,
                  borderRadius: 8,
                  background: row % 2 ? "#F4F3F0" : "#fff",
                  border: "1px solid #EFEDE9",
                }}
              />
            ))}
          </div>
        </div>
      </div>
    ),
    size,
  );
}
