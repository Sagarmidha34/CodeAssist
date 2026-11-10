import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CodeAssist — Think clearly. Code confidently.",
  description: "A private AI coding workspace for thinking through requirements, code, and tests.",
  applicationName: "CodeAssist",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
