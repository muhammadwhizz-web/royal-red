import type { NextConfig } from 'next'

// ROYAL RED (Phase A): standalone output so `bun run build` emits a
// self-contained server (the build and start scripts already expect it) and
// the Docker image can ship a small runtime. Dev is unaffected.
const nextConfig: NextConfig = {
  output: 'standalone',
  // the Prisma engine and the z-ai sdk must not be bundled
  serverExternalPackages: ['@prisma/client', 'prisma', 'z-ai-web-dev-sdk'],
}

export default nextConfig
