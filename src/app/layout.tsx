import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
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
  title: "SVG to STEP",
  description: "Convert SVG artwork into 2D STEP curves and faces for Plasticity and other CAD tools.",
};

// Apply the saved appearance before first paint. "system" follows the OS.
const themeScript = `(() => {
  const KEY = "svg2step:appearance";
  const m = window.matchMedia("(prefers-color-scheme: dark)");
  const mode = () => {
    try {
      const v = localStorage.getItem(KEY);
      if (v === "light" || v === "dark" || v === "system") return v;
    } catch (e) {}
    return "system";
  };
  const apply = () => {
    const chosen = mode();
    const dark = chosen === "dark" || (chosen !== "light" && m.matches);
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.dataset.appearance = chosen;
  };
  apply();
  m.addEventListener("change", apply);
})();`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-full flex flex-col">
        <TooltipProvider>{children}</TooltipProvider>
      </body>
    </html>
  );
}
