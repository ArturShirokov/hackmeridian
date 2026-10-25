# Demo

## Before going on stage

- [ ] `npx tsx scripts/topup-wallets.ts`: every wallet has XLM, Brand and both Operators have 20 USDC.
- [ ] Re-run the smoke test once (`LEDGER=payments` or `trustless-work`) and keep its stellar.expert tabs open, in
      case the testnet is slow on stage.
- [ ] Start the demo replay: `npm run demo` (or `DEMO_REPLAY=testdata/runs/<live run>.json npm run demo` once a live
      cache exists). Start it no more than a minute before your slot: the 3-minute Challenge Window starts now.
- [ ] For the live Workers beat: start the Job Board (`PORT=3100 npm start`) and, a few minutes before the slot,
      the shift (`npx tsx scripts/shift.ts`) in a terminal you can show. Check the four "on shift" lines and that
      `/api/workers` lists w1 to w4 with their harness and model: two `claude/sonnet`, two `pi/qwen3.8-max`. Each
      Document needs 4 distinct extraction Workers (2 ours + tie-break + Baseline). The OpenCode Workers are off:
      their 60-Field extractions ran past the 9-minute run limit on 25 Oct. Keep `battery-02-kestrel-18650-cell-datasheet.pdf`
      ready to upload.
- [ ] Browser tabs: `http://127.0.0.1:3000/`, `/arbiter`, `/leaderboard`, `testdata/documents/battery-04-helion-storage-module.pdf`.
- [ ] Copy the Challenge quote to the clipboard: `Recycled lithium, this production lot (pre + post consumer) 6 %`
- [ ] Backup video on the laptop desktop, playable offline.

## Three-minute script

**0:00 to 0:30. The problem.** "Every battery and textile sold in the EU needs a Digital Product Passport. The data
arrives from Suppliers as PDFs in every layout, and today someone retypes it. AI can read them, but when it gets a
value wrong, the Brand pays, and finds out from an auditor."

**0:30 to 1:00. How it works.** On `/`: "A Brand uploads a Supplier PDF and picks a Template. Our Pipeline is a
chain of independent Sieves, each a different AI Worker with a different view of the Document: the PDF itself, a
Markdown version checked against it, a tie-break when they disagree. Anything still unclear comes back as Not
stated, with quotes, and becomes a Supplier Request. Workers are Claude Code, OpenCode or Pi sessions connected to
our Job Board over MCP." On the live board (`http://127.0.0.1:3100/`), upload battery-02 and switch to the shift terminal: "Four Workers, Claude Sonnet and Qwen, have been
waiting on this laptop. No model ran until now." Lines appear as each Worker takes a Sieve
(`w3 · pi/qwen3.8-max · took Markdown extraction for battery-02… · 41 s · submitted`). Don't wait for all of
them; go on to the replayed Helion Document and come back to battery-02 at the end if time allows.

**1:00 to 1:40. Side by side.** Open the fourth Document (battery, Helion storage module). "Left, our Pipeline;
right, a one-pass Baseline on the same Document. Each Operator has locked a Bond in USDC on Stellar, with a hash of
its output." Point at recycled lithium: "The Baseline says 16 %. That's the big number in the highlight box on page 1,
but it's the 2031 roadmap target. Page 2 says this lot has 6 %. Ours says 6 %." Open the PDF to show both.

**1:40 to 2:20. Challenge and Slash.** "Challenge a Field" on the Baseline: Recycled lithium, page 2, paste the
quote, value 6, unit %. File it. On `/arbiter`: "A neutral Arbiter decides from the Document alone." Uphold.
"A tenth of the Baseline's Bond goes to the Brand, automatically, when the window closes."

**2:20 to 2:50. Leaderboard and the chain.** On `/leaderboard` (refresh after the window closes): our Operator, no
upheld Challenges; the Baseline, one, 1 USDC Slashed. Then the stellar.expert tab from the smoke run: "Real test
USDC moved: escrow, release, Slash."

**2:50 to 3:00. Close.** "The Bond doesn't make the model careful. It makes careless Pipelines expensive to run, and
their error rate public. We measured X% Correct on N Fields on our test Documents."

If the window has not closed by 2:20, say "in production the window is days; here it's three minutes" and show the
leaderboard from the backup video instead.

## Two-minute backup video checklist

Record from `npm run demo` with `CHALLENGE_WINDOW_MIN=1`, so the Slash lands on the leaderboard within the video.

- [ ] Fresh demo start, browser at 125 % zoom, no other tabs or notifications visible.
- [ ] 0:00 to 0:15: title card or `/` with the six Documents; one line of voice-over on the problem.
- [ ] 0:15 to 0:40: the Helion Document side by side; the Bond and output hash lines; zoom on recycled lithium,
      16 % vs 6 %.
- [ ] 0:40 to 0:55: the PDF, page 1 highlight box ("Roadmap target for 2031"), then the page 2 table row with 6 %.
- [ ] 0:55 to 1:20: file the Challenge on the Baseline (page 2, the quote, 6 %), then Uphold on `/arbiter`.
- [ ] 1:20 to 1:35: the Document page after the window closes ("Settled: ... Slashed to the Brand") and `/leaderboard`.
- [ ] 1:35 to 1:50: a stellar.expert transaction from the smoke run (escrow and Slash), plus a Worker terminal
      calling `next_job` / `submit_job` if a live-run recording exists.
- [ ] 1:50 to 2:00: the stage line and the measured accuracy line.
- [ ] Export at 1080p, under 2:00, with captions burned in (venue audio is unreliable). Keep a copy offline and one
      linked from the README.
- [ ] Cut a 10-second GIF from 0:15 to 1:20 and save it as `docs/demo.gif` for the README.
