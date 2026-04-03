/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  allowedDevOrigins: ['https://3000-w-metupalle-mniisa2i.cluster-g6x7qqwepzfpww4wv6o4hwxsgc.cloudworkstations.dev'],
}
module.exports = nextConfig
