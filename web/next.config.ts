import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  allowedDevOrigins: ["127.0.0.1"], // mở app bằng http://127.0.0.1:3000 (cookie phiên theo host, xem lib/api.ts) vẫn nạp được tài nguyên dev
  devIndicators: false, // ẩn nút "N" góc dưới trái khi chạy dev (lỗi compile/runtime vẫn hiện)
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
