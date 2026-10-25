// Writes the made-up test Documents to ../documents/*.pdf. Run: npm run generate
// Every company, product, identifier and certificate here is invented. The Helvetica standard
// font is WinAnsi only, so the text says "CO2" and "mOhm", never the subscript or omega signs.
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { mkdirSync, writeFileSync } from "node:fs";

const FOOTER = "FICTITIOUS SAMPLE DOCUMENT - invented for software testing. Not a real product, company or certificate.";

// Page items: "text" | { t, size, bold, x, gap } | { table: [[cell...]...], cols: [x...] } | { box: [lines], size }
const docs = {
  // Spec sheet, label/value pairs in two columns. Values from Origyn's made-up Voltaris example.
  "battery-01-voltaris-pack-spec.pdf": [
    [
      { t: "Voltaris Mobility - Product Specification Sheet", size: 18, bold: true },
      { t: "Voltaris NMC-800 EV Battery Pack", size: 14, bold: true, gap: 10 },
      "80 kWh lithium-ion traction battery pack for mid-size electric passenger vehicles.",
      { t: "1. Identification", bold: true, gap: 14 },
      { table: [
        ["Battery identifier", "BAT-EU-2027-000214"],
        ["Battery category", "Electric vehicle battery (EV)"],
        ["Manufacturer", "Voltaris Cell Systems Sp. z o.o. (MFR-EU-001982)"],
        ["Manufacturer address", "ul. Przemyslowa 8, 62-052 Komorniki, Poland"],
        ["Place of manufacture", "Komorniki, Poland"],
        ["Date of manufacture", "February 2027"],
      ], cols: [50, 200] },
      { t: "2. Electrical characteristics", bold: true, gap: 14 },
      { table: [
        ["Rated capacity", "220 Ah"],
        ["Nominal voltage", "360 V"],
        ["Minimum voltage", "288 V"],
        ["Maximum voltage", "403 V"],
        ["Original power capability (nominal)", "150 kW"],
        ["Initial round-trip energy efficiency (nominal)", "95 %"],
        ["Initial internal resistance (nominal)", "cell 0.0012 ohm, pack 0.135 ohm"],
        ["Expected lifetime (nominal)", "2500 cycles (IEC 62660-1, 25 °C, 1C/1C, 100% DoD)"],
      ], cols: [50, 300] },
      { t: "3. Physical", bold: true, gap: 14 },
      { table: [
        ["Nominal mass", "482 kg"],
        ["Idle temperature range", "-20 °C to 45 °C"],
      ], cols: [50, 300] },
    ],
    [
      { t: "4. Materials and composition", bold: true },
      { table: [
        ["Chemistry", "Lithium nickel manganese cobalt oxide (NMC 811), graphite anode"],
        ["Critical raw materials", "Lithium, cobalt, nickel, natural graphite"],
      ], cols: [50, 200] },
      "Hazardous substances: Lithium hexafluorophosphate (LiPF6) 1.1% of pack mass; ethylene carbonate 2.4%;",
      "cobalt compounds 3.2%; nickel compounds 9.8%.",
      { t: "5. Carbon footprint", bold: true, gap: 14 },
      "Life-cycle carbon footprint per kWh of total energy over the service life: 41.8 kg CO2e/kWh",
      "Carbon footprint performance class: Class B",
      { t: "6. Recycled content (pre- and post-consumer combined)", bold: true, gap: 14 },
      { table: [
        ["Material", "Recycled share"],
        ["Cobalt", "22 %"],
        ["Lithium", "11 %"],
        ["Nickel", "16 %"],
        ["Lead", "0 %"],
      ], cols: [50, 200] },
    ],
  ],

  // Cell datasheet with a parameter table. Capacity in mAh (needs conversion to Ah), mass in g.
  "battery-02-kestrel-18650-cell-datasheet.pdf": [
    [
      { t: "KESTREL ENERGY", size: 20, bold: true },
      { t: "Lithium-ion Cylindrical Cell  KC-18650-32", size: 14, bold: true },
      "Datasheet revision C, issued 2026-03-02",
      "Kestrel Energy Sdn. Bhd., Lot 88 Jalan Perindustrian 4, 11900 Bayan Lepas, Penang, Malaysia",
      { t: "Made in Malaysia", gap: 4 },
      "Category under Regulation (EU) 2023/1542: portable battery",
      "Chemistry: Li-ion, NMC (LiNiMnCoO2) cathode, graphite anode",
      { t: "Specifications", bold: true, size: 13, gap: 14 },
      { table: [
        ["Item", "Value", "Condition"],
        ["Nominal capacity", "3200 mAh", "0.2C discharge to 2.5 V, 25 °C"],
        ["Nominal voltage", "3.6 V", ""],
        ["Charge voltage (max)", "4.20 V", "CC/CV"],
        ["Discharge cut-off voltage", "2.50 V", "minimum"],
        ["Max. continuous discharge current", "10 A", "25 °C"],
        ["AC impedance (max)", "35 mOhm", "1 kHz, 50% SoC"],
        ["Cycle life (min)", "500 cycles", "to 80% of nominal capacity"],
        ["Weight (max)", "46.5 g", ""],
        ["Operating temperature", "-10 to 60 °C", "discharge"],
        ["Storage temperature", "-20 to 45 °C", "up to 3 months"],
      ], cols: [50, 250, 350] },
      { t: "Values are typical unless stated otherwise. Specifications may change without notice.", size: 9, gap: 14 },
    ],
  ],

  // Prose test report, two pages. Operating temperature is given, idle temperature is not.
  "battery-03-cityglide-ebike-test-report.pdf": [
    [
      { t: "Arbor Test Laboratories - Test Report AT-2026-1184", size: 16, bold: true },
      "Client: Arbor Mobility Components S.L.",
      { t: "Test item", bold: true, gap: 14 },
      "The test item is a CityGlide CG-48-14 e-bike battery, a light means of transport (LMT) battery,",
      "serial number CG48-2026-0007731, manufactured on 14 September 2026 by Arbor Mobility Components S.L.,",
      "Calle de la Industria 14, 46980 Paterna, Spain, at its plant in Paterna, Spain.",
      "The pack is built from 16 lithium iron phosphate (LiFePO4) prismatic cells in series.",
      "According to the manufacturer the rated capacity is 14 Ah and the nominal voltage is 51.2 V.",
      "The discharge cut-off (minimum voltage) is 40.0 V and the end-of-charge (maximum voltage) is 58.4 V.",
      "The nominal mass declared on the label is 3.9 kg.",
      { t: "Results", bold: true, gap: 14 },
      "Capacity measured at 0.5C and 25 °C was 13.8 Ah, which is within the tolerance of the rated value.",
      "The maximum continuous power capability was 750 W. The typical initial round-trip energy efficiency",
      "was 96.1 % at 0.5C. The typical pack internal resistance (DC, 25 °C, 50% SoC) was 85 mOhm.",
      "Expected lifetime is 2000 cycles (nominal) to 80% of rated capacity.",
      "Operating temperature range (discharge): -10 °C to 55 °C.",
    ],
    [
      { t: "Sustainability declarations supplied by the client", bold: true },
      "Critical raw materials present: lithium, natural graphite.",
      "Hazardous substances: electrolyte containing lithium hexafluorophosphate (LiPF6).",
      "Carbon footprint: 72.4 kg CO2e/kWh (declared by the client, not verified by this laboratory).",
      "Recycled lithium content: 4 % (pre- and post-consumer combined).",
      { t: "Approved by: J. Doe, Head of Laboratory. This report covers only the item tested.", size: 9, gap: 20 },
    ],
  ],

  // Storage module brochure + data table. PLANTED ERROR: the page-1 highlight box shows a 2031
  // target of 16 % recycled lithium; the actual measured share in the page-2 table is 6 %.
  "battery-04-helion-storage-module.pdf": [
    [
      { t: "HELION STORAGE", size: 22, bold: true },
      { t: "Helion HX-280 LFP storage module", size: 15, bold: true },
      "Stationary energy storage for commercial and industrial sites.",
      { box: ["Built for a circular future", "16 % recycled lithium", "Roadmap target for 2031"], size: 16, gap: 20 },
      { t: "Why HX-280?", bold: true, gap: 14 },
      "Long life: 6000 cycles nominal at 25 °C, 0.5C, 90% DoD.",
      "High efficiency: typical round-trip energy efficiency of 95.5 %.",
      "Manufactured by Helion Storage Technologies B.V., Industrieweg 21, 5651 GM Eindhoven, Netherlands.",
    ],
    [
      { t: "Technical data", size: 15, bold: true },
      { table: [
        ["Parameter", "Value"],
        ["Module serial number", "HX280-26-004417"],
        ["Battery category", "Industrial battery"],
        ["Cell chemistry", "LFP (LiFePO4)"],
        ["Rated capacity", "280 Ah"],
        ["Nominal voltage", "51.2 V"],
        ["Voltage range (min / max)", "44.8 V / 57.6 V"],
        ["Maximum power", "14.3 kW"],
        ["Nominal mass", "128 kg"],
        ["Idle (storage) temperature", "min -10 °C, max 45 °C"],
        ["Place of manufacture", "Eindhoven, Netherlands"],
        ["Date of manufacture", "2026-06"],
        ["Critical raw materials", "lithium, natural graphite"],
        ["Carbon footprint (per kWh, life cycle)", "58.3 kg CO2e/kWh"],
        ["Recycled lithium, this production lot (pre + post consumer)", "6 %"],
      ], cols: [50, 360] },
    ],
  ],

  // Made-up GRS-style certificate from a made-up certification body.
  "textile-01-northwind-grs-certificate.pdf": [
    [
      { t: "Northwind Certification Ltd", size: 18, bold: true },
      { t: "Product Certificate - Global Recycled Standard (GRS)", size: 14, bold: true },
      { t: "Certificate number: NWC-GRS-2026-01187", gap: 10 },
      "Issue date: 2026-09-01",
      "Valid until: 2027-08-31",
      { t: "Certified organisation", bold: true, gap: 14 },
      "Lumen Textiles Lda., Rua da Fabrica 120, 4760-100 Vila Nova de Famalicao, Portugal",
      "Country: Portugal",
      { t: "Certified product", bold: true, gap: 14 },
      { table: [
        ["Product", "Harbour Fleece Hoodie"],
        ["Article number (GTIN)", "5609876543212"],
        ["Product category", "Hooded sweatshirt"],
        ["Composition", "80% polyester, 20% cotton"],
        ["Recycled content", "80 % of total product mass"],
        ["Recycled material", "post-consumer recycled polyester from PET bottles"],
      ], cols: [50, 220] },
      { t: "Chemical requirements: the certified product complies with the GRS chemical restrictions (ZDHC MRSL).", gap: 14 },
      { t: "This certificate does not cover social or environmental claims beyond those listed above.", size: 9, gap: 10 },
    ],
  ],

  // Garment tech spec with a composition table. Water in m3 (needs conversion to L), weight in gsm.
  "textile-02-lumen-tee-spec-sheet.pdf": [
    [
      { t: "LUMEN TEXTILES - Garment Technical Sheet", size: 16, bold: true },
      { table: [
        ["Style", "Lumen Everyday Tee"],
        ["EAN / GTIN", "5609876543229"],
        ["Category", "T-shirt"],
        ["Supplier", "Lumen Textiles Lda., Rua da Fabrica 120, 4760-100 Vila Nova de Famalicao, Portugal"],
        ["Origin", "PT"],
        ["Production batch", "2026-08"],
        ["Fabric", "Single jersey, 180 gsm (nominal)"],
      ], cols: [50, 170] },
      { t: "Fibre composition (by mass)", bold: true, gap: 14 },
      { table: [
        ["Fibre", "Share", "Note"],
        ["Cotton", "60 %", "organic"],
        ["Polyester", "35 %", "recycled, pre-consumer"],
        ["Elastane", "5 %", ""],
      ], cols: [50, 170, 250] },
      "Recycled content: 35 % of garment mass (recycled polyester from pre-consumer production waste).",
      { t: "Environmental data (per garment, cradle to gate)", bold: true, gap: 14 },
      "Carbon footprint: 4.1 kg CO2e",
      "Water use: 1.9 m3",
      { t: "Compliance and care", bold: true, gap: 14 },
      "Tested to STANDARD 100 by OEKO-TEX, certificate no. 26-LT-0412, valid until 2027-03-31.",
      "REACH: no SVHC above 0.1 % w/w.",
      "Care: machine wash 30 °C, do not tumble dry, iron low.",
      "Durability: pilling grade 4 after 2000 rubs (ISO 12945-2).",
    ],
  ],
};

async function render(pages) {
  const pdf = await PDFDocument.create();
  // Fixed dates keep the bytes, and so the Document hash, stable across runs.
  pdf.setCreationDate(new Date("2026-10-25T00:00:00Z"));
  pdf.setModificationDate(new Date("2026-10-25T00:00:00Z"));
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  for (const items of pages) {
    const page = pdf.addPage([595, 842]);
    let y = 790;
    const line = (t, { x = 50, size = 10, bold: b = false } = {}) =>
      page.drawText(t, { x, y, size, font: b ? bold : font });
    for (const item of items) {
      const it = typeof item === "string" ? { t: item } : item;
      y -= it.gap ?? 0;
      if (it.table) {
        for (const [r, row] of it.table.entries()) {
          row.forEach((cell, c) => line(cell, { x: it.cols[c], size: 9.5, bold: r === 0 && row.length > 2 }));
          page.drawLine({ start: { x: 45, y: y - 4 }, end: { x: 550, y: y - 4 }, thickness: 0.3, color: rgb(0.6, 0.6, 0.6) });
          y -= 16;
        }
      } else if (it.box) {
        const size = it.size ?? 14;
        const h = it.box.length * (size + 6) + 16;
        page.drawRectangle({ x: 45, y: y - h + size, width: 505, height: h, color: rgb(0.88, 0.95, 0.9) });
        y -= 6;
        for (const [i, t] of it.box.entries()) {
          line(t, { x: 60, size: i === 1 ? size + 8 : size - 3, bold: i === 1 });
          y -= size + (i === 1 ? 14 : 6);
        }
        y -= 10;
      } else {
        const size = it.size ?? 10;
        line(it.t, { x: it.x, size, bold: it.bold });
        y -= size + 6;
      }
    }
    page.drawText(FOOTER, { x: 50, y: 30, size: 7, font, color: rgb(0.4, 0.4, 0.4) });
  }
  return pdf.save({ useObjectStreams: false });
}

mkdirSync(new URL("../documents/", import.meta.url), { recursive: true });
for (const [file, pages] of Object.entries(docs)) {
  const out = new URL(`../documents/${file}`, import.meta.url);
  writeFileSync(out, await render(pages));
  console.log("wrote", file);
}
