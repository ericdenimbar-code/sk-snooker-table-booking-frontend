
/** @type {import('next').NextConfig} */
const nextConfig = {
  // SheetJS 僅在 server action 使用，避免被包進 RSC/edge 導致解析失敗
  serverExternalPackages: ['xlsx'],
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'placehold.co',
      },
    ],
  },
  webpack(config) {
    config.experiments = { ...config.experiments, asyncWebAssembly: true };
    return config;
  },
};

export default nextConfig;
