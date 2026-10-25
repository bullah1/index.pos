/** 01XXXXXXXXX → 8801XXXXXXXXX (for WhatsApp links); "" when not a Bangladeshi mobile. */
export function bdPhone(p: string | null | undefined) {
  const d = (p ?? "").replace(/\D/g, "");
  if (/^01\d{9}$/.test(d)) return "88" + d;
  if (/^8801\d{9}$/.test(d)) return d;
  return "";
}

/** Opens WhatsApp with the message ready; without a number the person picks the chat. */
export function openWhatsApp(phone: string | null | undefined, text: string) {
  window.open(`https://wa.me/${bdPhone(phone)}?text=${encodeURIComponent(text)}`, "_blank", "noopener");
}

/**
 * Prints one element on its own clean page (A4 or 80 mm roll), using the app's styles,
 * so it always comes out at the top of the page whichever dialog it was opened from.
 */
export function printElement(el: Element | null | undefined, size: "a4" | "thermal" = "a4") {
  if (!el) return;
  const styles = [...document.querySelectorAll('link[rel="stylesheet"], style')].map((n) => n.outerHTML).join("");
  const page = size === "a4" ? "@page { size: A4; margin: 12mm; }" : "@page { size: 80mm auto; margin: 3mm; }";
  const frame = document.createElement("iframe");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>Print</title>${styles}<style>${page}
    html,body{background:#fff!important;margin:0}
    #print-area{border:0!important;border-radius:0!important;box-shadow:none!important;margin:0!important;max-width:none!important;width:100%!important}
    *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
    @media print{body *{visibility:visible!important}#print-area{position:static!important}}</style></head>
    <body class="font-sans">${el.outerHTML}</body></html>`);
  doc.close();
  setTimeout(() => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    setTimeout(() => frame.remove(), 1000);
  }, 400);
}
