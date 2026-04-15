import { useMemo } from "react";
import { Link } from "react-router-dom";
import { AppShell } from "../../components/layout/AppShell";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card, CardHeader } from "../../components/ui/Card";
import { useDemoData } from "../../app/DemoDataProvider";
import { getDoctorWorkspace } from "../shared/selectors";
import { formatDate, formatTime } from "../../lib/format";
import { useVirtualizedRows } from "../../hooks/useVirtualizedRows";

const LAB_REPORT_ROW_HEIGHT_PX = 218;
const LAB_REPORT_LIST_MAX_HEIGHT_PX = 640;

export function DoctorLabReportsPage() {
  const { state } = useDemoData();
  const { labReports } = getDoctorWorkspace(state);
  const viewportHeight = useMemo(
    () => Math.min(LAB_REPORT_LIST_MAX_HEIGHT_PX, Math.max(labReports.length, 1) * LAB_REPORT_ROW_HEIGHT_PX),
    [labReports.length]
  );
  const {
    viewportRef,
    onScroll,
    totalHeight,
    virtualRows
  } = useVirtualizedRows(labReports, {
    rowHeight: LAB_REPORT_ROW_HEIGHT_PX,
    viewportHeight,
    overscan: 3,
    resetKey: `${labReports.length}-${labReports[0]?.id || ""}-${labReports[labReports.length - 1]?.id || ""}`
  });

  return (
    <AppShell
      title="Doctor lab reports"
      subtitle="Review all lab reports tied to your patients. Updates from chart review are synced to patient view automatically."
      languageLabel="Doctor diagnostics in English"
    >
      <Card>
        <CardHeader
          eyebrow="Doctor diagnostics"
          title="Recent lab report updates"
          description="Draft reports can be refined in chart review; final reports are visible to patients right away."
          actions={
            <Button asChild variant="secondary">
              <Link to="/doctor">Back to dashboard</Link>
            </Button>
          }
        />

        <div className="space-y-4">
          {labReports.length === 0 ? (
            <div className="rounded-[24px] border border-dashed border-line bg-surface-2 p-8 text-center text-sm text-muted">
              No lab reports yet. Add one while reviewing a patient chart.
            </div>
          ) : (
            <>
              <div
                ref={viewportRef}
                onScroll={onScroll}
                className="overflow-y-auto pr-1"
                style={{ maxHeight: `${LAB_REPORT_LIST_MAX_HEIGHT_PX}px`, height: `${viewportHeight}px` }}
              >
                <div className="relative" style={{ height: `${totalHeight}px` }}>
                  {virtualRows.map(({ item: report, index }) => (
                    <div
                      key={report.id}
                      style={{
                        position: "absolute",
                        left: 0,
                        right: 0,
                        top: `${index * LAB_REPORT_ROW_HEIGHT_PX}px`,
                        height: `${LAB_REPORT_ROW_HEIGHT_PX}px`,
                        paddingBottom: "14px"
                      }}
                    >
                      <Link to={`/doctor/patient/${report.appointmentId}`} className="block h-full">
                        <div className="h-full rounded-[24px] border border-line bg-surface-2 p-5 transition hover:-translate-y-0.5 hover:shadow-soft">
                          <div className="flex flex-wrap items-center gap-3">
                            <h3 className="text-lg font-semibold tracking-tight text-ink">{report.title}</h3>
                            <Badge tone={report.status === "final" ? "success" : "warning"}>
                              {report.status === "final" ? "Final" : "Draft"}
                            </Badge>
                            <Badge tone="neutral">{report.category}</Badge>
                          </div>
                          <div className="mt-2 text-sm text-muted">
                            Updated {formatDate(report.updatedAt)} at {formatTime(report.updatedAt)}
                          </div>
                          <div className="mt-4 grid gap-3 md:grid-cols-2">
                            <div className="line-clamp-3 rounded-2xl bg-white p-4 text-sm text-ink">{report.findings || "-"}</div>
                            <div className="line-clamp-3 rounded-2xl bg-white p-4 text-sm text-ink">{report.resultSummary || "-"}</div>
                          </div>
                        </div>
                      </Link>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-xl border border-line/60 bg-surface-2 px-3 py-2 text-xs text-muted">
                Virtualized lab reports enabled. Showing {labReports.length} report(s).
              </div>
            </>
          )}
        </div>
      </Card>
    </AppShell>
  );
}
