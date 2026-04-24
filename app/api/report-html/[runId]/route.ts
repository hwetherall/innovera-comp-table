import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

const RUN_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;

  if (!RUN_ID_PATTERN.test(runId)) {
    return NextResponse.json({ error: "Invalid run id." }, { status: 400 });
  }

  try {
    const html = await readFile(path.join(process.cwd(), `${runId}.html`), "utf8");
    return new NextResponse(html, {
      headers: {
        "Cache-Control": "public, max-age=300, s-maxage=3600",
        "Content-Type": "text/html; charset=utf-8",
      },
    });
  } catch {
    return NextResponse.json({ error: "Report HTML not found." }, { status: 404 });
  }
}
