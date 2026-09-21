import "./globals.css";
export const metadata = {
  title: "Lager iPhone",
  description: "Lager iPhone — inventory, market prices and sales management",
};
export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
