// A fake harness for the shift runner tests: node fake-harness.mjs <good|garbage> <log file> <prompt>
// Runs in the Job's directory, like a real harness: reads job.json and document.pdf, prints a result on stdout.
// Appends each prompt it gets to the log file (one JSON line), so tests can count runs and read retries.
import { appendFileSync, readFileSync } from "node:fs";

const [mode, log, prompt] = process.argv.slice(2);
appendFileSync(log, JSON.stringify(prompt) + "\n");
if (mode === "garbage") {
  console.log("Sorry, I could not read the PDF.");
  process.exit(0);
}
const job = JSON.parse(readFileSync("job.json", "utf8"));
if (readFileSync("document.pdf").subarray(0, 4).toString() !== "%PDF") throw new Error("no PDF");
const result =
  job.sieve === "markdown"
    ? { markdown: job.document.text.join("\n\n") }
    : job.sieve === "faithfulness"
      ? { pass: true }
      : { fields: job.template.fields.map((f) => ({ field: f.name, notStated: true })) };
// Like a chatty model: prose around a fenced block.
console.log("Here is the result:\n```json\n" + JSON.stringify(result, null, 2) + "\n```");
