import type { Metadata } from "next";
import { Suspense } from "react";
import { AISettingsForm } from "@/components/admin/ai-settings-form";
import { CoinRateForm } from "@/components/admin/coin-rate-form";
import { PaperUpdateCard } from "@/components/admin/paper-update-card";
import { SyllabusUpdateCard } from "@/components/admin/syllabus-card";
import { UserTable } from "@/components/admin/user-table";
import { RequireLogin } from "@/components/common/require-login";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getCurrentUser } from "@/lib/auth";
import { getAISettingsView } from "@/lib/ai/settings";
import { getCoinRate } from "@/lib/coins";
import { listUsers } from "@/lib/admin";
import { importedSyllabusLevels } from "@/lib/syllabus/content";
import { connection } from "next/server";

export const metadata: Metadata = { title: "系统设置" };

export default function AdminPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10">
      <h1 className="mb-6 text-2xl font-bold">系统设置</h1>
      <Suspense fallback={<Skeleton className="h-48 w-full" />}>
        <Settings />
      </Suspense>
    </div>
  );
}

async function Settings() {
  // These reads are per-request and hit the database. Without this the prerender
  // pass tries to run them and trips on the driver's internal clock reads, leaving
  // the Suspense boundary unresolved until the function times out.
  await connection();
  const user = await getCurrentUser();

  if (!user) return <RequireLogin next="/admin" />;
  if (user.role !== "admin") {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          需要管理员权限。系统中注册的第一个账号即为管理员。
        </CardContent>
      </Card>
    );
  }
  // Sequential — see the note in app/coins/page.tsx.
  const rate = await getCoinRate();
  const ai = await getAISettingsView();
  const syllabi = await importedSyllabusLevels();
  const users = await listUsers();
  return (
    <div className="space-y-6">
      <PaperUpdateCard />
      <SyllabusUpdateCard imported={syllabi.map((s) => ({ level: s.level, points: s.points }))} />
      <CoinRateForm rate={rate} />
      <AISettingsForm settings={ai} />
      <UserTable users={users} currentUserId={user.id} />
    </div>
  );
}
