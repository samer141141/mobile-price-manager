import { profit } from "./inventory.mjs";
export async function exportInventory(phones, columns, format, scope) {
  if (!columns.length) throw new Error("Select at least one column.");
  const rows = phones.map((p) =>
    columns.map(([k]) => (k === "profit" ? profit(p) : (p[k] ?? ""))),
  );
  const name = `lager-iphone-${scope}-${new Date().toISOString().slice(0, 10)}`;
  if (format === "xlsx") {
    const ExcelJS = await import("exceljs"),
      book = new ExcelJS.default.Workbook(),
      sheet = book.addWorksheet("Phones");
    sheet.addRow(columns.map(([, label]) => label));
    rows.forEach((row) => sheet.addRow(row));
    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF153E35" },
    };
    sheet.columns.forEach((col, i) => {
      col.width = columns[i][0] === "notes" ? 45 : 22;
      if (
        [
          "purchase_price",
          "repair_cost",
          "other_cost",
          "selling_price",
          "profit",
        ].includes(columns[i][0])
      )
        col.numFmt = '#,##0.00 "SEK"';
    });
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    const url = URL.createObjectURL(
      new Blob([await book.xlsx.writeBuffer()], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = name + ".xlsx";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } else {
    const { jsPDF } = await import("jspdf"),
      { autoTable } = await import("jspdf-autotable");
    const doc = new jsPDF({ orientation: "landscape", format: "a3" });
    doc.setFontSize(18);
    doc.text("Lager iPhone", 14, 16);
    doc.setFontSize(10);
    doc.text(
      `${scope === "sold" ? "Sold" : "Available"} Phones | ${phones.length} records | Prices in SEK`,
      14,
      24,
    );
    autoTable(doc, {
      head: [columns.map(([, label]) => label)],
      body: rows,
      startY: 30,
      styles: { fontSize: 8, cellPadding: 3, overflow: "linebreak" },
      headStyles: { fillColor: [21, 62, 53] },
      horizontalPageBreak: true,
      margin: 14,
    });
    doc.save(name + ".pdf");
  }
}
