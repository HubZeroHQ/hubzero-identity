import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return { name: "HubZero Account", short_name: "HubZero", start_url: "/", display: "standalone", background_color: "#fbfbfa", theme_color: "#1b2027" };
}
