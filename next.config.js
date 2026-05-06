/** @type {import('next').NextConfig} */
const normalizePrefix = (value) => {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed === "/") return undefined;
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
};

const normalizeBasePath = (value) => {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed === "/") return undefined;
  if (!trimmed.startsWith("/")) return `/${trimmed}`;
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
};

const assetPrefix = normalizePrefix(
  process.env.NEXT_PUBLIC_ASSET_PREFIX ?? process.env.ASSET_PREFIX
);
const basePath = normalizeBasePath(
  process.env.NEXT_PUBLIC_BASE_PATH ?? process.env.BASE_PATH
);

const nextConfig = {
  ...(assetPrefix ? { assetPrefix } : {}),
  ...(basePath ? { basePath } : {}),
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
      {
        protocol: 'https',
        hostname: 'api.qrserver.com',
      },
    ],
  },
};

module.exports = nextConfig;
