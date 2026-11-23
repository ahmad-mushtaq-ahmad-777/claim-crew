// Turns the plain-text draft into HTML that looks the same in Gmail and Outlook.
// Outlook ignores <pre> line breaks, so every line is its own paragraph and the
// "Label: value" lines go in a table.
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const P = 'style="margin:0 0 4px 0"';

// `inherit` keeps the page's own text colors (used for the on-screen preview).
export function draftToHtml(body: string, opts: { inherit?: boolean } = {}): string {
  const label = opts.inherit ? "opacity:.65" : "color:#555";
  const wrap = opts.inherit
    ? "font-size:14px"
    : "font-family:Calibri,Arial,sans-serif;font-size:14px;color:#222";
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let rows: string[] = [];

  const flush = () => {
    if (!rows.length) return;
    out.push(
      `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 4px 16px;border-collapse:collapse">${rows.join("")}</table>`,
    );
    rows = [];
  };

  for (const line of lines) {
    const detail = line.match(/^ {2}([A-Za-z][A-Za-z ]*?):\s+(.+)$/);
    if (detail) {
      rows.push(
        `<tr><td style="padding:1px 16px 1px 0;${label}">${esc(detail[1])}</td><td style="padding:1px 0">${esc(detail[2])}</td></tr>`,
      );
      continue;
    }
    flush();
    if (!line.trim()) {
      out.push('<p style="margin:0 0 8px 0">&nbsp;</p>');
    } else if (/^ {2}\d+\./.test(line)) {
      out.push(`<p ${P.replace('"margin:0 0 4px 0"', '"margin:0 0 4px 16px"')}>${esc(line.trim())}</p>`);
    } else if (line === "Claim details" || line === "Attachments") {
      out.push(`<p ${P}><b>${esc(line)}</b></p>`);
    } else {
      out.push(`<p ${P}>${esc(line)}</p>`);
    }
  }
  flush();

  return `<div style="${wrap}">${out.join("")}</div>`;
}
