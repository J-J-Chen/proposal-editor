import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep the ~10MB mupdf WASM out of the bundle; load it from node_modules at runtime (Node route).
  serverExternalPackages: ["mupdf"],
  // If the deployed function 500s on a missing .wasm, trace it in explicitly:
  // outputFileTracingIncludes: { "/api/parse": ["./node_modules/mupdf/dist/*.wasm"] },
};

export default nextConfig;
