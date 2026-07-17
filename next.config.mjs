/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Keep heavy document parsers out of the bundler; they load at runtime.
  serverExternalPackages: ["pdfjs-dist", "mammoth", "xlsx"],
};

export default nextConfig;
