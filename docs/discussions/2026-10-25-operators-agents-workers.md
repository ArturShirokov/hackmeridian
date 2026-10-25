# Operators, agents and Workers: where we are (25 Oct 2026)

A follow-up to spec #1, after the build was mostly merged. It records what Artur agreed, what's still open, the confusion behind it, and what Claude suggests. Terms follow `GLOSSARY.md`.

## Agreed

- **Q30: outside Agents can take whole Documents.** An outside agent with its own testnet wallet takes a whole Document over MCP, posts its own Bond, delivers Fields, and is paid or Slashed exactly like ours. In the demo, a third one joins live.
- **Q31: Challenge deposit and Arbiter fee.**
  - A Challenge needs a 1.00 USDC deposit.
  - If the Challenge is rejected, the deposit pays the Arbiter.
  - If it's upheld, the deposit goes back to the Challenger, and the Arbiter's fee comes out of the Slash.
  - The Arbiter's own Bond, checked with planted Challenges whose answers we know, goes on the future slide.
- **Q29: keep the word "Operator"; don't rename it "Agent".** Artur's framing: the Pipeline is one big agent, and the Sieves are its sub-agents.
- **The original idea stands.** An agent puts up a Bond as a money-back guarantee. The research doesn't contradict this. It only says money in the prompt doesn't make a model more careful. A Bond works by making careless setups lose money and drop out.
- **The business case is unchanged.** Brands need extraction and standardisation, and a workflow of independent passes is the best way to do it today.

## Still open

1. **Q32: are Workers a real concept, or just sub-agents?** Artur leans towards "Workers are just sub-agents, or ways to use different models". If so, Workers inside our Pipeline are our own cost: no wallet, no pay. Not decided.
2. **Does our Pipeline need the Job Board to hand out Sieve Jobs at all?** Pi and OpenCode can spawn sub-agents on different models from one session. A single Operator session could then run the whole Pipeline itself. That would make the sieve-level Job Board unnecessary.
3. **How do we show what an Operator is doing when it isn't our workflow?** An outside agent might write a script instead of running Sieves. The UI built from the Claude Design prototype assumes our 5-station Sieve track.
4. **Which models run which Sieves?** Most likely Claude Code with Anthropic models, plus an OpenCode Go subscription.

## The confusion, stated plainly

Three things all look like "an agent":

| What | Glossary term | Has money at stake? | Who sees it |
|---|---|---|---|
| The thing that takes a Document, posts a Bond and gets paid | **Operator** | Yes: the Bond, and the Fee as income | Brand, Arbiter, leaderboard |
| Its method: the workflow of passes | **Pipeline**, made of **Sieves** | No | Shown in the UI for the demo |
| The AI session doing one pass | **Worker** | No | Operator only |

The market is at the **Operator** level: Document in, bonded Fields out, Challenge Window. Everything below that is the Operator's own business. The awkward part is that today *we* define the only real Pipeline, and our Workers come in from outside harnesses. That makes it look as if outside agents are joining *our* workflow. Q30 fixes this: an outside agent becomes an Operator in its own right, with its own Bond, and its internals are none of our business.

## Suggestions

### On Q29 and the framing for the pitch

Keep "Operator", and define it for the judges in one sentence: **"An Operator is an agent, or the team behind one, that takes Documents and puts a Bond behind its answers. How it works inside is its own business. Ours runs a workflow of Sieves, because that's the most accurate way today."** That's also the answer to "workflow now, agentic later": the market doesn't change when models improve. A future Operator might do it in one pass, and the Bond and Challenge rules stay the same.

### On Q32 and open question 2: Workers become sub-agents

Recommendation: **treat Workers as sub-agents, keep them unpaid, and leave the merged sieve-level Job Board in place for tonight.** It already works, and ripping it out at night is risk with no demo gain.

In the pitch, say "our Operator's sub-agents run on different models". After the hackathon, consider collapsing it: one Operator session running the whole Pipeline with its own sub-agents, with the Job Board only at the Document level.

### On open question 3: show self-reported steps, not our Sieve track

Recommendation for tonight: **a fixed Trace format.** Every Operator may submit an optional list of steps with its delivery:
- a label;
- what it looked at (the original, Markdown, a script's output);
- the model or tool used;
- a one-line result.

The UI's Sieve track renders any Trace: ours shows 5 stations, the Baseline 1, and an outside script-based agent whatever it reports. An Operator that sends no Trace shows as a single "Black box" station.

Say on stage that **the Trace is self-reported and isn't what the Brand relies on. The Bond is.** That keeps the guarantee honest and lets any internal method be shown.

Vercel's **json-render** is what Artur meant by "JSON UI". The model writes a JSON tree limited to a catalogue of components you define (with Zod schemas), and it renders progressively in React, Vue, Svelte and others, with 36 shadcn/ui components included. It could later let an Operator describe its own process using our components, such as the Sieve station, Worker chip and Field row. It's labelled experimental (Vercel Labs). **Skip it tonight; the fixed Trace format is a few lines of code.** Put json-render on the future slide.

### On open question 4: model mix

The **OpenCode Go** subscription costs $10/month ($5 the first month), with usage caps in dollars: $12 per 5 hours, $30 a week, $60 a month. The model list differs between copies of its docs. The latest official one lists:
- open-weight models: GLM-5.2 and 5.1, Kimi K3 and K2.x, Qwen3.8 and 3.7 Max, DeepSeek V4 Pro and Flash, MiniMax M3 and M2.7, MiMo-V2.5;
- plus Grok 4.5, GPT 5.6 Luna and Hy3.

Check the live console before relying on any of them. There's no Gemini, which the prior-art research rated best on tables.

Suggested mix:

| Sieve | Runs on |
|---|---|
| Extraction from the original | Claude, in Claude Code |
| Markdown, and extraction from Markdown | a different family through OpenCode Go (Kimi K3 or Qwen3.8 Max) |
| Tie-break | a third family (DeepSeek V4 Pro or GLM-5.2) |
| Baseline | a cheap single model (DeepSeek V4 Flash), which makes the contrast honest |

At a few cents per Document, the $12 per 5 hours cap is enough for the demo and the accuracy run. Watch it during the night anyway.

## Next steps

- Artur decides Q32 and open questions 2–4 (each suggestion above can be accepted with a "yes").
- Then Claude updates `GLOSSARY.md` (the Operator definition, Worker marked as a sub-agent, Trace, Challenge deposit, Arbiter fee) and publishes tickets under spec #1 for:
  - outside Operators taking whole Documents (Q30);
  - the Challenge deposit and Arbiter fee (Q31);
  - the Trace format and its rendering in the Sieve track, if accepted.

Sources: [OpenCode Go docs](https://opencode.ai/docs/en/go/), [OpenCode Go page](https://opencode.ai/go), [Vercel json-render (InfoQ)](https://infoq.com/news/2026/03/vercel-json-render), [json-render (The New Stack)](https://thenewstack.io/vercels-json-render-a-step-toward-generative-ui/).
