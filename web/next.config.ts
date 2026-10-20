import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
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
