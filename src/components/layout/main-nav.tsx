"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense } from "react";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/papers", label: "真题库" },
  { href: "/syllabus", label: "考试大纲" },
  { href: "/wrong-book", label: "错题本" },
  { href: "/dashboard", label: "学习报告" },
];

export function MainNav() {
  // usePathname suspends while the static shell is prerendered for routes with
  // dynamic params, so links render unhighlighted first and light up on hydration.
  return (
    <Suspense fallback={<NavLinks activePath="" />}>
      <ActiveNavLinks />
    </Suspense>
  );
}

function ActiveNavLinks() {
  return <NavLinks activePath={usePathname()} />;
}

function NavLinks({ activePath }: { activePath: string }) {
  return (
    <nav className="flex items-center gap-1 text-sm">
      {ITEMS.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={cn(
            "rounded-md px-3 py-1.5 text-muted-foreground transition-colors hover:text-foreground",
            activePath.startsWith(item.href) && "bg-muted font-medium text-foreground",
          )}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
