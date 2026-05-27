import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Personal Stock Tracker",
  description: "A focused portfolio dashboard for personal investing.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const themeScript = `
    (() => {
      let saved = null;
      try {
        saved = localStorage.getItem("theme");
      } catch {}
      const theme = saved === "dark" || saved === "light"
        ? saved
        : (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
      document.documentElement.dataset.theme = theme;
      document.documentElement.style.colorScheme = theme;
    })();
  `;

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
