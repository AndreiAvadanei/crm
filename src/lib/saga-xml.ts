// Pure builder for Saga-compatible invoice XML (the <Facturi><Factura>… format
// used by the Saga accounting import). No DB or network access here so it can be
// unit-tested and reused. Mirrors the structure proven against Saga in the
// cashflow project's invoice-generator.js.

export type SagaSupplier = {
  nume: string;
  cif: string;
  capital: string;
  regCom: string;
  tara: string;
  localitate: string;
  judet: string;
  adresa: string;
  telefon: string;
  mail: string;
  banca: string;
  iban: string;
  infSupl: string;
};

export type SagaClient = {
  nume: string;
  infSupl: string;
  cif: string;
  regCom: string;
  judet: string;
  tara: string;
  localitate: string;
  adresa: string;
  banca: string;
  iban: string;
  telefon: string;
  mail: string;
};

export type SagaLine = {
  descriere: string;
  codArticolClient?: string;
  um: string;
  cantitate: number;
  pret: number;
  valoare: number;
  procTVA: number;
  tva: number;
  infSupl: string;
};

export type SagaInvoice = {
  supplier: SagaSupplier;
  client: SagaClient;
  numar: string;
  data: Date;
  scadenta: Date | null;
  taxareInversa: boolean;
  tvaIncasare: boolean;
  infoSupl: string;
  moneda: string;
  cotaTVA: number;
  lines: SagaLine[];
};

export function escapeXml(value: unknown): string {
  if (value == null) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Format a date as dd.MM.yyyy (the format Saga expects). */
export function formatSagaDate(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

function num(value: number): string {
  return (Number.isFinite(value) ? value : 0).toFixed(2);
}

function buildLineXml(line: SagaLine, index: number): string {
  const codArticol =
    line.codArticolClient && line.codArticolClient.trim()
      ? `\n                    <CodArticolClient>${escapeXml(line.codArticolClient)}</CodArticolClient>`
      : "";
  return `
                <Linie>
                    <LinieNrCrt>${index + 1}</LinieNrCrt>${codArticol}
                    <Descriere>${escapeXml(line.descriere)}</Descriere>
                    <UM>${escapeXml(line.um || "buc")}</UM>
                    <Cantitate>${num(line.cantitate)}</Cantitate>
                    <Pret>${num(line.pret)}</Pret>
                    <Valoare>${num(line.valoare)}</Valoare>
                    <TVA>${num(line.tva)}</TVA>
                    <ProcTVA>${line.procTVA}</ProcTVA>
                    <InformatiiSuplimentare>${escapeXml(line.infSupl)}</InformatiiSuplimentare>
                </Linie>`;
}

function buildFacturaXml(inv: SagaInvoice): string {
  const s = inv.supplier;
  const c = inv.client;
  const itemsXml = inv.lines.map((line, idx) => buildLineXml(line, idx)).join("");
  const scadenta = inv.scadenta ? `\n                <FacturaScadenta>${formatSagaDate(inv.scadenta)}</FacturaScadenta>` : "";
  const cotaTVA = inv.cotaTVA > 0 ? `\n                <FacturaCotaTVA>TVA (${inv.cotaTVA}%)</FacturaCotaTVA>` : "";

  return `
        <Factura>
            <Antet>
                <FurnizorNume>${escapeXml(s.nume)}</FurnizorNume>
                <FurnizorCIF>${escapeXml(s.cif)}</FurnizorCIF>
                <FurnizorCapital>${escapeXml(s.capital)}</FurnizorCapital>
                <FurnizorNrRegCom>${escapeXml(s.regCom)}</FurnizorNrRegCom>
                <FurnizorTara>${escapeXml(s.tara)}</FurnizorTara>
                <FurnizorLocalitate>${escapeXml(s.localitate)}</FurnizorLocalitate>
                <FurnizorJudet>${escapeXml(s.judet)}</FurnizorJudet>
                <FurnizorAdresa>${escapeXml(s.adresa)}</FurnizorAdresa>
                <FurnizorTelefon>${escapeXml(s.telefon)}</FurnizorTelefon>
                <FurnizorMail>${escapeXml(s.mail)}</FurnizorMail>
                <FurnizorBanca>${escapeXml(s.banca)}</FurnizorBanca>
                <FurnizorIBAN>${escapeXml(s.iban)}</FurnizorIBAN>
                <FurnizorInformatiiSuplimentare>${escapeXml(s.infSupl)}</FurnizorInformatiiSuplimentare>
                <ClientNume>${escapeXml(c.nume)}</ClientNume>
                <ClientInformatiiSuplimentare>${escapeXml(c.infSupl)}</ClientInformatiiSuplimentare>
                <ClientCIF>${escapeXml(c.cif)}</ClientCIF>
                <ClientNrRegCom>${escapeXml(c.regCom)}</ClientNrRegCom>
                <ClientJudet>${escapeXml(c.judet)}</ClientJudet>
                <ClientTara>${escapeXml(c.tara)}</ClientTara>
                <ClientLocalitate>${escapeXml(c.localitate)}</ClientLocalitate>
                <ClientAdresa>${escapeXml(c.adresa)}</ClientAdresa>
                <ClientBanca>${escapeXml(c.banca)}</ClientBanca>
                <ClientIBAN>${escapeXml(c.iban)}</ClientIBAN>
                <ClientTelefon>${escapeXml(c.telefon)}</ClientTelefon>
                <ClientMail>${escapeXml(c.mail)}</ClientMail>
                <FacturaNumar>${escapeXml(inv.numar)}</FacturaNumar>
                <FacturaData>${formatSagaDate(inv.data)}</FacturaData>${scadenta}
                <FacturaTaxareInversa>${inv.taxareInversa ? "Da" : "Nu"}</FacturaTaxareInversa>
                <FacturaTVAIncasare>${inv.tvaIncasare ? "Da" : "Nu"}</FacturaTVAIncasare>
                <FacturaInformatiiSuplimentare>${escapeXml(inv.infoSupl)}</FacturaInformatiiSuplimentare>
                <FacturaGreutate>0</FacturaGreutate>
                <FacturaMoneda>${escapeXml(inv.moneda.toUpperCase())}</FacturaMoneda>${cotaTVA}
            </Antet>
            <Detalii>
                <Continut>${itemsXml}
                </Continut>
            </Detalii>
        </Factura>`;
}

/** Build the full <Facturi> document from one or more invoices. */
export function buildSagaFacturiXml(invoices: SagaInvoice[]): string {
  const body = invoices.map(buildFacturaXml).join("\n");
  return `<Facturi>\n${body}\n</Facturi>`;
}
