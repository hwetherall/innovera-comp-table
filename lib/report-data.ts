import { readFile } from "node:fs/promises";
import path from "node:path";
import { createSupabaseServerClient, getReportsBucket } from "@/lib/supabase/server";

export type ReportRecord = {
  run_id: string;
  title: string;
  json_path: string;
  html_path: string | null;
  is_public: boolean;
};

const reportCache = new Map<string, unknown>();
const RUN_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

export async function loadReportData(runId: string): Promise<unknown> {
  if (!RUN_ID_PATTERN.test(runId)) {
    throw new Error("Invalid run id.");
  }

  const cached = reportCache.get(runId);
  if (cached) {
    return cached;
  }

  const supabase = createSupabaseServerClient();
  if (supabase) {
    const { data: report, error: reportError } = await supabase
      .from("reports")
      .select("run_id,title,json_path,html_path,is_public")
      .eq("run_id", runId)
      .eq("is_public", true)
      .single<ReportRecord>();

    if (reportError) {
      throw new Error(`Unable to load report metadata: ${reportError.message}`);
    }

    const { data: objectData, error: objectError } = await supabase.storage
      .from(getReportsBucket())
      .download(report.json_path);

    if (objectError) {
      throw new Error(`Unable to download report JSON: ${objectError.message}`);
    }

    const parsed = JSON.parse(await objectData.text()) as unknown;
    reportCache.set(runId, parsed);
    return parsed;
  }

  const localJson = await readFile(path.join(process.cwd(), `${runId}.json`), "utf8");
  const parsed = JSON.parse(localJson) as unknown;
  reportCache.set(runId, parsed);
  return parsed;
}
