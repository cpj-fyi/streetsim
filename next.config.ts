import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // fixtures/ and .cache/ are read with fs at request time, not imported, so
  // serverless bundling only ships them if traced explicitly. Without this
  // the deployed app has no fixture blocks and no warm cache.
  outputFileTracingIncludes: {
    "/**": ["./fixtures/*.json", "./block-cache/block_scenes/*.json"],
  },
};

export default nextConfig;
