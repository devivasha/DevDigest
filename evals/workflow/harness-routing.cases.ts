import type { WorkflowCase } from "../src/index.js";

/**
 * Systemic ("workflow") tier — a second scenario set alongside review-workflow, focused on the
 * CLAUDE.md "Read When" rows and skill activations NOT already covered there. Same design rules:
 * every case asserts the real on-disk harness (settingSources:["project"]) via its TRACE
 * (filesRead / subagents / skillsInvoked), never its prose.
 *
 * Budget: 7 Claude sessions total.
 *   - 3 × trace (routing)                       → 1 session each = 3
 *   - 2 × activation pair (positive + near-miss) → 2 each        = 4
 *
 * Routing traces stop early via stopWhen the moment the routed doc is read, so they never pay for
 * downstream exploration. Prompts push toward CONSULTING the docs ("звірся з настановами, ЯКУ
 * документацію читати"), not exploring source — the lesson from review-workflow's pipeline case,
 * where "розберись, як усе влаштовано" sent the model into schema.ts and it never opened the doc.
 */
export const cases: WorkflowCase[] = [
  // --- trace (1 session): "Working on the UI" -> client/CLAUDE.md ------------------------------
  {
    kind: "trace",
    name: "UI task follows CLAUDE.md routing to client/CLAUDE.md",
    prompt:
      "Я планую додати нову React-сторінку у клієнт. Перш ніж торкатися коду — звірся з настановами " +
      "цього репо (CLAUDE.md) щодо того, яку документацію треба прочитати для роботи над UI, і прочитай " +
      "саме той документ.",
    expectFilesRead: ["client/CLAUDE.md"],
    maxTurns: 10,
  },

  // --- trace (1 session): "Writing or debugging e2e flows" -> e2e/docs/flows.md ----------------
  {
    kind: "trace",
    name: "e2e task follows CLAUDE.md routing to e2e/docs/flows.md",
    prompt:
      "Я збираюся написати новий e2e-флоу для браузерного тесту. Перш ніж писати — звірся з настановами " +
      "цього репо (CLAUDE.md) щодо того, яку документацію читати для e2e-флоу, і прочитай саме той документ.",
    expectFilesRead: ["e2e/docs/flows.md"],
    maxTurns: 10,
  },

  // --- trace (1 session): "Changing DI wiring, adapters, or secrets" -> server/docs/architecture.md
  // Deliberately scoped to DI/adapters/secrets (not generic "server module", which routes to
  // server/CLAUDE.md). The model may open server/CLAUDE.md too; we assert only architecture.md.
  {
    kind: "trace",
    name: "DI/secrets task follows CLAUDE.md routing to server/docs/architecture.md",
    prompt:
      "Я хочу змінити DI-звʼязування в контейнері — додати новий адаптер і провайдер секретів. Перш ніж " +
      "торкатися коду, звірся з настановами цього репо (CLAUDE.md) щодо того, яку документацію читати для " +
      "змін у DI-звʼязуванні, адаптерах чи секретах, і прочитай саме той документ.",
    expectFilesRead: ["server/docs/architecture.md"],
    // DI is a broader topic than a single pipeline doc — the model reads CLAUDE.md, maybe
    // server/CLAUDE.md, then architecture.md. Give it room to reach the routed doc.
    maxTurns: 14,
  },

  // --- activation pair (2 sessions): onion-architecture — pos + near-miss neg -------------------
  // Distinctive trigger ("what layer / where does X go") — won't collide with a sibling skill the
  // way the react/next/frontend cluster would, so activated() stays a clean single-skill check.
  {
    kind: "activation",
    name: "onion-architecture activates on a 'which layer' backend question",
    prompt:
      "Додаю новий backend-модуль у server/. Куди по onion-шарах покласти бізнес-логіку, а куди доступ до " +
      "БД, і що кому дозволено імпортувати?",
    skill: "onion-architecture",
    shouldActivate: true,
    // Room to explore the module layout and then invoke the Skill tool; short budgets cut it off.
    maxTurns: 15,
    // Whether the model invokes the Skill tool vs. answering from general knowledge is behaviour-
    // shaped (README: "indicative, not blocking"). Record a miss as ⚠, don't fail the gate.
    indicative: true,
  },
  {
    kind: "activation",
    // First cut named "onion-архітектура" outright and the skill fired — its description triggers on
    // the TERM, not just "which layer", so naming it is a true positive, not a near-miss. A real
    // near-miss stays in the same subject area (backend + DB) but shifts axis: query SYNTAX, which the
    // skill's own "Does NOT cover: Drizzle query syntax" disclaims and routes to drizzle-orm-patterns.
    name: "near-miss negative — a Drizzle query-syntax question must NOT engage onion-architecture",
    prompt:
      "Як написати типобезпечний SELECT із JOIN у Drizzle для таблиці reviews — покажи синтаксис запиту.",
    skill: "onion-architecture",
    shouldActivate: false,
    // Symmetric budget with the positive case so the pair differs only by prompt, not turn count.
    maxTurns: 15,
  },

  // --- activation pair (2 sessions): dependency-checker — pos + near-miss neg -------------------
  // Very specific trigger phrases ("dependency audit", "what depends on X") make this one of the
  // most deterministic activation checks available.
  {
    kind: "activation",
    name: "dependency-checker activates on a dependency-audit request",
    prompt:
      "Зроби аудит залежностей цього репо: карту що від чого залежить між пакетами, розбивку за розміром " +
      "і список знахідок (невикористані/дубльовані пакети).",
    skill: "dependency-checker",
    shouldActivate: true,
    maxTurns: 15,
    indicative: true,
  },
  {
    kind: "activation",
    name: "near-miss negative — installing one package must NOT engage dependency-checker",
    prompt: "Яку команду виконати, щоб додати пакет zod у server/ через pnpm?",
    skill: "dependency-checker",
    shouldActivate: false,
    maxTurns: 15,
  },
];
