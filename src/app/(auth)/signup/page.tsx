import type { Metadata } from "next";
import { AuthForm } from "../auth-form";

export const metadata: Metadata = { title: "注册" };

export default function SignupPage() {
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <AuthForm mode="signup" />
    </div>
  );
}
