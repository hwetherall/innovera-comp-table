import { redirect } from "next/navigation";

export default function Home() {
  redirect(`/reports/${process.env.NEXT_PUBLIC_DEFAULT_RUN_ID ?? "v2_run_20260424_104054"}`);
}
