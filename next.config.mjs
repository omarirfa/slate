/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
};
export default nextConfig;

// `next dev` uses the in-process store; the Durable Object is exercised by
// `npm run cf:preview` (Cloudflare's local runtime) and in production.
