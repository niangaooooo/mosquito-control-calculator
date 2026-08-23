import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  basePath: "/mosquito",
  trailingSlash: true,
};

export default nextConfig;
