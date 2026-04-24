import "dotenv/config";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const runId = process.argv[2] ?? "v2_run_20260424_104054";
const bucket = process.env.SUPABASE_REPORTS_BUCKET ?? "reports";
const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

async function main() {
  const jsonPath = `${runId}.json`;
  const htmlPath = `${runId}.html`;
  const json = await readFile(path.join(process.cwd(), jsonPath));

  const { error: uploadError } = await supabase.storage.from(bucket).upload(jsonPath, json, {
    contentType: "application/json",
    upsert: true,
  });

  if (uploadError) {
    throw new Error(`JSON upload failed: ${uploadError.message}`);
  }

  const { error: upsertError } = await supabase.from("reports").upsert(
    {
      run_id: runId,
      title: "Competitive Intelligence Report",
      json_path: jsonPath,
      html_path: htmlPath,
      is_public: true,
    },
    { onConflict: "run_id" },
  );

  if (upsertError) {
    throw new Error(`Report metadata upsert failed: ${upsertError.message}`);
  }

  console.log(`Seeded ${runId} into Supabase bucket "${bucket}".`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
