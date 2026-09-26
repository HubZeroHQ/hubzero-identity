import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return { name: "HubZero Account", short_name: "HubZero", start_url: "/", display: "standalone", background_color: "#0d0d0d", theme_color: "#0d0d0d", icons: [{ src: "/brand/hubzero-app-icon.png", sizes: "800x800", type: "image/png" }] };
}
