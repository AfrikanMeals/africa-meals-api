import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import {
  formatInvoiceDate,
  formatInvoiceMoney,
  inferInvoicePaymentMethodLabel,
  lineCustomizationText,
  orderInvoiceRef,
  type OrderInvoiceSnapshot,
} from './order-invoice.util';

@Injectable()
export class OrderInvoicePdfService {
  async buildPdf(snapshot: OrderInvoiceSnapshot): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 48, size: 'A4' });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const currency = snapshot.currency;
      const ref = orderInvoiceRef(snapshot.orderId);
      const subLines = (snapshot.items ?? []).reduce(
        (acc, line) =>
          acc +
          Math.max(0, Number(line.quantity) || 0) *
            Math.max(0, Number(line.price) || 0),
        0,
      );

      doc
        .fontSize(20)
        .font('Helvetica-Bold')
        .text('Facture / commande', { align: 'left' });
      doc.moveDown(0.4);
      doc
        .fontSize(10)
        .font('Helvetica')
        .fillColor('#444444')
        .text(
          `N° ${snapshot.orderId} · Réf. ${ref} · ${formatInvoiceDate(snapshot.createdAt)}`,
        );
      doc.fillColor('#000000');
      doc.moveDown(1);

      doc.fontSize(11).font('Helvetica-Bold').text(snapshot.storeName);
      doc.font('Helvetica');
      if (snapshot.storeAddressLine?.trim()) {
        doc.fillColor('#555555').text(snapshot.storeAddressLine.trim());
        doc.fillColor('#000000');
      }
      doc.moveDown(0.6);
      doc.text(`Client : ${snapshot.clientName}`);
      doc.text(`E-mail : ${snapshot.clientEmail}`);
      doc.text(`Livraison / retrait : ${snapshot.deliveryLine}`);
      doc.text(
        `Moyen de paiement : ${inferInvoicePaymentMethodLabel(snapshot.status)}`,
      );
      if (snapshot.pickupCode?.trim()) {
        doc
          .font('Helvetica-Bold')
          .text(`Code retrait : ${snapshot.pickupCode.trim().toUpperCase()}`);
        doc.font('Helvetica');
      }
      if (snapshot.couponCode?.trim()) {
        doc.text(`Code promo : ${snapshot.couponCode.trim().toUpperCase()}`);
      }

      doc.moveDown(1.2);
      const tableTop = doc.y;
      const col1 = 48;
      const col2 = 320;
      const col3 = 380;
      const col4 = 460;

      doc.font('Helvetica-Bold').fontSize(9);
      doc.text('Article', col1, tableTop);
      doc.text('Qté', col2, tableTop, { width: 50, align: 'center' });
      doc.text('Prix unit.', col3, tableTop, { width: 70, align: 'right' });
      doc.text('Montant', col4, tableTop, { width: 90, align: 'right' });
      doc
        .moveTo(col1, tableTop + 14)
        .lineTo(545, tableTop + 14)
        .strokeColor('#e5e7eb')
        .stroke();

      let y = tableTop + 22;
      doc.font('Helvetica').fontSize(9).fillColor('#111111');

      for (const line of snapshot.items ?? []) {
        const label = String(line.label ?? 'Article').trim() || 'Article';
        const qty = Math.max(0, Number(line.quantity) || 0);
        const unit = Math.max(0, Number(line.price) || 0);
        const extras = lineCustomizationText(line);
        const lineTotal = qty * unit;

        if (y > 700) {
          doc.addPage();
          y = 48;
        }

        doc.font('Helvetica-Bold').text(label, col1, y, { width: 260 });
        const labelH = doc.heightOfString(label, { width: 260 });
        let extraY = y + labelH + 2;
        if (extras) {
          doc.font('Helvetica').fontSize(8).fillColor('#666666');
          doc.text(extras, col1, extraY, { width: 260 });
          extraY += doc.heightOfString(extras, { width: 260 }) + 4;
          doc.fontSize(9).fillColor('#111111');
        }
        const rowBottom = Math.max(extraY, y + 14);

        doc.font('Helvetica').text(String(qty), col2, y, {
          width: 50,
          align: 'center',
        });
        doc.text(formatInvoiceMoney(unit, currency), col3, y, {
          width: 70,
          align: 'right',
        });
        doc.text(formatInvoiceMoney(lineTotal, currency), col4, y, {
          width: 90,
          align: 'right',
        });

        y = rowBottom + 10;
      }

      if (!(snapshot.items ?? []).length) {
        doc.text('Aucune ligne', col1, y);
        y += 18;
      }

      doc.moveDown(2);
      y = Math.max(y + 12, doc.y);
      doc
        .moveTo(col1, y)
        .lineTo(545, y)
        .strokeColor('#e5e7eb')
        .stroke();
      y += 14;

      const totals = [
        ['Sous-total articles', formatInvoiceMoney(subLines, currency)],
        [
          'Frais de livraison',
          formatInvoiceMoney(snapshot.shippingPrice ?? 0, currency),
        ],
      ];
      for (const [left, right] of totals) {
        doc.font('Helvetica').fontSize(10).text(left, col1, y);
        doc.text(right, col4, y, { width: 90, align: 'right' });
        y += 18;
      }

      y += 6;
      doc
        .moveTo(col1, y)
        .lineTo(545, y)
        .strokeColor('#111111')
        .lineWidth(1.5)
        .stroke();
      y += 12;
      doc.font('Helvetica-Bold').fontSize(12);
      doc.text('Total TTC', col1, y);
      doc.text(formatInvoiceMoney(snapshot.totalPrice, currency), col4, y, {
        width: 90,
        align: 'right',
      });

      doc.moveDown(3);
      doc
        .font('Helvetica')
        .fontSize(8)
        .fillColor('#666666')
        .text(
          'Document généré automatiquement après confirmation du paiement — Wise Eat / Africa Meals.',
          { align: 'left' },
        );

      doc.end();
    });
  }
}
