"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CoinsIcon, Loader2Icon, MinusCircleIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { postJSON } from "@/lib/api";
import type { CoinTransaction } from "@/lib/coins";
import { formatExamId } from "@/lib/format";
import { cn } from "@/lib/utils";

const TYPE_LABEL = { reward: "做题奖励", spend: "扣除", adjust: "管理员调整", earn: "试卷兑换" } as const;

export function CoinWallet({
  balance,
  carry,
  rate,
  ledger,
}: {
  balance: number;
  /** Fraction of a coin saved up but not yet credited. */
  carry: number;
  rate: number;
  ledger: CoinTransaction[];
}) {
  const router = useRouter();
  const [spending, setSpending] = useState(false);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  const spend = async () => {
    const n = Number(amount);
    if (!Number.isInteger(n) || n <= 0) return toast.error("请输入正整数");
    setSpending(true);
    try {
      const r = await postJSON<{ balance: number }>("/api/coins/spend", { amount: n, note: note || undefined });
      toast.success(`已扣除 ${n} 枚金币，剩余 ${r.balance} 枚`);
      setAmount("");
      setNote("");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "扣除失败");
    } finally {
      setSpending(false);
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
          {carry > 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              另有 {carry} 枚零头正在累计，攒满 1 枚会自动入账
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">怎么拿金币</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5 text-sm text-muted-foreground">
          <p>· 客观题答对、编程题通过测试点，都会按本题得分 × {rate} 立刻发金币。</p>
          <p>· 一道题只结算一次：重做、或者在错题本里再做一遍，都不会再发金币。</p>
          <p>· 编程题按<b>第一次提交</b>的得分结算，提交前先用「自测运行」试一试。</p>
          <p>· 不满 1 枚的零头会先攒起来，攒满 1 枚自动入账。</p>
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
            <Button variant="outline" disabled={spending || !amount} onClick={spend}>
              {spending ? <Loader2Icon className="animate-spin" /> : <MinusCircleIcon />}
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
