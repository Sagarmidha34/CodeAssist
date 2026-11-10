import { PasswordReset } from "./password-reset";

export default async function ResetPage({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const { code } = await searchParams;
  return <PasswordReset code={code ?? ""} />;
}
