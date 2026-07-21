import PDFDocument from "pdfkit/js/pdfkit.standalone.js";
import type {
  ChartSpec,
  MetricSpec,
  TableSpec,
} from "@/lib/telemetry/chart-spec";
import type {
  VisualPanel,
  VisualResponseData,
} from "@/lib/telemetry/visual-response";

const PAGE_MARGIN = 48;
const COLORS = {
  ink: "#211C25",
  muted: "#716A78",
  faint: "#9B94A1",
  line: "#E5DFE9",
  paper: "#F8F7FA",
  card: "#FFFFFF",
  purple: "#963DE1",
  purpleSoft: "#F0E5F8",
  blue: "#3D82D8",
  green: "#2A9D68",
  amber: "#C98223",
  red: "#CA4F61",
};

function text(value: unknown) {
  return String(value ?? "")
    .replaceAll("\u2010", "-")
    .replaceAll("\u2011", "-")
    .replaceAll("\u2012", "-")
    .replaceAll("\u2013", "-")
    .replaceAll("\u2014", "-")
    .replaceAll("\u2192", "->")
    .replaceAll("\u2026", "...")
    .replaceAll("\u2018", "'")
    .replaceAll("\u2019", "'")
    .replaceAll("\u201C", '"')
    .replaceAll("\u201D", '"')
    .normalize("NFKD")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "?");
}

function addPage(
  doc: PDFKit.PDFDocument,
  layout: "portrait" | "landscape" = "portrait",
) {
  doc.addPage({
    size: "A4",
    layout,
    margins: {
      top: PAGE_MARGIN,
      right: PAGE_MARGIN,
      bottom: 54,
      left: PAGE_MARGIN,
    },
  });
  doc
    .save()
    .rect(0, 0, doc.page.width, 7)
    .fill(COLORS.purple)
    .restore();
  doc.y = PAGE_MARGIN;
}

function ensureSpace(doc: PDFKit.PDFDocument, height: number) {
  if (doc.y + height <= doc.page.height - 60) return false;
  addPage(doc, doc.page.layout === "landscape" ? "landscape" : "portrait");
  return true;
}

function label(doc: PDFKit.PDFDocument, value: string) {
  doc
    .font("Helvetica-Bold")
    .fontSize(8)
    .fillColor(COLORS.purple)
    .text(text(value).toUpperCase(), { characterSpacing: 1.25 });
}

function roundedCard(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  width: number,
  height: number,
  fill = COLORS.card,
) {
  doc
    .save()
    .roundedRect(x, y, width, height, 12)
    .fillAndStroke(fill, COLORS.line)
    .restore();
}

function panelHeading(doc: PDFKit.PDFDocument, panel: VisualPanel) {
  label(doc, panel.eyebrow);
  doc
    .moveDown(0.55)
    .font("Helvetica-Bold")
    .fontSize(22)
    .fillColor(COLORS.ink)
    .text(text(panel.title), { lineGap: 2 });
  doc
    .moveDown(0.55)
    .font("Helvetica")
    .fontSize(11)
    .fillColor(COLORS.muted)
    .text(text(panel.finding), { lineGap: 3 });
  if (panel.source) {
    doc
      .moveDown(0.6)
      .font("Helvetica-Bold")
      .fontSize(8)
      .fillColor(COLORS.faint)
      .text(`SOURCE  ${text(panel.source)}`);
  }
  doc.moveDown(1.3);
}

function metricTone(tone: MetricSpec["items"][number]["tone"]) {
  if (tone === "good") return COLORS.green;
  if (tone === "warning") return COLORS.amber;
  if (tone === "bad") return COLORS.red;
  return COLORS.purple;
}

function drawMetrics(doc: PDFKit.PDFDocument, spec: MetricSpec) {
  const gap = 12;
  const width = (doc.page.width - PAGE_MARGIN * 2 - gap) / 2;
  const cardHeight = 108;
  let rowY = doc.y;

  spec.items.forEach((item, index) => {
    if (index > 0 && index % 2 === 0) {
      rowY += cardHeight + gap;
      if (rowY + cardHeight > doc.page.height - 60) {
        addPage(doc);
        rowY = doc.y;
      }
    }
    const column = index % 2;
    const x = PAGE_MARGIN + column * (width + gap);
    const y = rowY;
    roundedCard(doc, x, y, width, cardHeight);
    doc
      .save()
      .roundedRect(x + 14, y + 14, 4, cardHeight - 28, 2)
      .fill(metricTone(item.tone))
      .restore();
    doc
      .font("Helvetica-Bold")
      .fontSize(8)
      .fillColor(COLORS.muted)
      .text(text(item.label).toUpperCase(), x + 30, y + 17, {
        width: width - 46,
      });
    doc
      .font("Helvetica-Bold")
      .fontSize(17)
      .fillColor(COLORS.ink)
      .text(text(item.value), x + 30, y + 39, {
        width: width - 46,
        height: 38,
        ellipsis: true,
      });
    const detail = [item.trend, item.detail].filter(Boolean).join("  |  ");
    if (detail) {
      doc
        .font("Helvetica")
        .fontSize(8.5)
        .fillColor(COLORS.faint)
        .text(text(detail), x + 30, y + 79, {
          width: width - 46,
          height: 20,
          ellipsis: true,
        });
    }
  });
  doc.y = rowY + cardHeight + 4;
}

function chartNumber(value: string | number) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function drawChart(doc: PDFKit.PDFDocument, spec: ChartSpec) {
  const boxX = PAGE_MARGIN;
  const boxY = doc.y;
  const boxWidth = doc.page.width - PAGE_MARGIN * 2;
  const boxHeight = 355;
  roundedCard(doc, boxX, boxY, boxWidth, boxHeight);

  const plot = {
    x: boxX + 58,
    y: boxY + 35,
    width: boxWidth - 86,
    height: boxHeight - 93,
  };
  const values = spec.data.map((row) => chartNumber(row[spec.y.field]));
  const min = Math.min(0, ...values);
  const max = Math.max(1, ...values);
  const range = max - min || 1;
  const seriesField = spec.series?.field;
  const seriesNames = Array.from(
    new Set(spec.data.map((row) => text(seriesField ? row[seriesField] : "Value"))),
  );
  const palette = [COLORS.purple, COLORS.blue, COLORS.green, COLORS.amber];

  for (let index = 0; index <= 4; index++) {
    const y = plot.y + (plot.height * index) / 4;
    const value = max - (range * index) / 4;
    doc
      .save()
      .moveTo(plot.x, y)
      .lineTo(plot.x + plot.width, y)
      .lineWidth(0.6)
      .strokeColor(COLORS.line)
      .stroke()
      .restore();
    doc
      .font("Helvetica")
      .fontSize(7)
      .fillColor(COLORS.faint)
      .text(value.toLocaleString(undefined, { maximumFractionDigits: 2 }), boxX + 8, y - 4, {
        width: 42,
        align: "right",
      });
  }

  const groups = seriesNames.map((name) => ({
    name,
    rows: spec.data.filter(
      (row) => text(seriesField ? row[seriesField] : "Value") === name,
    ),
  }));

  groups.forEach((group, groupIndex) => {
    const color = palette[groupIndex % palette.length];
    const points = group.rows.map((row, index) => ({
      x:
        plot.x +
        (plot.width * (spec.data.indexOf(row) + 0.5)) / spec.data.length,
      y:
        plot.y +
        plot.height -
        ((chartNumber(row[spec.y.field]) - min) / range) * plot.height,
      value: chartNumber(row[spec.y.field]),
      index,
    }));

    if (spec.mark === "bar") {
      const slot = plot.width / spec.data.length;
      points.forEach((point) => {
        const baseline = plot.y + plot.height - ((0 - min) / range) * plot.height;
        const barHeight = Math.max(1, Math.abs(baseline - point.y));
        doc
          .save()
          .roundedRect(
            point.x - Math.max(3, slot * 0.32),
            Math.min(point.y, baseline),
            Math.max(6, slot * 0.64),
            barHeight,
            2,
          )
          .fill(color)
          .restore();
      });
    } else {
      if (spec.mark === "area" && points.length > 1) {
        const baseline = plot.y + plot.height - ((0 - min) / range) * plot.height;
        doc.save().moveTo(points[0].x, baseline).lineTo(points[0].x, points[0].y);
        points.slice(1).forEach((point) => doc.lineTo(point.x, point.y));
        doc
          .lineTo(points.at(-1)!.x, baseline)
          .closePath()
          .fillOpacity(0.15)
          .fill(color)
          .fillOpacity(1)
          .restore();
      }
      if (spec.mark !== "scatter" && points.length > 1) {
        doc.save().moveTo(points[0].x, points[0].y);
        points.slice(1).forEach((point) => doc.lineTo(point.x, point.y));
        doc.lineWidth(2).strokeColor(color).stroke().restore();
      }
      points.forEach((point) => {
        doc.save().circle(point.x, point.y, 3.2).fill(color).restore();
      });
    }
  });

  const xIndexes = Array.from(
    new Set([0, Math.floor((spec.data.length - 1) / 2), spec.data.length - 1]),
  );
  xIndexes.forEach((index) => {
    const value = text(spec.data[index]?.[spec.x.field]);
    const x = plot.x + (plot.width * (index + 0.5)) / spec.data.length;
    doc
      .font("Helvetica")
      .fontSize(7)
      .fillColor(COLORS.faint)
      .text(value, x - 45, plot.y + plot.height + 11, {
        width: 90,
        align: "center",
        ellipsis: true,
      });
  });
  doc
    .font("Helvetica-Bold")
    .fontSize(8)
    .fillColor(COLORS.muted)
    .text(text(spec.y.label ?? spec.y.field), boxX + 8, boxY + 12)
    .text(text(spec.x.label ?? spec.x.field), plot.x, boxY + boxHeight - 24, {
      width: plot.width,
      align: "center",
    });

  if (seriesField && seriesNames.length > 1) {
    seriesNames.slice(0, 4).forEach((name, index) => {
      const x = plot.x + index * 115;
      doc.save().circle(x, boxY + boxHeight - 11, 3).fill(palette[index]).restore();
      doc
        .font("Helvetica")
        .fontSize(7)
        .fillColor(COLORS.muted)
        .text(name, x + 7, boxY + boxHeight - 15, { width: 102, ellipsis: true });
    });
  }
  doc.y = boxY + boxHeight + 8;
}

function tableWidths(doc: PDFKit.PDFDocument, spec: TableSpec) {
  const available = doc.page.width - PAGE_MARGIN * 2;
  const weights = spec.columns.map((column) => {
    const sample = spec.rows
      .slice(0, 20)
      .map((row) => text(row[column.key]).length)
      .reduce((longest, length) => Math.max(longest, length), column.label.length);
    return Math.min(28, Math.max(8, sample));
  });
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  return weights.map((weight) => (available * weight) / total);
}

function drawTableHeader(
  doc: PDFKit.PDFDocument,
  spec: TableSpec,
  widths: number[],
) {
  const y = doc.y;
  let x = PAGE_MARGIN;
  doc
    .save()
    .roundedRect(PAGE_MARGIN, y, doc.page.width - PAGE_MARGIN * 2, 31, 7)
    .fill(COLORS.purpleSoft)
    .restore();
  spec.columns.forEach((column, index) => {
    doc
      .font("Helvetica-Bold")
      .fontSize(7)
      .fillColor(COLORS.purple)
      .text(text(column.label).toUpperCase(), x + 6, y + 10, {
        width: widths[index] - 12,
        height: 12,
        ellipsis: true,
      });
    x += widths[index];
  });
  doc.y = y + 34;
}

function drawTable(doc: PDFKit.PDFDocument, spec: TableSpec) {
  const widths = tableWidths(doc, spec);
  drawTableHeader(doc, spec, widths);

  spec.rows.forEach((row, rowIndex) => {
    doc.font("Helvetica").fontSize(7.4);
    const heights = spec.columns.map((column, index) =>
      doc.heightOfString(text(row[column.key]), {
        width: widths[index] - 12,
        lineGap: 1,
      }),
    );
    const rowHeight = Math.max(29, ...heights.map((height) => height + 13));
    if (doc.y + rowHeight > doc.page.height - 60) {
      addPage(doc, "landscape");
      label(doc, `${spec.title} - continued`);
      doc.moveDown(0.8);
      drawTableHeader(doc, spec, widths);
    }

    const y = doc.y;
    if (rowIndex % 2 === 0) {
      doc
        .save()
        .rect(PAGE_MARGIN, y, doc.page.width - PAGE_MARGIN * 2, rowHeight)
        .fill(COLORS.paper)
        .restore();
    }
    let x = PAGE_MARGIN;
    spec.columns.forEach((column, index) => {
      doc
        .font("Helvetica")
        .fontSize(7.4)
        .fillColor(COLORS.ink)
        .text(text(row[column.key]), x + 6, y + 7, {
          width: widths[index] - 12,
          lineGap: 1,
        });
      x += widths[index];
    });
    doc
      .save()
      .moveTo(PAGE_MARGIN, y + rowHeight)
      .lineTo(doc.page.width - PAGE_MARGIN, y + rowHeight)
      .lineWidth(0.5)
      .strokeColor(COLORS.line)
      .stroke()
      .restore();
    doc.y = y + rowHeight;
  });
}

function drawCover(
  doc: PDFKit.PDFDocument,
  report: VisualResponseData,
  runId: string,
) {
  label(doc, "Trinetra visual incident report");
  doc
    .moveDown(1)
    .font("Helvetica-Bold")
    .fontSize(30)
    .fillColor(COLORS.ink)
    .text(text(report.title), { lineGap: 3 });
  doc.moveDown(1.2);

  const verdictY = doc.y;
  const verdictHeight = Math.max(
    116,
    doc.heightOfString(text(report.verdict), {
      width: doc.page.width - PAGE_MARGIN * 2 - 42,
      lineGap: 4,
    }) + 70,
  );
  roundedCard(
    doc,
    PAGE_MARGIN,
    verdictY,
    doc.page.width - PAGE_MARGIN * 2,
    verdictHeight,
    COLORS.purpleSoft,
  );
  doc
    .font("Helvetica-Bold")
    .fontSize(8)
    .fillColor(COLORS.purple)
    .text("VERDICT", PAGE_MARGIN + 21, verdictY + 20);
  doc
    .font("Helvetica-Bold")
    .fontSize(17)
    .fillColor(COLORS.ink)
    .text(text(report.verdict), PAGE_MARGIN + 21, verdictY + 43, {
      width: doc.page.width - PAGE_MARGIN * 2 - 42,
      lineGap: 4,
    });
  doc.y = verdictY + verdictHeight + 28;

  label(doc, "Report contents");
  doc.moveDown(0.8);
  report.panels.forEach((panel, index) => {
    doc
      .font("Helvetica-Bold")
      .fontSize(11)
      .fillColor(COLORS.ink)
      .text(`${index + 1}. ${text(panel.title)}`, { continued: false });
    doc
      .font("Helvetica")
      .fontSize(8.5)
      .fillColor(COLORS.faint)
      .text(`${text(panel.level).toUpperCase()}  |  ${text(panel.kind).toUpperCase()}`);
    doc.moveDown(0.65);
  });

  ensureSpace(doc, 88);
  const metaY = doc.y + 10;
  doc
    .font("Helvetica-Bold")
    .fontSize(8)
    .fillColor(COLORS.muted)
    .text("SPECIALISTS", PAGE_MARGIN, metaY)
    .font("Helvetica")
    .fontSize(9)
    .fillColor(COLORS.ink)
    .text(text(report.specialists.join("  |  ")), PAGE_MARGIN, metaY + 17, {
      width: doc.page.width - PAGE_MARGIN * 2,
    })
    .font("Helvetica")
    .fontSize(7.5)
    .fillColor(COLORS.faint)
    .text(`Trigger.dev run ${text(runId)}`, PAGE_MARGIN, metaY + 45);
}

function drawPanel(doc: PDFKit.PDFDocument, panel: VisualPanel) {
  addPage(doc, panel.kind === "table" ? "landscape" : "portrait");
  panelHeading(doc, panel);
  if (panel.kind === "metrics") drawMetrics(doc, panel.metrics);
  else if (panel.kind === "chart") drawChart(doc, panel.spec);
  else drawTable(doc, panel.table);
}

function addFooters(doc: PDFKit.PDFDocument, report: VisualResponseData) {
  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index++) {
    doc.switchToPage(index);
    const y = doc.page.height - 64;
    doc
      .save()
      .moveTo(PAGE_MARGIN, y - 9)
      .lineTo(doc.page.width - PAGE_MARGIN, y - 9)
      .lineWidth(0.5)
      .strokeColor(COLORS.line)
      .stroke()
      .restore();
    doc
      .font("Helvetica-Bold")
      .fontSize(7)
      .fillColor(COLORS.faint)
      .text("TRINETRA", PAGE_MARGIN, y, {
        width: 52,
        height: 9,
        lineBreak: false,
      })
      .font("Helvetica")
      .text(text(report.id), PAGE_MARGIN + 58, y, {
        width: doc.page.width - PAGE_MARGIN * 2 - 120,
        height: 9,
        ellipsis: true,
        lineBreak: false,
      })
      .text(`${index - range.start + 1} / ${range.count}`, doc.page.width - PAGE_MARGIN - 45, y, {
        width: 45,
        height: 9,
        align: "right",
        lineBreak: false,
      });
  }
}

export function visualReportPdfFilename(report: VisualResponseData) {
  const slug = report.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
  return `trinetra-${slug || "visual-report"}.pdf`;
}

export async function renderVisualReportPdf(
  report: VisualResponseData,
  runId: string,
) {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      autoFirstPage: false,
      bufferPages: true,
      compress: true,
      info: {
        Title: text(report.title),
        Author: "Trinetra",
        Subject: text(report.verdict),
      },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));

    addPage(doc);
    drawCover(doc, report, runId);
    report.panels.forEach((panel) => drawPanel(doc, panel));
    addFooters(doc, report);
    doc.end();
  });
}
