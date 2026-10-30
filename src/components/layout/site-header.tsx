import Link from "next/link";
import { Suspense } from "react";
import { CodeXmlIcon, CoinsIcon } from "lucide-react";
import { accountsEnabled, getCurrentUser } from "@/lib/auth";
import { getBalance } from "@/lib/coins";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { MainNav } from "./main-nav";
import { ThemeToggle } from "./theme-toggle";
import { UserMenu } from "./user-menu";
import { connection } from "next/server";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <CodeXmlIcon className="size-4" />
          </span>
          <span className="hidden sm:inline">GESP 备考助手</span>
        </Link>
        <MainNav />
        <div className="ml-auto flex items-center gap-1">
          <ThemeToggle />
          {accountsEnabled ? (
            <Suspense fallback={<Skeleton className="h-8 w-20" />}>
              <HeaderUser />
            </Suspense>
          ) : (
            <span className="rounded-md bg-amber-500/10 px-2 py-1 text-xs text-amber-700 dark:text-amber-400">
              演示模式
            </span>
          )}
        </div>
      </div>
    </header>
  );
}

async function HeaderUser() {
  // These reads are per-request and hit the database. Without this the prerender
  // pass tries to run them and trips on the driver's internal clock reads, leaving
  // the Suspense boundary unresolved until the function times out.
  await connection();
  const user = await getCurrentUser();

  if (!user) {
    return (
      <Link href="/login" className={buttonVariants({ size: "sm" })}>
        登录
      </Link>
    );
  }
  return (
    <>
      <Link
        href="/coins"
        className="flex items-center gap-1 rounded-md px-2 py-1 text-sm font-medium text-amber-600 transition-colors hover:bg-amber-500/10 dark:text-amber-400"
        title="我的金币"
      >
        <CoinsIcon className="size-4" />
        <span className="tabular-nums">{await getBalance(user.id)}</span>
      </Link>
      <UserMenu name={user.displayName} username={user.username} isAdmin={user.role === "admin"} />
    </>
  );
}
