import { PrismaClient } from "../src/generated/prisma";
import argon2 from "argon2";

const prisma = new PrismaClient();

// Pipeline stages derived from the real Jira "Sales" workflow statuses.
const STAGES: {
  name: string;
  color: string;
  probability: number;
  phase: string;
  isWon?: boolean;
  isLost?: boolean;
}[] = [
  { name: "New", color: "#64748b", probability: 10, phase: "Lead" },
  { name: "Qualified", color: "#3b82f6", probability: 20, phase: "Lead" },
  { name: "Needs Analysis", color: "#6366f1", probability: 30, phase: "Lead" },
  { name: "Quotation Sent / Negotiation", color: "#8b5cf6", probability: 50, phase: "Active" },
  { name: "Follow-up", color: "#f59e0b", probability: 60, phase: "Active" },
  { name: "Pending", color: "#94a3b8", probability: 40, phase: "Active" },
  { name: "Blocked", color: "#f97316", probability: 35, phase: "Active" },
  { name: "Contracting", color: "#0ea5e9", probability: 75, phase: "Closing" },
  { name: "SEMNAT", color: "#10b981", probability: 90, phase: "Closing" },
  { name: "Contracting / In progress", color: "#14b8a6", probability: 95, phase: "Closing" },
  { name: "IN LUCRU", color: "#06b6d4", probability: 95, phase: "Closing" },
  { name: "DONE", color: "#16a34a", probability: 100, phase: "Won", isWon: true },
  { name: "Not Qualified", color: "#6b7280", probability: 0, phase: "Lost", isLost: true },
  { name: "Closed Lost", color: "#ef4444", probability: 0, phase: "Lost", isLost: true },
  { name: "Closed Lost to competition", color: "#dc2626", probability: 0, phase: "Lost", isLost: true },
];

const TAGS: { name: string; color: string }[] = [
  { name: "pentest", color: "#6366f1" },
  { name: "blue", color: "#3b82f6" },
  { name: "RED", color: "#ef4444" },
  { name: "compliance", color: "#10b981" },
  { name: "cyberEDU", color: "#8b5cf6" },
  { name: "phish-enterprise", color: "#f59e0b" },
  { name: "vulnerability-scanning", color: "#14b8a6" },
  { name: "code-review", color: "#0ea5e9" },
  { name: "OSINT", color: "#a855f7" },
  { name: "training", color: "#22c55e" },
  { name: "ir", color: "#f97316" },
  { name: "ddos", color: "#e11d48" },
  { name: "nis", color: "#64748b" },
  { name: "darkweb", color: "#1e293b" },
  { name: "blackbox", color: "#0f172a" },
  { name: "OT", color: "#84cc16" },
];

async function main() {
  console.log("Seeding baseline data...");

  // --- Default pipeline + stages ---
  let pipeline = await prisma.pipeline.findFirst({ where: { isDefault: true } });
  if (!pipeline) {
    pipeline = await prisma.pipeline.create({
      data: { name: "Sales Pipeline", isDefault: true, order: 0 },
    });
  }

  for (let i = 0; i < STAGES.length; i++) {
    const s = STAGES[i];
    const existing = await prisma.stage.findFirst({
      where: { pipelineId: pipeline.id, name: s.name },
    });
    if (existing) {
      await prisma.stage.update({
        where: { id: existing.id },
        data: { order: i, color: s.color, probability: s.probability, phase: s.phase, isWon: !!s.isWon, isLost: !!s.isLost },
      });
    } else {
      await prisma.stage.create({
        data: {
          pipelineId: pipeline.id,
          name: s.name,
          order: i,
          color: s.color,
          probability: s.probability,
          phase: s.phase,
          isWon: !!s.isWon,
          isLost: !!s.isLost,
        },
      });
    }
  }

  // --- Tags ---
  for (const t of TAGS) {
    await prisma.tag.upsert({
      where: { name: t.name },
      update: { color: t.color },
      create: { name: t.name, color: t.color },
    });
  }

  // --- SAL counter ---
  await prisma.counter.upsert({
    where: { name: "deal_sal" },
    update: {},
    create: { name: "deal_sal", value: 0 },
  });

  // --- Bootstrap admin ---
  const email = process.env.SEED_ADMIN_EMAIL || "admin@crm.local";
  const password = process.env.SEED_ADMIN_PASSWORD || "ChangeMe123!";
  const existingAdmin = await prisma.user.findUnique({ where: { email } });
  if (!existingAdmin) {
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    await prisma.user.create({
      data: {
        email,
        name: "Administrator",
        passwordHash,
        role: "ADMIN",
        mustChangePassword: true,
        twoFactorEnabled: false,
        avatarColor: "#6366f1",
      },
    });
    console.log(`Created admin user: ${email} (must change password + enroll 2FA on first login)`);
  } else {
    console.log(`Admin user already exists: ${email}`);
  }

  // --- Custom field definitions derived from Jira custom fields ---
  const dealFields: { key: string; label: string; type: any; order: number }[] = [
    { key: "deal_type", label: "Deal Type", type: "TEXT", order: 0 },
    { key: "type_of_engagement", label: "Type of Engagement", type: "TEXT", order: 1 },
    { key: "estimated_value_eur", label: "Estimated Value (EUR)", type: "NUMBER", order: 2 },
    { key: "deal_details", label: "Deal Details", type: "TEXTAREA", order: 3 },
    { key: "source", label: "Source", type: "TEXT", order: 4 },
    { key: "is_public_institution", label: "Public institution?", type: "BOOLEAN", order: 5 },
  ];
  const clientFields: { key: string; label: string; type: any; order: number }[] = [
    { key: "company_website", label: "Company Website", type: "URL", order: 0 },
    { key: "company_size", label: "Company size", type: "TEXT", order: 1 },
    { key: "country", label: "Country", type: "TEXT", order: 2 },
    { key: "customer_title", label: "Customer Title", type: "TEXT", order: 3 },
  ];
  for (const f of dealFields) {
    await prisma.customFieldDefinition.upsert({
      where: { entity_key: { entity: "DEAL", key: f.key } },
      update: { label: f.label, order: f.order },
      create: { entity: "DEAL", key: f.key, label: f.label, type: f.type, order: f.order },
    });
  }
  for (const f of clientFields) {
    await prisma.customFieldDefinition.upsert({
      where: { entity_key: { entity: "CLIENT", key: f.key } },
      update: { label: f.label, order: f.order },
      create: { entity: "CLIENT", key: f.key, label: f.label, type: f.type, order: f.order },
    });
  }

  console.log("Seed complete.");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
