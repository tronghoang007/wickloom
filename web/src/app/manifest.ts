import type { MetadataRoute } from "next";

// PWA (docs/mobile-responsive-plan.md M7): "Thêm vào màn hình chính" mở Wickloom toàn màn như một app. Không có service worker / cache
// offline: giá và lệnh luôn phải lấy trực tiếp từ backend. Màu nền / thanh trạng thái theo nền trang tối (--page).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Wickloom",
    short_name: "Wickloom",
    description: "Personal charting platform",
    start_url: "/",
    display: "standalone",
    background_color: "#1a1a1a",
    theme_color: "#1a1a1a",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
