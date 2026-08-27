import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep the ~10MB mupdf WASM out of the bundle; load it from node_modules at runtime (Node route).
  serverExternalPackages: ["mupdf"],
  // Each serverless function traces + bundles its own copy of the .wasm. Trace it into EVERY
  // mupdf-using route explicitly so a missed auto-trace can't 500 at runtime on a missing .wasm
  // (parse works today via auto-tracing; the new page-render route is the reason this is enabled).
  outputFileTracingIncludes: {
    "/api/parse": ["./node_modules/mupdf/dist/*.wasm"],
    "/api/page/[hash]/[n]": ["./node_modules/mupdf/dist/*.wasm"],
  },
};

export default nextConfig;
