import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, CalendarClock, Clock3, Filter, Search, Shield } from "lucide-react";
import { AppShell } from "../../components/layout/AppShell";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card, CardHeader } from "../../components/ui/Card";
import { StatCard } from "../../components/ui/StatCard";
import { useDemoData } from "../../app/DemoDataProvider";
import { getDoctorWorkspace, getCurrentProfile } from "../shared/selectors";
import { formatDate, formatStatus, formatTime } from "../../lib/format";
import { initials } from "../../lib/utils";
import { useTranslation } from "../../hooks/useTranslation";

function isPreCheckDone(item) {
  return ["complete", "completed"].includes(String(item?.interview?.completionStatus || "").toLowerCase());
}

function getQueueCategory(item) {
  if (item.queueStatus === "approved" || item.bookingStatus === "completed") {
    return "completed";
  }

  if (item.queueStatus === "in_consult") {
    return "in_consult";
  }

  if (item.queueStatus === "ai_ready" || isPreCheckDone(item)) {
    return "precheck_submitted";
  }

  return "precheck_pending";
}

function toneForQueueStatus(status) {
  if (status === "approved") return "success";
  if (status === "in_consult") return "info";
  if (status === "ai_ready") return "info";
  if (status === "awaiting_interview") return "warning";
  return "neutral";
}

function getChiefComplaintDisplay(item) {
  const complaint = String(item?.draft?.soap?.chiefComplaint || item?.chiefComplaint || "").trim();
  const isPendingSymptomNote = /pending symptom (interview|check)/i.test(complaint) || /interview pending/i.test(complaint);
  if (item?.queueStatus === "awaiting_interview" && isPendingSymptomNote) return "-";
  return complaint || "-";
}

function getDateScopeLabel(dayKey) {
  if (!dayKey || dayKey === "all") {
    return "All dates";
  }

  return formatDate(`${dayKey}T00:00:00+05:30`);
}

export function DoctorDashboardPage() {
  const { state } = useDemoData();
  const { t } = useTranslation();

  const getQueueDisplayStatus = (item) => {
    if (item.queueStatus === "approved" || item.bookingStatus === "completed") return t("completedToday");
    if (item.queueStatus === "in_consult") return t("underConsultation");
    if (isPreCheckDone(item) || item.queueStatus === "ai_ready") return t("aiChatCompleted");
    return formatStatus(item.queueStatus);
  };

  const { doctor, appointments, queueCounts, labReports } = getDoctorWorkspace(state);
  const profile = getCurrentProfile(state);
  const isPending = ["pending_approval", "pending"].includes(String(profile?.status || "").toLowerCase());
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchValue, setSearchValue] = useState("");
  const [calendarDate, setCalendarDate] = useState(() => state?.meta?.today || "");
  const [dateFilter, setDateFilter] = useState(() => state?.meta?.today || "all");

  useEffect(() => {
    if (!calendarDate && state?.meta?.today) {
      setCalendarDate(state.meta.today);
    }

    if (!dateFilter && state?.meta?.today) {
      setDateFilter(state.meta.today);
    }
  }, [calendarDate, dateFilter, state?.meta?.today]);

  useEffect(() => {
    if (!state?.meta?.today) {
      return;
    }

    if (dateFilter !== state.meta.today) {
      return;
    }

    const hasTodayAppointments = appointments.some((item) => String(item.startAt || "").slice(0, 10) === state.meta.today);
    if (!hasTodayAppointments) {
      setDateFilter("all");
    }
  }, [appointments, dateFilter, state?.meta?.today]);

  const filters = [
    { key: "all", label: "All" },
    { key: "precheck_pending", label: "Pre-check pending" },
    { key: "precheck_submitted", label: "Pre-check submitted" },
    { key: "in_consult", label: "In consult" },
    { key: "completed", label: "Completed" }
  ];

  const queueStatusCounts = useMemo(() => {
    return {
      all: appointments.length,
      precheck_pending: appointments.filter((item) => getQueueCategory(item) === "precheck_pending").length,
      precheck_submitted: appointments.filter((item) => getQueueCategory(item) === "precheck_submitted").length,
      in_consult: appointments.filter((item) => getQueueCategory(item) === "in_consult").length,
      completed: appointments.filter((item) => getQueueCategory(item) === "completed").length
    };
  }, [appointments]);

  const dashboardStats = useMemo(
    () => [
      { label: "Patients in queue", value: queueCounts.total, tone: "accent", filterKey: "all" },
      {
        label: "Pre-check pending",
        value: queueStatusCounts.precheck_pending,
        tone: "soft",
        filterKey: "precheck_pending"
      },
      {
        label: "Pre-check submitted",
        value: queueStatusCounts.precheck_submitted,
        tone: "soft",
        filterKey: "precheck_submitted"
      },
      { label: "Under consultation", value: queueCounts.inConsult, tone: "default", filterKey: "in_consult" },
      {
        label: "Completed today",
        value: queueStatusCounts.completed,
        tone: "default",
        filterKey: "completed"
      },
      { label: "Lab requests", value: labReports.length, tone: "default", to: "/doctor/lab-reports" }
    ],
    [
      labReports.length,
      queueCounts.inConsult,
      queueCounts.total,
      queueStatusCounts.completed,
      queueStatusCounts.precheck_pending,
      queueStatusCounts.precheck_submitted
    ]
  );

  const filteredAppointments = useMemo(
    () => {
      const searchNeedle = searchValue.trim().toLowerCase();

      return appointments.filter((item) => {
        const queueCategory = getQueueCategory(item);
        if (statusFilter !== "all" && queueCategory !== statusFilter) {
          return false;
        }

        if (dateFilter !== "all" && String(item.startAt || "").slice(0, 10) !== dateFilter) {
          return false;
        }

        if (!searchNeedle) {
          return true;
        }

        const searchable = [
          item.patient?.fullName,
          item.patient?.abhaNumber,
          item.token,
          item.id,
          item.queueStatus
        ]
          .filter(Boolean)
          .map((entry) => String(entry).toLowerCase());

        return searchable.some((entry) => entry.includes(searchNeedle));
      });
    },
    [appointments, dateFilter, searchValue, statusFilter]
  );

  const hasAppointmentsForCurrentDay = useMemo(() => {
    if (dateFilter === "all") {
      return true;
    }

    return appointments.some((item) => String(item.startAt || "").slice(0, 10) === dateFilter);
  }, [appointments, dateFilter]);

  return (
    <AppShell
      title="Doctor validation workspace"
      subtitle="Review only your own queue, validate APCI drafts, manage availability, and approve the final prescription from one workspace."
      languageLabel="Doctor UI in English"
    >
      <div className="space-y-6">
        {isPending ? (
          <div className="rounded-[24px] border border-amber-200 bg-amber-50 p-5">
            <div className="flex items-start gap-3">
              <Shield className="h-5 w-5 text-amber-700 mt-0.5 flex-shrink-0" />
              <div>
                <div className="text-sm font-semibold text-amber-950">Pending Admin Approval</div>
                <div className="mt-1 text-sm text-amber-900">
                  Your doctor account is pending approval from the clinic admin. You can explore the workspace, but clinical operations will be fully unlocked once approved.
                </div>
              </div>
            </div>
          </div>
        ) : null}
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          {dashboardStats.map((item) => (
            <StatCard
              key={item.label}
              label={item.label}
              value={`${item.value}`}
              tone={item.tone}
              to={item.to}
              onClick={item.filterKey ? () => setStatusFilter(item.filterKey) : undefined}
              active={item.filterKey ? statusFilter === item.filterKey : false}
            />
          ))}
        </div>

        <Card density="compact">
          <CardHeader
            eyebrow="Doctor profile"
            title="Your profile at a glance"
            description="Keep your public-facing details updated so patients and admins always see the latest credentials."
          />
          <div className="grid gap-4 md:grid-cols-[1.3fr_1fr_auto] md:items-center">
            <div>
              <div className="text-lg font-semibold text-ink">{profile?.fullName || doctor?.fullName || "Doctor"}</div>
              <div className="mt-1 text-sm text-muted">
                {(profile?.specialty || doctor?.specialty || "General Practice")}
                {profile?.licenseNumber ? ` · License ${profile.licenseNumber}` : ""}
              </div>
              <div className="mt-2 text-sm text-muted">{profile?.clinic || doctor?.clinic || "Clinic details not added yet"}</div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-1">
              <Badge tone="info">Phone: {doctor?.phone || "Not set"}</Badge>
              <Badge tone="neutral">Status: {isPending ? "Pending approval" : "Active"}</Badge>
            </div>
            <Button asChild>
              <Link to="/doctor/profile">
                Manage profile
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </Card>
        <Card>
          <CardHeader
            eyebrow="Queue control"
            title={doctor ? `${doctor.fullName} · ${doctor.specialty}` : "Doctor workspace"}
            description="Use status filters, date scope, and search to keep the queue clean and focused."
          />
          <div className="space-y-4">
            <div className="rounded-2xl border border-line/50 bg-white/70 p-3">
              <label htmlFor="doctor-queue-search" className="text-xs font-bold uppercase tracking-[0.2em] text-muted">
                Search queue
              </label>
              <div className="mt-2 flex items-center gap-2 rounded-xl border border-line/50 bg-white px-3">
                <Search className="h-4 w-4 text-muted" />
                <input
                  id="doctor-queue-search"
                  value={searchValue}
                  onChange={(event) => setSearchValue(event.target.value)}
                  placeholder="Patient name, ABHA, token, or queue status"
                  className="h-10 w-full bg-transparent text-sm outline-none"
                />
              </div>
            </div>

            <div className="rounded-2xl border border-line/50 bg-white/70 p-3">
              <div className="grid gap-3 lg:grid-cols-[auto_auto_1fr] lg:items-end">
                <div className="space-y-1.5">
                  <div className="text-xs font-bold uppercase tracking-[0.2em] text-muted">Date scope</div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setDateFilter("all")}
                      className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                        dateFilter === "all"
                          ? "border-brand-sky bg-brand-mint text-ink"
                          : "border-line bg-white text-muted hover:bg-surface-2"
                      }`}
                    >
                      All dates
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (state?.meta?.today) {
                          setCalendarDate(state.meta.today);
                          setDateFilter(state.meta.today);
                        }
                      }}
                      className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                        dateFilter !== "all" && dateFilter === state?.meta?.today
                          ? "border-brand-sky bg-brand-mint text-ink"
                          : "border-line bg-white text-muted hover:bg-surface-2"
                      }`}
                    >
                      Today
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="doctor-queue-date" className="text-xs font-bold uppercase tracking-[0.2em] text-muted">
                    Calendar day
                  </label>
                  <input
                    id="doctor-queue-date"
                    type="date"
                    value={calendarDate}
                    onChange={(event) => {
                      const value = event.target.value;
                      setCalendarDate(value);
                      setDateFilter(value || "all");
                    }}
                    className="h-10 rounded-xl border border-line/50 bg-white px-3 text-sm text-ink outline-none focus:border-brand-tide/40"
                  />
                </div>

                <div className="rounded-xl border border-dashed border-line/60 bg-surface-2 px-3 py-2 text-xs text-muted">
                  <CalendarClock className="mr-1 inline h-3.5 w-3.5" />
                  Viewing {getDateScopeLabel(dateFilter)}.
                </div>
              </div>

              <div className="mt-3 space-y-1.5">
                <div className="text-xs font-bold uppercase tracking-[0.2em] text-muted">Filter by stage</div>
                <div className="flex flex-wrap gap-2">
                  {filters.map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      onClick={() => setStatusFilter(option.key)}
                      className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                        statusFilter === option.key
                          ? "border-brand-sky bg-brand-mint text-ink"
                          : "border-line bg-white text-muted hover:bg-surface-2"
                      }`}
                    >
                      {option.key === "all" ? <Filter className="mr-1 inline h-3.5 w-3.5" /> : null}
                      {option.label} ({queueStatusCounts[option.key] || 0})
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </Card>

        {filteredAppointments.length === 0 ? (
          <Card>
            <div className="rounded-[24px] border border-dashed border-line bg-surface-2 p-8 text-center text-sm text-muted">
              No patients match this queue filter right now.
              {!hasAppointmentsForCurrentDay && dateFilter !== "all" ? " Try switching from Today to All dates." : ""}
            </div>
          </Card>
        ) : (
          <Card className="overflow-hidden p-0">
            <div className="max-h-[640px] overflow-y-auto overflow-x-auto">
              <table className="min-w-full divide-y divide-line">
                <thead className="sticky top-0 z-10 bg-surface-2">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted">Patient</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted">Queue status</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted">Token & time</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted">ABHA</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted">Chief complaint</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted">Signals</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-muted">Open</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line bg-white">
                  {filteredAppointments.map((item) => {
                    return (
                      <tr key={item.id} className="transition hover:bg-cyan-50/40">
                        <td className="px-4 py-4 align-top">
                          <div className="flex items-center gap-3 min-w-[220px]">
                            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-midnight text-white">
                              <span className="text-sm font-semibold">{initials(item.patient?.fullName)}</span>
                            </div>
                            <div className="min-w-0">
                              <div className="truncate text-sm font-semibold text-ink">{item.patient?.fullName}</div>
                              <div className="mt-1 text-xs text-muted">{item.patient?.gender || "Patient"}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-4 align-top text-sm text-muted">
                          <div className="space-y-1">
                            <Badge tone={toneForQueueStatus(item.queueStatus)}>{getQueueDisplayStatus(item)}</Badge>
                            <div>{item.queueStatus ? formatStatus(item.queueStatus) : "—"}</div>
                          </div>
                        </td>
                        <td className="px-4 py-4 align-top text-sm text-muted">
                          <div className="flex items-center gap-2 font-medium text-ink">
                            <Clock3 className="h-4 w-4 text-brand-tide" />
                            Token {item.token || "--"}
                          </div>
                          <div className="mt-1 text-xs text-muted">{formatTime(item.startAt)}</div>
                        </td>
                        <td className="px-4 py-4 align-top text-sm text-muted">
                          {item.patient?.abhaNumber || item.patient?.abha || item.abhaId || "Not linked"}
                        </td>
                        <td className="px-4 py-4 align-top text-sm text-ink">
                          <div className="font-semibold">{getChiefComplaintDisplay(item)}</div>
                          <div className="mt-1 max-w-[30rem] text-sm leading-6 text-muted">
                            {item.draft?.soap?.assessment || "Patient has not completed the pre-check yet, so the chart is still empty."}
                          </div>
                        </td>
                        <td className="px-4 py-4 align-top text-sm text-muted">
                          <div className="flex flex-wrap gap-2">
                            {(item.draft?.alerts || ["Awaiting doctor review"]).slice(0, 2).map((alert) => (
                              <span key={alert} className="pill">
                                {alert}
                              </span>
                            ))}
                            {item.dbSync?.encounterId ? <Badge tone="success" className="text-xs">DB linked</Badge> : null}
                          </div>
                        </td>
                        <td className="px-4 py-4 align-top text-right">
                          <Button asChild variant="secondary" className="h-8 px-3">
                            <Link to={`/doctor/patient/${item.id}`}>
                              Open
                              <ArrowRight className="h-4 w-4" />
                            </Link>
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}

      </div>
    </AppShell>
  );
}
