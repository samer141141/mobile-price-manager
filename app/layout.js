import "./globals.css";
import PwaRegister from "../components/pwa-register";

export const metadata = {
  title: "Lager iPhone",
  description: "Lager iPhone — inventory, market prices and sales management",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/icon.svg",
    apple: "/icon.svg",
  },
  appleWebApp: {
    capable: true,
    title: "Lager iPhone",
    statusBarStyle: "default",
  },
};

export const viewport = {
  themeColor: "#153e35",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {children}
        <PwaRegister />
      </body>
    </html>
  );
}
