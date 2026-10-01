/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
          // Telegram Web embeds Mini Apps in an iframe, so framing is limited to Telegram instead of denied.
          {
            key: 'Content-Security-Policy-Report-Only',
            value:
              "default-src 'self'; script-src 'self' 'unsafe-inline' https://telegram.org; img-src 'self' data: blob: https://raw.githubusercontent.com; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'self' https://web.telegram.org https://*.telegram.org",
          },
        ],
      },
    ]
  },
}

export default nextConfig
