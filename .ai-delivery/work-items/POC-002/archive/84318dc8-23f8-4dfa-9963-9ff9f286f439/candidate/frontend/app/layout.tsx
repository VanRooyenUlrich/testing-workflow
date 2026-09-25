import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Issue Tracker",
  description: "A lightweight issue tracking proof of concept.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <div className="shell header-content">
            <Link className="site-title" href="/">
              Issue Tracker
            </Link>
            <nav aria-label="Primary navigation">
              <Link className="nav-link" href="/" aria-current="page">
                Home
              </Link>
            </nav>
          </div>
        </header>
        <main className="shell main-content" id="main-content">
          {children}
        </main>
      </body>
    </html>
  );
}