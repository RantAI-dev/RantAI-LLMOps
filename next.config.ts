import type { NextConfig } from "next";
import path from "path";
import { fileURLToPath } from "url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  output: "standalone",
  // Turbopack disabled in Docker builds (DOCKER_BUILD=1) — standalone output not generated with turbopack+NFT warning
  ...(process.env.DOCKER_BUILD !== "1" && {
    turbopack: {
      root: projectRoot,
    },
  }),
};

export default nextConfig;
