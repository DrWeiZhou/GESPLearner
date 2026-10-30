"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CoinsIcon, Loader2Icon, MinusCircleIcon } from "lucide-react";
import { toast } from "sonner";
import { LevelBadge } from "@/components/common/level-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { postJSON } from "@/lib/api";
import type { CoinTransaction, RedeemableAttempt } from "@/lib/coins";
import { formatExamId } from "@/lib/format";
import { cn } from "@/lib/utils";

const TYPE_LABEL = { earn: "试卷兑换", spend: "扣除", adjust: "管理员调整" } as const;

export function CoinWallet({
  balance,
  rate,
  redeemable,
  ledger,
}: {
  balance: number;
  rate: number;
  redeemable: RedeemableAttempt[];
  ledger: CoinTransaction[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  const redeem = async (attemptId: string) => {
    setPending(attemptId);
    try {
      const r = await postJSON<{ coins: number; balance: number }>("/api/coins/redeem", { attemptId });
      toast.success(`兑换成功，获得 ${r.coins} 枚金币`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "兑换失败");
    } finally {
      setPending(null);
    }
  };

  const spend = async () => {
    const n = Number(amount);
    if (!Number.isInteger(n) || n <= 0) return toast.error("请输入正整数");
    setPending("spend");
    try {
      const r = await postJSON<{ balance: number }>("/api/coins/spend", { amount: n, note: note || undefined });
      toast.success(`已扣除 ${n} 枚金币，剩余 ${r.balance} 枚`);
      setAmount("");
      setNote("");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "扣除失败");
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="py-8 text-center">
          <CoinsIcon className="mx-auto size-9 text-amber-500" />
          <div className="mt-3 text-5xl font-bold tabular-nums">{balance}</div>
          <p className="mt-2 text-sm text-muted-foreground">
            枚金币　·　当前兑换比例：每 1 分 = {rate} 枚
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">可兑换的试卷</CardTitle>
        </CardHeader>
        <CardContent>
          {redeemable.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              暂无可兑换的试卷。完成一次模拟考试并交卷后，就能把得分换成金币（每份试卷限一次）。
            </p>
          ) : (
            <ul className="divide-y">
              {redeemable.map((a) => (
                <li key={a.attemptId} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                  <LevelBadge level={a.level} />
                  <span>{formatExamId(a.examId)}</span>
                  <span className="text-muted-foreground tabular-nums">
                    {a.score}/{a.maxScore} 分
                  </span>
                  <span className="ml-auto font-medium text-amber-600 tabular-nums">+{a.coins} 金币</span>
                  <Button size="sm" disabled={pending !== null || a.coins <= 0} onClick={() => redeem(a.attemptId)}>
                    {pending === a.attemptId && <Loader2Icon className="animate-spin" />}
                    {a.coins > 0 ? "兑换" : "不足 1 枚"}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">扣除金币</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">用金币兑换奖励后，在这里扣除相应数量。</p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="coin-amount">数量</Label>
              <Input
                id="coin-amount"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
                inputMode="numeric"
                placeholder="10"
                className="w-24"
              />
            </div>
            <div className="min-w-48 flex-1 space-y-1.5">
              <Label htmlFor="coin-note">备注（可选）</Label>
              <Input
                id="coin-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="例如：兑换一次游乐园"
                maxLength={100}
              />
            </div>
            <Button variant="outline" disabled={pending !== null || !amount} onClick={spend}>
              {pending === "spend" ? <Loader2Icon className="animate-spin" /> : <MinusCircleIcon />}
              扣除
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">金币明细</CardTitle>
        </CardHeader>
        <CardContent>
          {ledger.length === 0 ? (
            <p className="text-sm text-muted-foreground">还没有任何记录。</p>
          ) : (
            <ul className="divide-y">
              {ledger.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                  <span className="rounded-md bg-muted px-2 py-0.5 text-xs">{TYPE_LABEL[t.type]}</span>
                  {t.level !== null && t.examId !== null && (
                    <span className="text-muted-foreground">
                      {formatExamId(t.examId)} {t.level} 级
                    </span>
                  )}
                  {t.note && <span className="text-muted-foreground">{t.note}</span>}
                  <span
                    className={cn(
                      "ml-auto font-medium tabular-nums",
                      t.amount > 0 ? "text-emerald-600" : "text-rose-600",
                    )}
                  >
                    {t.amount > 0 ? "+" : ""}
                    {t.amount}
                  </span>
                  <span className="w-24 text-right text-xs text-muted-foreground">
                    {new Date(t.createdAt).toLocaleDateString("zh-CN")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
