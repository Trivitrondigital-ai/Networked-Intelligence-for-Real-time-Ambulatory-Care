import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Download, ShieldAlert } from "lucide-react";
import { AppShell } from "../../components/layout/AppShell";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card, CardHeader } from "../../components/ui/Card";
import { useDemoData } from "../../app/DemoDataProvider";
import { getPatientWorkspace } from "../shared/selectors";
import { formatDate, formatTime } from "../../lib/format";
import { deriveMedicineTiming, downloadPrescriptionPdf } from "../../services/prescriptionPdf";

export function PrescriptionDetailPage() {
  const { prescriptionId } = useParams();
  const { state } = useDemoData();
  const { prescriptions } = getPatientWorkspace(state);
  const prescription = prescriptions.find((item) => item.id === prescriptionId) ?? prescriptions[0];
  const appointment = prescription ? state.appointments.byId[prescription.appointmentId] || null : null;
  const patient = prescription ? state.patients.byId[prescription.patientId] || null : null;
  const doctor = appointment ? state.doctors.byId[appointment.doctorId] || null : null;
  const encounter = appointment ? state.encounters.byId[`encounter-${appointment.id}`] || null : null;
  const [isDownloading, setIsDownloading] = useState(false);

  const diagnosisSummary = useMemo(() => {
    const diagnoses = encounter?.apciDraft?.diagnoses || [];
    if (!diagnoses.length) {
      return "-";
    }

    return diagnoses
      .map((item) => {
        const label = String(item?.label || "").trim();
        const code = String(item?.code || "").trim();
        return code ? `${label} (${code})` : label;
      })
      .filter(Boolean)
      .join(", ");
  }, [encounter?.apciDraft?.diagnoses]);

  const vitalsSummary = useMemo(() => {
    const vitals = encounter?.apciDraft?.vitals || {};
    const parts = [
      ["Temp", vitals.temperature],
      ["BP", vitals.bloodPressure],
      ["Pulse", vitals.pulse],
      ["SpO2", vitals.spo2],
      ["RR", vitals.respiratoryRate],
      ["Wt", vitals.weight],
      ["Ht", vitals.height],
      ["BMI", vitals.bmi]
    ]
      .filter(([, value]) => Boolean(value))
      .map(([label, value]) => `${label}: ${value}`);

    return parts.length ? parts.join(" | ") : "-";
  }, [encounter?.apciDraft?.vitals]);

  const medicineRows = useMemo(
    () =>
      (prescription?.medicines || []).map((medicine, index) => ({
        ...medicine,
        rowNumber: index + 1,
        timing: deriveMedicineTiming(medicine)
      })),
    [prescription?.medicines]
  );

  async function handleDownloadPdf() {
    if (!prescription) {
      return;
    }

    try {
      setIsDownloading(true);
      await downloadPrescriptionPdf({
        prescription,
        patient,
        doctor,
        appointment,
        encounter
      });
    } catch (error) {
      console.error("[NIRA] Prescription PDF download failed.", error);
    } finally {
      setIsDownloading(false);
    }
  }

  return (
    <AppShell
      title="Prescription detail"
      subtitle="A patient-friendly view of medicines, timing, and warning notes generated after doctor approval."
    >
      <Card>
        <CardHeader
          eyebrow="Issued medication sheet"
          title={prescription ? `Issued ${formatDate(prescription.issuedAt)}` : "Prescription not found"}
          description={
            prescription
              ? `Shared at ${formatTime(prescription.issuedAt)} and synced instantly to the patient portal demo.`
              : "No prescription is available for this route."
          }
          actions={
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" onClick={handleDownloadPdf} disabled={!prescription || isDownloading}>
                <Download className="h-4 w-4" />
                {isDownloading ? "Preparing PDF..." : "Download PDF"}
              </Button>
              <Button asChild variant="secondary">
                <Link to="/patient/prescriptions">
                  <ArrowLeft className="h-4 w-4" />
                  All prescriptions
                </Link>
              </Button>
            </div>
          }
        />
        {prescription ? (
          <div className="grid gap-6 lg:grid-cols-[1fr_0.8fr]">
            <div className="space-y-4">
              <div className="rounded-[24px] border border-line bg-surface-2 p-5">
                <div className="section-title">Patient and doctor summary</div>
                <div className="mt-3 grid gap-4 md:grid-cols-2">
                  <div className="space-y-1.5 text-sm text-muted">
                    <div><span className="font-semibold text-ink">Patient:</span> {patient?.fullName || "-"}</div>
                    <div><span className="font-semibold text-ink">Age / Gender:</span> {patient?.age || "-"} / {patient?.gender || "-"}</div>
                    <div><span className="font-semibold text-ink">ABHA:</span> {patient?.abhaNumber || "-"}</div>
                    <div><span className="font-semibold text-ink">Contact:</span> {patient?.phone || patient?.email || "-"}</div>
                  </div>
                  <div className="space-y-1.5 text-sm text-muted">
                    <div><span className="font-semibold text-ink">Doctor:</span> {doctor?.fullName || "-"}</div>
                    <div><span className="font-semibold text-ink">Specialty:</span> {doctor?.specialty || "-"}</div>
                    <div><span className="font-semibold text-ink">Clinic:</span> {doctor?.clinic || "-"}</div>
                    <div><span className="font-semibold text-ink">Visit:</span> {appointment?.startAt ? `${formatDate(appointment.startAt)} at ${formatTime(appointment.startAt)}` : "-"}</div>
                  </div>
                </div>
              </div>

              <div className="rounded-[24px] border border-line bg-surface-2 p-5">
                <div className="section-title">Clinical context from EMR</div>
                <div className="mt-3 space-y-2 text-sm text-muted">
                  <div><span className="font-semibold text-ink">Chief complaint:</span> {encounter?.apciDraft?.soap?.chiefComplaint || "-"}</div>
                  <div><span className="font-semibold text-ink">Diagnosis:</span> {diagnosisSummary}</div>
                  <div><span className="font-semibold text-ink">Vitals:</span> {vitalsSummary}</div>
                </div>
              </div>

              <div className="rounded-[24px] border border-line bg-surface-2 p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="section-title">Medication schedule</div>
                  <Badge tone="info">M / N / E / Nt = Morning / Noon / Evening / Night</Badge>
                </div>
                <div className="mt-3 overflow-x-auto rounded-2xl border border-line bg-white">
                  <table className="min-w-full divide-y divide-line">
                    <thead className="bg-surface-2">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted">Drug</th>
                        <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted">Dose</th>
                        <th className="px-3 py-2 text-center text-xs font-semibold uppercase tracking-wide text-muted">M</th>
                        <th className="px-3 py-2 text-center text-xs font-semibold uppercase tracking-wide text-muted">N</th>
                        <th className="px-3 py-2 text-center text-xs font-semibold uppercase tracking-wide text-muted">E</th>
                        <th className="px-3 py-2 text-center text-xs font-semibold uppercase tracking-wide text-muted">Nt</th>
                        <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted">Food</th>
                        <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted">Duration</th>
                        <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted">Instructions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {medicineRows.map((medicine) => (
                        <tr key={`${prescription.id}-${medicine.name}-${medicine.rowNumber}`}>
                          <td className="px-3 py-2 text-sm font-semibold text-ink">{medicine.rowNumber}. {medicine.name}</td>
                          <td className="px-3 py-2 text-sm text-muted">{medicine.dosage || "-"}</td>
                          <td className="px-3 py-2 text-center text-sm text-ink">{medicine.timing.morning}</td>
                          <td className="px-3 py-2 text-center text-sm text-ink">{medicine.timing.noon}</td>
                          <td className="px-3 py-2 text-center text-sm text-ink">{medicine.timing.evening}</td>
                          <td className="px-3 py-2 text-center text-sm text-ink">{medicine.timing.night}</td>
                          <td className="px-3 py-2 text-sm text-muted">{medicine.timing.foodTiming}</td>
                          <td className="px-3 py-2 text-sm text-muted">{medicine.duration || "-"}</td>
                          <td className="px-3 py-2 text-sm text-muted">{medicine.instructions || medicine.frequency || "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-3 text-xs text-muted">
                  Timing is auto-derived from doctor-entered frequency and instruction text. Please follow doctor advice if timing differs.
                </p>
              </div>
            </div>
            <div className="space-y-4">
              <div className="rounded-[24px] border border-line bg-surface-2 p-5">
                <div className="section-title">Prescription dates</div>
                <div className="mt-3 space-y-2 text-sm text-muted">
                  <div><span className="font-semibold text-ink">Issued date:</span> {formatDate(prescription.issuedAt)}</div>
                  <div><span className="font-semibold text-ink">Issued time:</span> {formatTime(prescription.issuedAt)}</div>
                  <div><span className="font-semibold text-ink">Prescription ID:</span> {prescription.id}</div>
                  <div><span className="font-semibold text-ink">Visit token:</span> {appointment?.token || "-"}</div>
                </div>
              </div>

              <div className="rounded-[24px] border border-amber-200 bg-amber-50 p-5">
                <div className="flex items-center gap-3">
                  <ShieldAlert className="h-5 w-5 text-amber-700" />
                  <div className="text-sm font-semibold text-amber-900">Warnings & red flags</div>
                </div>
                <div className="mt-4 space-y-2 text-sm text-amber-900/90">
                  {(prescription.warnings || []).map((warning) => (
                    <div key={warning} className="rounded-2xl border border-amber-200 bg-white/60 px-4 py-3">
                      {warning}
                    </div>
                  ))}
                  {!prescription.warnings?.length ? (
                    <div className="rounded-2xl border border-amber-200 bg-white/60 px-4 py-3">No warning added by doctor.</div>
                  ) : null}
                </div>
              </div>
              <div className="rounded-[24px] border border-line bg-surface-2 p-5">
                <div className="section-title">Follow-up</div>
                <div className="mt-3 text-base font-semibold text-ink">{prescription.followUpNote}</div>
                <p className="mt-3 text-sm leading-6 text-muted">
                  Download PDF to share this prescription with pharmacy or family members.
                </p>
              </div>
            </div>
          </div>
        ) : null}
      </Card>
    </AppShell>
  );
}
