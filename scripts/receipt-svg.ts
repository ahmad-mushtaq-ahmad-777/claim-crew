// Draws the made-up Iron Peak gym receipt as an SVG, so it can be rasterised and
// degraded (blur, fade) to make a receipt the Reader is unsure about.
// All names, numbers and addresses here are fictional.
export type NameStyle = { fill: string; blur: number; size: number };

export function gymReceiptSvg(member: string, nameStyle: NameStyle): string {
  const row = (label: string, value: string, y: number, valueExtra = "") =>
    `<text x="30" y="${y}" font-size="9" fill="#6b7280">${label}</text>` +
    `<text x="390" y="${y}" font-size="10" font-weight="bold" text-anchor="end" fill="#1a1f29" ${valueExtra}>${value}</text>`;
  const line = (y: number) =>
    `<line x1="30" y1="${y}" x2="390" y2="${y}" stroke="#d0d4da" stroke-width="0.6"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="840" height="1200" viewBox="0 0 420 600" font-family="Helvetica, Arial, sans-serif">
<defs><filter id="soft" x="-5%" y="-40%" width="110%" height="180%"><feGaussianBlur stdDeviation="${nameStyle.blur}"/></filter></defs>
<rect width="420" height="600" fill="#ffffff"/>
<rect width="420" height="92" fill="#0f7366"/>
<text x="30" y="46" font-size="18" font-weight="bold" fill="#fff">IRON PEAK FITNESS CLUB</text>
<text x="30" y="64" font-size="10" fill="#d9f2ec">Gym &amp; Health Club</text>
<text x="30" y="80" font-size="9" fill="#d9f2ec">Phase 5, Lahore  |  Helpline: 042-111-000-555</text>
<text x="30" y="122" font-size="13" font-weight="bold" fill="#1a1f29">MEMBERSHIP PAYMENT RECEIPT</text>
<rect x="330" y="106" width="60" height="22" fill="#eefaf6" stroke="#0f7366" stroke-width="1.5"/>
<text x="360" y="121" font-size="12" font-weight="bold" fill="#0f7366" text-anchor="middle">PAID</text>
${row("RECEIPT NO.", "IP-LHR-2026-013377", 152)}
${row("PAYMENT DATE", "23 Nov 2026, 11:20 PKT", 170)}
${row("MEMBERSHIP PERIOD", "01 Nov - 30 Nov 2026", 188)}
${line(202)}
<text x="30" y="222" font-size="9" font-weight="bold" fill="#0f7366">MEMBER INFORMATION</text>
<text x="30" y="242" font-size="9" fill="#6b7280">Member Name</text>
<text x="390" y="242" font-size="${nameStyle.size}" font-weight="bold" text-anchor="end" fill="${nameStyle.fill}" filter="url(#soft)">${member}</text>
${row("Membership ID", "IPF-20418", 260)}
${row("Plan", "Monthly Gym Membership", 278)}
${row("Address", "Block C, Phase 5, Lahore", 296)}
${line(310)}
<text x="30" y="330" font-size="9" font-weight="bold" fill="#0f7366">CHARGES</text>
<text x="30" y="348" font-size="8" fill="#6b7280">DESCRIPTION</text>
<text x="390" y="348" font-size="8" fill="#6b7280" text-anchor="end">AMOUNT (PKR)</text>
<text x="30" y="366" font-size="10" fill="#1a1f29">Monthly membership dues</text>
<text x="390" y="366" font-size="10" fill="#1a1f29" text-anchor="end">7,500.00</text>
<text x="30" y="384" font-size="10" fill="#1a1f29">Admission / locker fee</text>
<text x="390" y="384" font-size="10" fill="#1a1f29" text-anchor="end">0.00</text>
${line(396)}
<text x="30" y="418" font-size="11" font-weight="bold" fill="#1a1f29">TOTAL AMOUNT PAID</text>
<text x="390" y="418" font-size="13" font-weight="bold" fill="#1a1f29" text-anchor="end">PKR 7,500.00</text>
${line(432)}
${row("Method", "Card (demo terminal)", 452)}
${row("Transaction ID", "TXN-5530917742", 470)}
<text x="30" y="540" font-size="8" fill="#6b7280">This is a computer-generated receipt and does not require a signature.</text>
<text x="30" y="554" font-size="8" fill="#6b7280">Made-up sample for the ClaimCrew demo. Not a real business.</text>
</svg>`;
}
