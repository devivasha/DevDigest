# `/context` вимірювання — MCP context / token management (Lesson 4)

Мета: зафіксувати, скільки токенів контексту з'їдають визначення MCP-тулів на 5 станах
конфігурації, і показати ефект **trim** та **Tool Search**.

## Як робити замір (важливо)

1. Зміни конфіг згідно з кроком (нижче — готові блоки для вставки).
2. **Перезапусти Claude Code** — MCP-тули та `env` читаються при старті сесії.
3. У **свіжій сесії, до будь-якої роботи**, набери `/context`.
4. Запиши в таблицю: рядок **MCP tools** (головне число) і **Total**.

> Порівнюємо саме рядок **MCP tools** — він найчистіший. Total росте від історії
> повідомлень, тому знімай його одразу після старту.

## Результати

| # | Крок | active servers | `ENABLE_TOOL_SEARCH` | MCP tools (tokens) | Total (tokens) |
|---|------|----------------|----------------------|--------------------|----------------|
| 1 | baseline | — (жодного) | `false` |  |  |
| 2 | + GitHub MCP | github | `false` |  |  |
| 3 | trim | github (toolsets) | `false` |  |  |
| 4 | Tool Search | github | `true` |  |  |
| 5 | Tool Search на власному сервері | github + devdigest | `true` |  |  |

**Очікуваний тренд:** 1 (низько) → 2 (стрибок ↑) → 3 (трохи ↓) → 4 (різко ↓) → 5 (майже без приросту).
Суть: Tool Search прибирає вартість повних схем; під ним і власний сервер «безкоштовний» за контекстом.

Висновок (заповнити після замірів): _____

---

## Готові конфіги по кроках

Три файли, які змінюються:
- `A` = `.claude/settings.json` → ключ `env`
- `B` = `.claude/settings.local.json` → `enabledMcpjsonServers`
- `C` = `.mcp.json` → сервер `github`

### Крок 1 — baseline (жодного MCP, повні схеми)

**A** `.claude/settings.json` env:
```json
"env": { "MCP_TOOL_TIMEOUT": "150000", "ENABLE_TOOL_SEARCH": "false" }
```
**B** `.claude/settings.local.json`:
```json
{ "enabledMcpjsonServers": [] }
```
**C** — без змін.

### Крок 2 — + GitHub MCP (повний набір тулів, Tool Search off)

**A** — як у кроці 1 (`ENABLE_TOOL_SEARCH: "false"`).
**B**:
```json
{ "enabledMcpjsonServers": ["github"] }
```
**C** — без змін (усі ~60 тулів GitHub).

### Крок 3 — trim (менше тулів GitHub через toolsets)

**A** — `ENABLE_TOOL_SEARCH: "false"`.
**B** — `["github"]`.
**C** `.mcp.json` → github → додати `X-MCP-Toolsets` + `X-MCP-Readonly` у `headers`:
```json
"github": {
  "type": "http",
  "url": "https://api.githubcopilot.com/mcp/",
  "headers": {
    "Authorization": "Bearer <PAT>",
    "X-MCP-Toolsets": "repos,pull_requests",
    "X-MCP-Readonly": "true"
  }
}
```
> Якщо `/context` не показав зменшення (сервер проігнорував заголовки), альтернатива —
> змінити `url` на toolset-специфічний шлях: `https://api.githubcopilot.com/mcp/x/repos/readonly`.
> Перевір, що число MCP tools впало відносно кроку 2.

### Крок 4 — Tool Search (GitHub, схеми відкладені)

**A** — увімкнути Tool Search:
```json
"env": { "MCP_TOOL_TIMEOUT": "150000", "ENABLE_TOOL_SEARCH": "true" }
```
**B** — `["github"]`.
**C** — **прибрати trim** (повний GitHub назад, як у кроці 2), щоб чисто побачити ефект
Tool Search на повному наборі тулів.

### Крок 5 — Tool Search на власному сервері (github + devdigest)

**A** — `ENABLE_TOOL_SEARCH: "true"`.
**B**:
```json
{ "enabledMcpjsonServers": ["github", "devdigest"] }
```
**C** — повний GitHub (без trim).

---

## Повернути робочий стан (після всіх замірів)

- **A** `.claude/settings.json` env: `{ "MCP_TOOL_TIMEOUT": "150000" }` (прибрати `ENABLE_TOOL_SEARCH` → дефолт = ON).
- **B** `.claude/settings.local.json`: `{ "enabledMcpjsonServers": ["devdigest", "github"] }`.
- **C** `.mcp.json`: github з одним `Authorization`-заголовком (прибрати toolsets/readonly).
