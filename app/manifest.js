export default function manifest() {
  return {
    name: "Lager iPhone",
    short_name: "Lager iPhone",
    description: "Inventory, pricing, operations and sales for Lager iPhone",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#f3f6f5",
    theme_color: "#153e35",
    categories: ["business", "productivity"],
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any maskable",
      },
    ],
  };
}
