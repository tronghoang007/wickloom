import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Wickloom",
  description: "Personal charting platform",
  // iPhone "Thêm vào MH chính": mở toàn màn, thanh trạng thái trong suốt (nội dung tự chừa chỗ bằng safe-area ở page.tsx)
  appleWebApp: { capable: true, title: "Wickloom", statusBarStyle: "black-translucent" },
};

// viewportFit "cover": trên điện thoại có tai thỏ / thanh home, trang vẽ tràn hết màn và tự chừa chỗ bằng
// env(safe-area-inset-*) ở page.tsx (desktop các giá trị này bằng 0, không đổi gì).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#1a1a1a", // thanh trạng thái / thanh địa chỉ trên điện thoại cùng màu nền trang tối
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
