"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2Icon, SaveIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { postJSON } from "@/lib/api";

export function CoinRateForm({ rate }: { rate: number }) {
  const router = useRouter();
  const [value, setValue] = useState(String(rate));
  const [saving, setSaving] = useState(false);

  // Per-question amounts are rarely whole coins, so show the exact value — the
  // remainder is carried on the student's wallet until it adds up to one.
  const preview = (score: number) => Math.round(score * (Number(value) || 0) * 1000) / 1000;

  const save = async () => {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return toast.error("请输入不小于 0 的数字");
    setSaving(true);
    try {
      const r = await postJSON<{ rate: number }>("/api/settings/coin-rate", { rate: n });
      setValue(String(r.rate));
      toast.success(`已保存：每 1 分 = ${r.rate} 枚金币`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">金币兑换比例</CardTitle>
        <CardDescription>
          每 1 分题目得分发放的金币数量，默认 0.3。每做对一道新题立刻结算，不满 1 枚的零头会攒到下一题。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="rate">每分兑换金币</Label>
            <Input
              id="rate"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              inputMode="decimal"
              className="w-28"
            />
          </div>
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2Icon className="animate-spin" /> : <SaveIcon />}
            保存
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          按当前比例：2 分的客观题 → <b>{preview(2)}</b> 枚；25 分的编程题满分 → <b>{preview(25)}</b> 枚；
          做完一整套 100 分的卷子 → <b>{preview(100)}</b> 枚。
        </p>
      </CardContent>
    </Card>
  );
}
