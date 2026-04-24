import { ChatPanel } from "@/components/chat-panel";

type ReportPageProps = {
  params: Promise<{
    runId: string;
  }>;
};

export default async function ReportPage({ params }: ReportPageProps) {
  const { runId } = await params;

  return (
    <main className="report-shell">
      <div className="report-topbar">
        <div className="report-topbar-inner">
          <div>
            <p className="report-eyebrow">Innovera Market Report</p>
            <h1 className="report-title">Competitive Intelligence Viewer</h1>
          </div>
          <p className="report-run-id">
            Public report: <span>{runId}</span>
          </p>
        </div>
      </div>

      <div className="report-layout">
        <section className="report-frame-card">
          <iframe
            title="Competitive intelligence report"
            src={`/api/report-html/${encodeURIComponent(runId)}`}
            className="report-frame"
          />
        </section>

        <ChatPanel runId={runId} />
      </div>
    </main>
  );
}
