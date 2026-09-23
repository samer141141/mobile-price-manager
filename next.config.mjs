/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    TRADERA_APP_ID: process.env.TRADERA_APP_ID,
    TRADERA_APP_KEY: process.env.TRADERA_APP_KEY,
    PRISJAKT_CLIENT_ID: process.env.PRISJAKT_CLIENT_ID,
    PRISJAKT_CLIENT_SECRET: process.env.PRISJAKT_CLIENT_SECRET,
    PRISJAKT_REF_ID: process.env.PRISJAKT_REF_ID,
  },
};

export default nextConfig;
