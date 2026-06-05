import ExcelJS from 'exceljs';

export type OpsReportSheet = {
  name: string;
  headers: string[];
  rows: Array<Array<string | number | null>>;
};

export async function buildOpsReportWorkbook(
  sheets: OpsReportSheet[],
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Wise Eat';
  workbook.created = new Date();

  for (const sheet of sheets) {
    const safeName = sheet.name.slice(0, 31).replace(/[\\/*?:[\]]/g, '_');
    const ws = workbook.addWorksheet(safeName || 'Sheet');
    ws.addRow(sheet.headers);
    const headerRow = ws.getRow(1);
    headerRow.font = { bold: true };
    for (const row of sheet.rows) {
      ws.addRow(row);
    }
    ws.columns.forEach((col) => {
      let max = 12;
      col.eachCell?.({ includeEmpty: false }, (cell) => {
        const len = String(cell.value ?? '').length;
        if (len > max) max = Math.min(len + 2, 48);
      });
      col.width = max;
    });
  }

  const buf = await workbook.xlsx.writeBuffer();
  return Buffer.from(buf);
}
