import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import PDFDocument from 'pdfkit';
import {
  fetchInvoiceLogoBuffer,
  resolveInvoiceBrand,
  type InvoiceBrandTheme,
} from './invoice-brand.util';
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
  constructor(private readonly config: ConfigService) {}

  async buildPdf(snapshot: OrderInvoiceSnapshot): Promise<Buffer> {
    const brand = resolveInvoiceBrand(this.config);
    const logoBuffer = await fetchInvoiceLogoBuffer(brand.logoUrl);
    return this.renderPdf(snapshot, brand, logoBuffer);
  }

  private renderPdf(
    snapshot: OrderInvoiceSnapshot,
    brand: InvoiceBrandTheme,
    logoBuffer: Buffer | null,
  ): Promise<Buffer> {
    const { colors } = brand;
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 48, size: 'A4', bufferPages: true });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const pageW = doc.page.width;
      const margin = 48;
      const headerH = 76;
      const currency = snapshot.currency;
      const ref = orderInvoiceRef(snapshot.orderId);
      const subLines = (snapshot.items ?? []).reduce(
        (acc, line) =>
          acc +
          Math.max(0, Number(line.quantity) || 0) *
            Math.max(0, Number(line.price) || 0),
        0,
      );

      const drawPageHeader = () => {
        doc.save();
        doc.rect(0, 0, pageW, headerH).fill(colors.primary);
        const logoX = margin;
        const logoSize = 44;
        let textX = logoX;
        if (logoBuffer) {
          try {
            doc.image(logoBuffer, logoX, 16, {
              fit: [logoSize, logoSize],
              align: 'center',
              valign: 'center',
            });
            textX = logoX + logoSize + 12;
          } catch {
            textX = logoX;
          }
        }
        const headerTitle =
          snapshot.storeName?.trim() || 'Facture';
        doc
          .fillColor(colors.textOnDark)
          .font('Helvetica-Bold')
          .fontSize(16)
          .text(headerTitle, textX, 18, {
            width: pageW - textX - margin,
          });
        doc
          .font('Helvetica')
          .fontSize(10)
          .text('Facture / reçu de commande', textX, 38, {
            width: pageW - textX - margin,
          });
        doc
          .rect(0, headerH - 3, pageW, 3)
          .fill(colors.accent);
        doc.restore();
        doc.y = headerH + 20;
      };

      drawPageHeader();

      doc
        .fillColor(colors.textMuted)
        .fontSize(9)
        .font('Helvetica')
        .text(
          `N° ${snapshot.orderId} · Réf. ${ref} · ${formatInvoiceDate(snapshot.createdAt)}`,
          margin,
          doc.y,
          { width: pageW - margin * 2 },
        );
      doc.moveDown(0.8);

      doc.fillColor(colors.primary).fontSize(11).font('Helvetica-Bold');
      doc.text(snapshot.storeName);
      doc.fillColor(colors.text).font('Helvetica');
      if (snapshot.storeAddressLine?.trim()) {
        doc.fillColor(colors.textMuted).text(snapshot.storeAddressLine.trim());
        doc.fillColor(colors.text);
      }
      doc.moveDown(0.5);
      doc.text(`Client : ${snapshot.clientName}`);
      doc.text(`E-mail : ${snapshot.clientEmail}`);
      doc.text(`Livraison / retrait : ${snapshot.deliveryLine}`);
      doc.text(
        `Moyen de paiement : ${inferInvoicePaymentMethodLabel(snapshot.status)}`,
      );
      if (snapshot.pickupCode?.trim()) {
        doc.moveDown(0.4);
        const codeY = doc.y;
        const code = snapshot.pickupCode.trim().toUpperCase();
        doc
          .roundedRect(margin, codeY, pageW - margin * 2, 36, 8)
          .lineWidth(1.5)
          .dash(5, { space: 4 })
          .strokeColor(colors.accent)
          .stroke();
        doc
          .undash()
          .fillColor(colors.primary)
          .font('Helvetica-Bold')
          .fontSize(11)
          .text(`Code retrait : ${code}`, margin + 12, codeY + 10, {
            width: pageW - margin * 2 - 24,
            align: 'center',
          });
        doc.font('Helvetica').fontSize(9);
        doc.y = codeY + 44;
        doc.fillColor(colors.text);
      }
      if (snapshot.couponCode?.trim()) {
        doc.text(`Code promo : ${snapshot.couponCode.trim().toUpperCase()}`);
      }

      doc.moveDown(1);
      const tableTop = doc.y;
      const col1 = margin;
      const col2 = 320;
      const col3 = 380;
      const col4 = 460;
      const tableW = pageW - margin * 2;

      doc.save();
      doc.rect(col1, tableTop, tableW, 18).fill(colors.background);
      doc.restore();
      doc.fillColor(colors.primary).font('Helvetica-Bold').fontSize(9);
      doc.text('Article', col1, tableTop + 4);
      doc.text('Qté', col2, tableTop + 4, { width: 50, align: 'center' });
      doc.text('Prix unit.', col3, tableTop + 4, { width: 70, align: 'right' });
      doc.text('Montant', col4, tableTop + 4, { width: 90, align: 'right' });
      doc
        .moveTo(col1, tableTop + 18)
        .lineTo(col1 + tableW, tableTop + 18)
        .strokeColor(colors.accent)
        .lineWidth(0.75)
        .stroke();

      let y = tableTop + 26;
      doc.font('Helvetica').fontSize(9).fillColor(colors.text);

      for (const line of snapshot.items ?? []) {
        const label = String(line.label ?? 'Article').trim() || 'Article';
        const qty = Math.max(0, Number(line.quantity) || 0);
        const unit = Math.max(0, Number(line.price) || 0);
        const extras = lineCustomizationText(line);
        const lineTotal = qty * unit;

        if (y > 700) {
          doc.addPage();
          drawPageHeader();
          y = doc.y;
        }

        doc.font('Helvetica-Bold').fillColor(colors.text).text(label, col1, y, {
          width: 260,
        });
        const labelH = doc.heightOfString(label, { width: 260 });
        let extraY = y + labelH + 2;
        if (extras) {
          doc.font('Helvetica').fontSize(8).fillColor(colors.textMuted);
          doc.text(extras, col1, extraY, { width: 260 });
          extraY += doc.heightOfString(extras, { width: 260 }) + 4;
          doc.fontSize(9).fillColor(colors.text);
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

      y = Math.max(y + 12, doc.y);
      doc
        .moveTo(col1, y)
        .lineTo(col1 + tableW, y)
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
        doc.font('Helvetica').fontSize(10).fillColor(colors.text);
        doc.text(left, col1, y);
        doc.text(right, col4, y, { width: 90, align: 'right' });
        y += 18;
      }

      y += 4;
      doc.save();
      doc.rect(col1, y, tableW, 32).fill(colors.background);
      doc
        .moveTo(col1, y)
        .lineTo(col1 + tableW, y)
        .strokeColor(colors.primary)
        .lineWidth(1.5)
        .stroke();
      doc.restore();
      doc.fillColor(colors.primary).font('Helvetica-Bold').fontSize(12);
      doc.text('Total TTC', col1 + 8, y + 9);
      doc.text(formatInvoiceMoney(snapshot.totalPrice, currency), col4, y + 9, {
        width: 90,
        align: 'right',
      });
      y += 40;

      const footerParts = ['Document généré automatiquement.'];
      if (brand.websiteUrl?.trim()) {
        footerParts.push(brand.websiteUrl.trim());
      }
      doc
        .fillColor(colors.textMuted)
        .font('Helvetica')
        .fontSize(8)
        .text(footerParts.join(' '), col1, y, {
          width: tableW,
          align: 'left',
        });

      doc.end();
    });
  }
}
