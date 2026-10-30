"use client";

import Link from "next/link";
import { CoinsIcon, LogOutIcon, SettingsIcon, UserIcon } from "lucide-react";
import { signOut } from "@/app/(auth)/actions";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function UserMenu({
  name,
  username,
  isAdmin,
}: {
  name: string;
  username: string;
  isAdmin: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
        <Avatar className="size-8">
          <AvatarFallback className="bg-primary/10 text-primary">{name.slice(0, 1)}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            <div className="font-medium text-foreground">{name}</div>
            <div className="truncate text-xs font-normal">@{username}</div>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link href="/coins" />}>
          <CoinsIcon /> 我的金币
        </DropdownMenuItem>
        <DropdownMenuItem render={<Link href="/dashboard" />}>
          <UserIcon /> 学习报告
        </DropdownMenuItem>
        {isAdmin && (
          <DropdownMenuItem render={<Link href="/admin" />}>
            <SettingsIcon /> 系统设置
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => signOut()}>
          <LogOutIcon /> 退出登录
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
