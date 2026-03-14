/**
 * ═══════════════════════════════════════════════════════
 *  eBloodBank — PDF Donation Certificate Generator
 *  File: pdf.js
 *  
 *  SETUP:
 *  npm install pdfkit
 * ═══════════════════════════════════════════════════════
 */

const PDFDocument = require('pdfkit');
const path        = require('path');
const fs          = require('fs');

/* ══════════════════════════════════════
   GENERATE DONATION CERTIFICATE
══════════════════════════════════════ */
function generateCertificate(donorData) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        layout: 'landscape',
        margins: { top: 40, bottom: 40, left: 60, right: 60 }
      });

      const buffers = [];
      doc.on('data', chunk => buffers.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', reject);

      const W = doc.page.width;
      const H = doc.page.height;

      /* ── BACKGROUND ── */
      doc.rect(0, 0, W, H).fill('#FFF8F8');

      /* ── RED BORDER ── */
      doc.rect(20, 20, W-40, H-40)
         .lineWidth(3).stroke('#C0152A');
      doc.rect(25, 25, W-50, H-50)
         .lineWidth(1).stroke('#E8A0A8');

      /* ── TOP RED BANNER ── */
      doc.rect(20, 20, W-40, 80).fill('#C0152A');

      /* ── LOGO / TITLE IN BANNER ── */
      doc.fontSize(28).font('Helvetica-Bold')
         .fillColor('white')
         .text('🩸 eBloodBank', 0, 38, { align: 'center' });

      doc.fontSize(11).font('Helvetica')
         .fillColor('rgba(255,255,255,0.85)')
         .text('India\'s Trusted Blood Bank Network', 0, 70, { align: 'center' });

      /* ── CERTIFICATE HEADING ── */
      doc.fontSize(32).font('Helvetica-Bold')
         .fillColor('#8B0000')
         .text('Certificate of Blood Donation', 0, 125, { align: 'center' });

      /* ── DECORATIVE LINE ── */
      const lineY = 170;
      doc.moveTo(100, lineY).lineTo(W-100, lineY)
         .lineWidth(1.5).stroke('#C0152A');
      doc.circle(W/2, lineY, 4).fill('#C0152A');

      /* ── MAIN CONTENT ── */
      doc.fontSize(13).font('Helvetica')
         .fillColor('#444')
         .text('This is to certify that', 0, 190, { align: 'center' });

      /* ── DONOR NAME ── */
      doc.fontSize(30).font('Helvetica-Bold')
         .fillColor('#1A0A0A')
         .text(donorData.donorName || 'Donor Name', 0, 215, { align: 'center' });

      /* ── UNDERLINE ── */
      const nameWidth = 300;
      doc.moveTo((W-nameWidth)/2, 255)
         .lineTo((W+nameWidth)/2, 255)
         .lineWidth(1).stroke('#C0152A');

      /* ── DESCRIPTION ── */
      doc.fontSize(12).font('Helvetica')
         .fillColor('#555')
         .text(
           'has successfully donated blood and demonstrated extraordinary compassion\nfor humanity by contributing to saving precious lives.',
           80, 270, { align: 'center', lineGap: 4 }
         );

      /* ── DETAILS TABLE ── */
      const tableY  = 320;
      const colW    = (W - 140) / 4;
      const details = [
        { label: 'Blood Group', value: donorData.bloodGroup || 'O+' },
        { label: 'Units Donated', value: (donorData.units || 1) + ' Unit(s)' },
        { label: 'Date of Donation', value: donorData.donationDate || new Date().toLocaleDateString('en-IN') },
        { label: 'Hospital', value: donorData.hospitalName || 'eBloodBank' },
      ];

      details.forEach((item, i) => {
        const x = 70 + i * colW;
        // Box
        doc.roundedRect(x, tableY, colW - 10, 70, 8)
           .fillAndStroke('#FFF0F2', '#FFCCD5');
        // Label
        doc.fontSize(9).font('Helvetica').fillColor('#888')
           .text(item.label, x, tableY + 12, { width: colW-10, align: 'center' });
        // Value
        doc.fontSize(13).font('Helvetica-Bold').fillColor('#C0152A')
           .text(item.value, x, tableY + 32, { width: colW-10, align: 'center' });
      });

      /* ── CERTIFICATE ID ── */
      const certId = 'EBB-' + Date.now().toString(36).toUpperCase();
      doc.fontSize(10).font('Helvetica').fillColor('#888')
         .text('Certificate ID: ' + certId, 0, 410, { align: 'center' });

      /* ── LIVES SAVED ── */
      doc.roundedRect(W/2 - 120, 425, 240, 40, 8)
         .fillAndStroke('#FFF0F2', '#FFCCD5');
      doc.fontSize(12).font('Helvetica-Bold').fillColor('#C0152A')
         .text('❤️  Your donation can save up to 3 lives!', W/2 - 120, 440, { width: 240, align: 'center' });

      /* ── SIGNATURES ── */
      const sigY = 490;
      // Left sig
      doc.moveTo(100, sigY).lineTo(280, sigY).lineWidth(1).stroke('#333');
      doc.fontSize(10).font('Helvetica').fillColor('#555')
         .text('Authorized Signatory', 100, sigY + 5, { width: 180, align: 'center' })
         .text('eBloodBank Authority', 100, sigY + 18, { width: 180, align: 'center' });

      // Right sig
      doc.moveTo(W-280, sigY).lineTo(W-100, sigY).lineWidth(1).stroke('#333');
      doc.fontSize(10).font('Helvetica').fillColor('#555')
         .text('Hospital Representative', W-280, sigY + 5, { width: 180, align: 'center' })
         .text(donorData.hospitalName || 'Blood Bank', W-280, sigY + 18, { width: 180, align: 'center' });

      /* ── BOTTOM FOOTER ── */
      doc.rect(20, H-60, W-40, 40).fill('#C0152A');
      doc.fontSize(9).font('Helvetica').fillColor('white')
         .text(
           'eBloodBank.in  |  Saving lives through technology  |  ' + new Date().getFullYear(),
           0, H-48, { align: 'center' }
         );

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { generateCertificate };