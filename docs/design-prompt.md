# HackMeridian: full app design prompt

Paste this whole file into Claude Design as one prompt.

---

Build **one interactive prototype of the whole app**, not separate designs. All screens below live in one project and link to each other the way the real app would: sidebar items switch screens, "Upload" leads to the live Pipeline, a Field's "Challenge" opens the Challenge form, the Arbiter's "Uphold" plays the Slash, and so on. Someone should be able to click through the whole demo story (01 → 02 → 03 → 04 → 05 → 06 → 07 → 08) without leaving the prototype.

- **Desktop first, 1440 × 900.** This is a work tool used at a desk, and the demo runs on a projector. Add a Mobile switch (390 × 844) only for screens 03 and 04, as a read-only "check my Document on the go" view.
- **A Brand / Arbiter / Operator switch** in the corner, so a viewer can jump between the three sides.
- **One design system for every screen.** Build the shared components once (Field row, status badge, Sieve track, money chip, Stellar proof link, Document viewer, Worker chip) and reuse them.
- **Extra states** (empty, loading, error) listed under each screen go in a small "States" menu on that screen, not as separate pages.
- **Projector-safe.** Judges see this on a big screen from 5 metres away: the key numbers (Bond, Slash, accuracy) must read at a glance, and nothing important may be in light grey on white.
- Use realistic sample content throughout so the story holds together from screen to screen (see "The demo story" below).
- If it's too much for one pass, build screens 01–05 first, then add 06–08 **inside the same project**.

## The product

Brands that sell batteries and textiles in the EU must publish a Digital Product Passport for every product. The data comes from their Suppliers as messy Documents: spec sheets, test reports and certificates, each laid out differently. Today someone retypes them by hand.

Our product reads each Document with a **Pipeline** of independent AI passes called **Sieves**. Each Sieve sees the Document a different way and runs on a different model. The Pipeline narrows every value down until it converges, and outputs structured passport Fields. A value the Document doesn't clearly give comes back as **Not stated**, with the evidence, instead of a guess.

What makes it different: **we put money behind it.** Every delivered Document is backed by a **Bond** in USDC, locked on the Stellar blockchain. For a **Challenge Window** after delivery, anyone can **Challenge** a Field by pointing at the page of the Document that says otherwise. A neutral **Arbiter** decides. If the Challenge is upheld, part of the Bond is **Slashed** to the Brand. If nobody wins a Challenge, the Bond and the Fee settle automatically. No human review in the normal case.

Three kinds of user:

- **Brand:** a compliance or product-data person at a battery maker or a textile brand. Not technical, not a crypto person, busy, accountable to auditors. Wants to know: "Can I put this in my passport, and what happens if it's wrong?"
- **Arbiter:** a neutral third party who only acts when there's a Challenge. Needs the evidence side by side and one clear decision.
- **Operator:** us, running the Pipeline. Watches Workers, Jobs and our public track record.

## Visual direction

- **"A lab report that pays out."** Calm, precise, document-centred, closer to a well-designed audit tool or a scientific instrument than a crypto dashboard. The Document and its evidence are the hero; money appears exactly where it matters and nowhere else.
- Warm paper background (#F7F5F0 or similar), near-black ink text (#141414), hairline rules instead of heavy cards and shadows.
- **Type:** a sharp grotesk for the interface (for example Inter Tight or Söhne-like), and a **monospace for every value, unit, hash and amount** (for example JetBrains Mono or IBM Plex Mono), so extracted data visibly reads as data. One serif only for big headline moments on screen 01 (for example Newsreader or Fraunces).
- **Status colours** carry meaning and are always paired with a label or icon, never colour alone:
  - **Final:** ink with a small solid check.
  - **Converging:** a quiet animated dotted underline.
  - **Not stated:** amber with a diagonal hatch pattern.
  - **Challenged:** a red outline.
  - **Upheld:** red fill.
  - **Rejected:** struck through in grey.
- **One accent for money:** a deep Stellar-adjacent blue-black, or a muted teal, used only for Bond, Fee and Slash amounts and the Stellar proof links. No neon, no gradients, no purple, no glowing coins, no glassmorphism, no "web3" visual clichés, no emoji in the UI.
- **Signature motion:** the Sieve track (see Shared components). Values drop through the Sieves and settle. It should feel like an instrument converging, not a loading spinner.

## The demo story (use this content everywhere)

- **Brand:** "Voltaris", an EU battery maker. Reviewer: Inês Duarte, Product Compliance.
- **Supplier:** "Hunan Cellworks", which sent the spec sheet "NMC-800 Cell Datasheet rev C.pdf" (12 pages, with tables).
- **Template:** Battery passport, 18 Fields. Examples: Chemistry `NMC 811`; Rated capacity `80.0 Ah` (nominal); Nominal voltage `3.65 V`; Mass `1.12 kg`; Recycled cobalt `16 %`; Carbon footprint `61.3 kg CO₂e/kWh`; Manufacturing site `Changsha, CN`.
- **Second Document (textile):** brand "Linho Norte", Supplier "Fiação do Ave" (northern Portugal), "Tech sheet SS27 shirting.docx exported as PDF". Fibre composition `55 % linen · 45 % organic cotton`, with GRS certificate number.
- **Money:** Bond `50.00 USDC`, Fee `5.00 USDC`, Slash `5.00 USDC` (one tenth of the Bond per upheld Challenge). Challenge Window `48 h` (in the demo it counts down from `03:00`).
- **Two Operators on the same Documents:**
  - **Origyn Pipeline:** 5 Sieves.
  - **Baseline:** a single one-pass Sieve.
  - The Baseline gets "Rated capacity" wrong (it reads `8.0 Ah` from a misaligned table). The Brand Challenges it, the Arbiter upholds, and 5 USDC moves to Voltaris. The Origyn Pipeline's value holds.
- **Workers:** three AI sessions connected to the Job Board, shown as chips: "Claude Code", "OpenCode", "Pi". Each chip shows the harness name only; the model under the hood is not shown.
- **Measured accuracy line:** "97.8 % Correct on 184 Fields across 8 test Documents" (placeholder; the real number comes from our test run).

## Words we use

Use these terms on every screen, never synonyms:

- **Document:** the Supplier's file. Not "file", "upload" or "PDF".
- **Template:** battery or textile.
- **Field:** one slot in the Template. Not "attribute" or "property".
- **Pipeline**, **Sieve**, **Baseline**.
- **Final**, **Converging**, **Not stated:** the three Field statuses. Never say "unverified", "null" or "missing".
- **Supplier Request:** what the Brand sends the Supplier for a Not stated Field.
- **Bond**, **Fee**, **Slash**, **Challenge**, **Challenge Window**, **Arbiter**, **Operator**.
- **Worker**, **Job**, **Job Board** (Operator side only).
- Never say "AI agent", "smart contract", "crypto", "token" or "wallet" on Brand screens. On the Brand side, money is just "USDC", with a small "on Stellar" proof link. The Operator and Arbiter sides may say "Stellar".

## Shared components

- **Field row:** Field name; value in monospace with unit and qualifier ("80.0 Ah · nominal"); status badge; page number ("p. 4"); a hover or expand state showing the verbatim quote from the Document, with the matched words highlighted. On the right, a "Challenge" action, shown only while the Challenge Window is open.
- **Status badge:** Final / Converging / Not stated / Challenged / Upheld / Rejected, with the styles from Visual direction.
- **Sieve track:** a horizontal strip of 5 small stations for one Document (Original → Markdown → Faithfulness check → Markdown extraction → Tie-break), each with its Worker chip and a tick, cross or spinner. Fields pass through visually. The Baseline's track has a single station, so the contrast is obvious at a glance.
- **Document viewer:** the original page rendered at readable size, page thumbnails down the side, and highlight boxes over the region a Field's quote came from. Clicking a Field row scrolls the viewer to its quote. This is the core interaction of the product.
- **Money chip:** amount in monospace plus label ("Bond 50.00 USDC · locked"). States: locked, released, slashed (shows the split).
- **Stellar proof link:** a small "View on Stellar ↗" link with a shortened hash (`a3f9…c21e`), opening the explorer. It's on every money event and on the output hash.
- **Worker chip:** harness name, a live dot, and the current Job.
- **Countdown:** Challenge Window time left, in monospace, with a thin progress rule.
- **Left sidebar** that changes by role. Brand: Documents, Upload, Leaderboard. Arbiter: Challenges. Operator: Job Board, Pipelines, Leaderboard.

## Accessibility

- Text contrast at least 4.5:1; this matters doubly on a projector.
- Status is never shown by colour alone.
- Every quote highlight has a text equivalent.
- Keyboard: up and down move between Field rows, Enter expands the quote, C opens a Challenge.

---

# Screens

## 01 · Landing (judges and Brands)

**Who:** a judge or a Brand opening the link from the README. **Goal:** understand the product and the guarantee in 20 seconds, then click into the live demo.

### Content, top to bottom

1. Header: wordmark, "How it works", "Leaderboard", "Open demo".
2. Hero. Serif headline: "Supplier documents in. Passport data out. Money on every answer." One line under it: "Every Document we deliver is backed by a USDC Bond. If a Field doesn't match the Document, you get paid." Main button: "Upload a Document". Beside it, a still of screen 04: a Document page with highlight boxes on the left, Field rows on the right, and a "Bond 50.00 USDC · locked" chip.
3. How it works, 4 steps with small diagrams: upload → Sieves converge → Bond locks on Stellar → Challenge Window, then automatic settlement.
4. "Why you can trust it": the measured accuracy line, the Pipeline vs Baseline comparison (5 Sieves vs 1), and "Every Bond and Slash is public on Stellar" with a proof link.
5. Strip: "Built for the EU Battery Regulation (passports from Feb 2027) and textile ESPR."
6. Footer.

### States

Default only.

## 02 · Upload (Brand)

**Who:** Inês at Voltaris. **Goal:** upload a Supplier Document in one step.

### Content

1. A large drop zone: "Drop a Supplier Document". PDF, with DOCX shown as "coming soon".
2. Template picker as two cards, Battery and Textile, each with its Field count and 3 example Fields.
3. Supplier name (free text, with autocomplete from past uploads).
4. Summary before confirming: "Fee 5.00 USDC · backed by a 50.00 USDC Bond · Challenge Window 48 h".
5. Main button: "Start". It goes to screen 03.

### States

- Wrong file type.
- Upload failed.
- Uploading, with a progress bar and "Stored on ICP" once done, plus a proof link.

## 03 · Live Pipeline (Brand)

**Who:** Inês, just after uploading. **Goal:** watch the Document turn into Fields. This is the "wow" screen of the live demo, so give it the most motion design.

### Content

1. Header: Document name, Supplier, Template, a "Processing" status, and elapsed time.
2. **Two Sieve tracks stacked:** Origyn Pipeline (5 stations) and Baseline (1 station), each showing its live Worker chips.
3. Below them, the Template's Field rows filling in live. Each Field shows Converging, then settles into Final or Not stated. Where a Field passes the Tie-break Sieve, a small marker says so.
4. A counter strip: "14 Final · 3 Converging · 1 Not stated".
5. When it's done, the strip becomes: "Delivered. Bond 50.00 USDC locked. Challenge Window 47:59:58" with a proof link, and a button "Review Document", which goes to screen 04.

### Layout

Full width. The tracks are a fixed band at the top; the Field rows scroll below.

### States

- Waiting for a Worker ("Job on the Job Board, waiting for a Worker").
- A Sieve failed and is being re-run (the faithfulness check failed, so the Markdown is redone once).
- Every Field Final.

## 04 · Document review (Brand)

**Who:** Inês, checking the delivered Fields. **Goal:** trust the values in seconds, see what's Not stated, and Challenge anything wrong. This is the most important screen in the product. Spend the most design time here.

### Content

1. **Split view.**
   - Left, about 55%: the Document viewer.
   - Right, about 45%: the Field rows for the selected Operator.
   - Clicking a Field scrolls the Document to its highlighted quote; clicking a highlight selects its Field.
2. **Operator tabs** above the Field rows: "Origyn Pipeline" and "Baseline", plus a third tab "Compare" that shows both values per Field in two columns and flags every difference.
3. **Not stated Fields** grouped at the top in amber, each with its competing quotes and a "Copy Supplier Request" button, which opens a pre-written short message to Hunan Cellworks.
4. A **money and status bar** across the top: the Bond chip (locked), the Fee chip, the Challenge Window countdown, and the output hash with a proof link.
5. **Export:** "Export to passport", which shows a confirmation that the Fields were sent to the DPP platform.

### States

- Window open: Challenge actions visible.
- Window closed and settled: a green-ink "Settled" banner with proof links, and Challenge actions gone.
- A Field Challenged, with a red outline and "Under review by Arbiter".
- A Field Upheld: the corrected value is shown, the old value struck through, and "Slash 5.00 USDC paid to Voltaris" with a proof link.

## 05 · Challenge a Field (Brand)

**Who:** Inês, who spotted that the Baseline says `8.0 Ah`. **Goal:** file a Challenge in under 30 seconds, with the evidence attached.

### Content

A side panel sliding over screen 04, not a new page.

1. The Field, the delivered value and its quote.
2. "What does the Document say?": a value field, and a page and quote picker. The Brand clicks a region on the Document viewer, and the quote fills in automatically.
3. Plain explanation: "The Arbiter compares the Document with both values. If you're right, 5.00 USDC of the Bond is paid to you, and the corrected value replaces the old one."
4. Button: "File Challenge".

### States

- Quote not found on that page.
- Challenge Window already closed.
- Filed: a confirmation, and the Field row turns Challenged.

## 06 · Arbiter desk

**Who:** the neutral Arbiter. **Goal:** decide each Challenge from evidence alone, fast and fairly.

### Content

1. Queue of open Challenges: Document, Field, Operator, time filed, and time left in the window.
2. A selected Challenge opens a **three-column evidence view**:
   - left, the Document page with **both** quotes highlighted (the delivered value and the challenger's);
   - middle, the delivered value against the challenged value, with the Template's rule for this Field ("Quantity: same unit after conversion, same qualifier, no tolerance");
   - right, the decision.
3. **Decision:** two big buttons, "Uphold" and "Reject", plus an optional note.
4. Upholding plays a short **Slash animation:** 5.00 USDC flows from the Bond chip to Voltaris. Then the proof link appears.
5. The Arbiter's own record: Challenges decided, upheld and rejected.

### States

- Empty queue: "No open Challenges. Bonds are settling automatically."
- Decided, with a proof link.

## 07 · Leaderboard (public)

**Who:** judges, Brands, anyone. **Goal:** see that careless Pipelines cost money and good ones earn it.

### Content

1. A table of Operators: Origyn Pipeline and Baseline (and room for more). Columns:
   - Documents delivered;
   - Fields delivered;
   - Challenges upheld;
   - total Slashed;
   - Bonds currently locked;
   - measured accuracy on the test set.
   Every number has a proof link.
2. A simple chart below it: each Operator's Bond balance over the demo's Documents. The Baseline's line steps down with each Slash; ours stays flat.
3. A line of copy: "The Bond doesn't make the model careful. It makes careless Pipelines expensive, and their error rate public."

### States

- Only one Operator so far.
- Loading from Stellar.

## 08 · Job Board (Operator)

**Who:** us, during the demo, to show the machinery behind the product. **Goal:** show that independent AI Workers in different harnesses plug in and do Jobs.

### Content

1. Connected Workers as chips: Claude Code, OpenCode and Pi, each live, with the Job it's on now and the Jobs done today.
2. Job list: Document, Sieve, Worker, status (open / taken / done / timed out), duration.
3. Pipelines panel: our Pipeline's Sieves in order, shown as a simple vertical diagram, next to the Baseline's single Sieve.
4. A small "Connect a Worker" card with the MCP connection command in a monospace block and a copy button.

### States

- No Workers connected.
- A Job timed out and went back on the board.
