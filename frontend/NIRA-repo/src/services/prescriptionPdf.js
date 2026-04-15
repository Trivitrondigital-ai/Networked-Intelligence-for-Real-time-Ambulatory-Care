import { formatDate, formatTime } from "../lib/format";

function safeValue(value, fallback = "-") {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text ? text : fallback;
}

function normalizeText(value) {
  return String(value || "").toLowerCase();
}

function addSlots(slots, keys) {
  keys.forEach((key) => {
    if (slots[key] === "-") {
      slots[key] = "1";
    }
  });
}

function inferFoodTiming(text) {
  if (/without\s+food/.test(text)) return "Without food";
  if (/empty\s+stomach|before\s+(food|meal|meals|breakfast|lunch|dinner)|pre[-\s]?meal/.test(text)) {
    return "Before food";
  }
  if (/after\s+(food|meal|meals|breakfast|lunch|dinner)|post[-\s]?meal/.test(text)) {
    return "After food";
  }
  if (/with\s+(food|meal|meals)/.test(text)) {
    return "With food";
  }
  return "As advised";
}

export function deriveMedicineTiming(medicine) {
  const frequencyText = normalizeText(medicine?.frequency);
  const instructionText = normalizeText(medicine?.instructions);
  const combined = `${frequencyText} ${instructionText}`;

  const slots = {
    morning: "-",
    noon: "-",
    evening: "-",
    night: "-"
  };

  const explicitMorning = /morning|breakfast|\bam\b/.test(combined);
  const explicitNoon = /noon|afternoon|lunch/.test(combined);
  const explicitEvening = /evening/.test(combined);
  const explicitNight = /night|bedtime|before\s+sleep|\bhs\b/.test(combined);

  if (explicitMorning) slots.morning = "1";
  if (explicitNoon) slots.noon = "1";
  if (explicitEvening) slots.evening = "1";
  if (explicitNight) slots.night = "1";

  if (/four\s+times|4\s*times|every\s*6\s*hours|q6h/.test(combined)) {
    addSlots(slots, ["morning", "noon", "evening", "night"]);
  } else if (/thrice|three\s+times|3\s*times|every\s*8\s*hours|q8h|tid/.test(combined)) {
    addSlots(slots, ["morning", "noon", "evening"]);
    if (/night/.test(combined)) {
      addSlots(slots, ["night"]);
    }
  } else if (/twice|two\s+times|2\s*times|every\s*12\s*hours|q12h|bid/.test(combined)) {
    addSlots(slots, ["morning", "evening"]);
    if (explicitNight && !explicitEvening) {
      slots.evening = "-";
      slots.night = "1";
    }
  } else if (/once\s+daily|once\s+a\s+day|\bod\b|daily/.test(combined)) {
    if (explicitNight && !explicitMorning && !explicitNoon && !explicitEvening) {
      slots.night = "1";
    } else if (slots.morning === "-" && slots.noon === "-" && slots.evening === "-" && slots.night === "-") {
      slots.morning = "1";
    }
  }

  if (/after\s+meals/.test(combined) && slots.morning === "-" && slots.noon === "-" && slots.evening === "-" && slots.night === "-") {
    addSlots(slots, ["morning", "noon", "evening"]);
  }

  if (/as\s+needed|\bprn\b/.test(combined) && slots.morning === "-" && slots.noon === "-" && slots.evening === "-" && slots.night === "-") {
    addSlots(slots, ["morning"]);
  }

  return {
    ...slots,
    foodTiming: inferFoodTiming(combined),
    asNeeded: /as\s+needed|\bprn\b/.test(combined)
  };
}

function toDiagnosisSummary(encounter) {
  const diagnoses = encounter?.apciDraft?.diagnoses || [];
  if (!diagnoses.length) {
    return "-";
  }

  return diagnoses
    .map((item) => {
      const label = safeValue(item?.label, "");
      const code = safeValue(item?.code, "");
      return code && code !== "-" ? `${label} (${code})` : label;
    })
    .filter(Boolean)
    .join(", ");
}

function toVitalsSummary(encounter) {
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
    .filter(([, value]) => value)
    .map(([label, value]) => `${label}: ${value}`);

  return parts.length ? parts.join(" | ") : "-";
}

function uniq(values) {
  return [...new Set((values || []).map((item) => String(item || "").trim()).filter(Boolean))];
}

function slugify(value) {
  return String(value || "prescription")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "prescription";
}

function drawLabelValue(doc, label, value, x, y, maxWidth) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  doc.text(label, x, y);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(30, 41, 59);
  const textLines = doc.splitTextToSize(safeValue(value), maxWidth);
  doc.text(textLines, x, y + 12);

  return y + 12 + textLines.length * 12;
}

export async function downloadPrescriptionPdf({
  prescription,
  patient,
  doctor,
  appointment,
  encounter
}) {
  if (!prescription) {
    throw new Error("Prescription details are unavailable.");
  }

  const [{ jsPDF }, autoTableModule] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable")
  ]);

  const autoTable = autoTableModule.default || autoTableModule.autoTable;
  if (typeof autoTable !== "function") {
    throw new Error("PDF table renderer is unavailable.");
  }

  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 40;
  let y = margin;

  const ensureSpace = (requiredHeight = 24) => {
    if (y + requiredHeight > pageHeight - margin) {
      doc.addPage();
      y = margin;
    }
  };

  const complaint = safeValue(encounter?.apciDraft?.soap?.chiefComplaint);
  const diagnosis = toDiagnosisSummary(encounter);
  const vitals = toVitalsSummary(encounter);
  const warnings = uniq([...(prescription?.warnings || []), ...(encounter?.apciDraft?.alerts || [])]);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(76, 29, 149);
  doc.text("PRESCRIPTION", margin, y);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(71, 85, 105);
  doc.text("NIRA Digital Care Summary", margin, y + 16);

  doc.setDrawColor(14, 116, 144);
  doc.setLineWidth(1.2);
  doc.line(margin, y + 24, pageWidth - margin, y + 24);
  y += 40;

  ensureSpace(90);
  const halfWidth = (pageWidth - margin * 2 - 24) / 2;
  let leftY = y;
  let rightY = y;

  leftY = drawLabelValue(doc, "Patient Name", patient?.fullName, margin, leftY, halfWidth);
  leftY = drawLabelValue(doc, "Patient ID / ABHA", patient?.abhaNumber, margin, leftY + 8, halfWidth);
  leftY = drawLabelValue(
    doc,
    "Age / Gender",
    `${safeValue(patient?.age, "-")} / ${safeValue(patient?.gender, "-")}`,
    margin,
    leftY + 8,
    halfWidth
  );
  leftY = drawLabelValue(doc, "Patient Contact", patient?.phone || patient?.email, margin, leftY + 8, halfWidth);

  const rightX = margin + halfWidth + 24;
  rightY = drawLabelValue(doc, "Doctor Name", doctor?.fullName, rightX, rightY, halfWidth);
  rightY = drawLabelValue(doc, "Specialty", doctor?.specialty, rightX, rightY + 8, halfWidth);
  rightY = drawLabelValue(doc, "Clinic", doctor?.clinic, rightX, rightY + 8, halfWidth);
  rightY = drawLabelValue(doc, "Doctor Contact", doctor?.phone || doctor?.email, rightX, rightY + 8, halfWidth);

  y = Math.max(leftY, rightY) + 12;
  doc.setDrawColor(226, 232, 240);
  doc.line(margin, y, pageWidth - margin, y);
  y += 14;

  ensureSpace(100);
  const metaRows = [
    ["Prescription ID", safeValue(prescription?.id)],
    ["Issued Date", prescription?.issuedAt ? formatDate(prescription.issuedAt) : "-"],
    ["Issued Time", prescription?.issuedAt ? formatTime(prescription.issuedAt) : "-"],
    ["Visit Date", appointment?.startAt ? formatDate(appointment.startAt) : "-"],
    ["Visit Time", appointment?.startAt ? formatTime(appointment.startAt) : "-"],
    ["Token", safeValue(appointment?.token)]
  ];

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [["Visit & Prescription Meta", "Value"]],
    body: metaRows,
    theme: "grid",
    styles: { fontSize: 9, cellPadding: 5, textColor: [30, 41, 59] },
    headStyles: { fillColor: [14, 116, 144], textColor: [255, 255, 255], fontStyle: "bold" },
    columnStyles: {
      0: { cellWidth: 170, fontStyle: "bold" },
      1: { cellWidth: pageWidth - margin * 2 - 170 }
    }
  });

  y = (doc.lastAutoTable?.finalY || y) + 14;
  ensureSpace(80);

  doc.setFont("helvetica", "bold");
  doc.setTextColor(30, 41, 59);
  doc.setFontSize(12);
  doc.text("Clinical Summary", margin, y);
  y += 10;

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [["Field", "Details"]],
    body: [
      ["Chief Complaint", complaint],
      ["Diagnosis", diagnosis],
      ["Vitals", vitals]
    ],
    theme: "grid",
    styles: { fontSize: 9, cellPadding: 5, textColor: [30, 41, 59], valign: "top" },
    headStyles: { fillColor: [15, 118, 110], textColor: [255, 255, 255], fontStyle: "bold" },
    columnStyles: {
      0: { cellWidth: 120, fontStyle: "bold" },
      1: { cellWidth: pageWidth - margin * 2 - 120 }
    }
  });

  y = (doc.lastAutoTable?.finalY || y) + 14;
  ensureSpace(140);

  doc.setFont("helvetica", "bold");
  doc.setTextColor(30, 41, 59);
  doc.setFontSize(12);
  doc.text("Medication Plan", margin, y);
  y += 10;

  const medicineRows = (prescription?.medicines || []).map((medicine, index) => {
    const timing = deriveMedicineTiming(medicine);
    return [
      `${index + 1}. ${safeValue(medicine?.name)}`,
      safeValue(medicine?.dosage),
      timing.morning,
      timing.noon,
      timing.evening,
      timing.night,
      timing.foodTiming,
      safeValue(medicine?.duration),
      safeValue(medicine?.instructions)
    ];
  });

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [["Drug", "Dose", "M", "N", "E", "Nt", "Food", "Duration", "Instructions"]],
    body: medicineRows.length
      ? medicineRows
      : [["-", "-", "-", "-", "-", "-", "-", "-", "-"]],
    theme: "grid",
    styles: { fontSize: 8, cellPadding: 4, textColor: [30, 41, 59], valign: "top" },
    headStyles: { fillColor: [124, 58, 237], textColor: [255, 255, 255], fontStyle: "bold" },
    columnStyles: {
      0: { cellWidth: 92 },
      1: { cellWidth: 56 },
      2: { cellWidth: 22, halign: "center" },
      3: { cellWidth: 22, halign: "center" },
      4: { cellWidth: 22, halign: "center" },
      5: { cellWidth: 22, halign: "center" },
      6: { cellWidth: 56 },
      7: { cellWidth: 58 },
      8: { cellWidth: 165 }
    }
  });

  y = (doc.lastAutoTable?.finalY || y) + 14;
  ensureSpace(80);

  doc.setFont("helvetica", "bold");
  doc.setTextColor(30, 41, 59);
  doc.setFontSize(12);
  doc.text("Warnings & Follow-up", margin, y);
  y += 8;

  const warningText = warnings.length ? warnings.map((item) => `- ${item}`).join("\n") : "- No critical warning recorded.";
  const warningLines = doc.splitTextToSize(warningText, pageWidth - margin * 2);

  doc.setFont("helvetica", "normal");
  doc.setTextColor(51, 65, 85);
  doc.setFontSize(9);
  doc.text(warningLines, margin, y + 12);
  y += warningLines.length * 12 + 12;

  const followUp = `Follow-up: ${safeValue(prescription?.followUpNote)}`;
  const followUpLines = doc.splitTextToSize(followUp, pageWidth - margin * 2);
  doc.text(followUpLines, margin, y + 12);

  const footerY = pageHeight - 24;
  doc.setDrawColor(226, 232, 240);
  doc.line(margin, footerY - 10, pageWidth - margin, footerY - 10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(100, 116, 139);
  doc.setFontSize(8);
  doc.text(`Generated on ${formatDate(new Date().toISOString())} at ${formatTime(new Date().toISOString())}`, margin, footerY);

  const issuedDate = String(prescription?.issuedAt || "").slice(0, 10) || "date";
  const filename = `prescription-${slugify(patient?.fullName || prescription?.patientId)}-${issuedDate}.pdf`;
  doc.save(filename);
}
