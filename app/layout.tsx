import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ProfitPlate | Restaurant Management Intelligence System",
  description:
    "ProfitPlate acts as your automated restaurant CFO, converting raw operational numbers into immediate profitability decisions, protecting menu margins from active inflation.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full scroll-smooth antialiased dark">
      <body className="min-h-full flex flex-col bg-background text-foreground">
        {children}
      </body>
    </html>
  );
}