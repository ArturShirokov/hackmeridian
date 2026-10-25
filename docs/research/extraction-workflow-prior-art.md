# Extraction workflow: prior art for multi-pass DPP field extraction

Researched 2026-10-25 for the hackathon build (two cross-family Extractors, then normalise, then compare field by field, then a blind Checker, then a human).

Evidence labels:
- **READ**: I opened the source and read the passage cited.
- **ABSTRACT**: I read only the abstract.
- **SEARCH-ONLY**: the claim comes from a search snippet or summary. Check it before you rely on it.

---

## TL;DR

1. **Agreement between two passes is the best cheap signal. Resampling one model is not.** In EXTRACTCONF (DocILE invoices), self-consistency over 5 samples barely beat logprobs for routing. Two structurally different calls added the largest single gain in the ablation. In Khan et al., GPT-4 and Claude agreed on 87% of fields, and the agreed fields were 94% accurate. Fields where they disagreed were 41–50% accurate.
2. **Agreement is not proof.** Even agreed fields were wrong about 6% of the time (Khan). LLM errors are correlated: when two models are both wrong, they give the same wrong answer about 60% of the time (Kim et al., ICML 2025). So you need a random audit sample on top of routing disagreements.
3. **Send page images to the model. Do not send parser Markdown alone.** On scanned invoices, image input beat Docling Markdown by 25–40 points (Fraunhofer, 2025). SAP (2026) found image + OCR text gives the most stable results across models. Table parsers range from 2.1 to 9.55 out of 10.
4. **Define "wrong" by field type** (VRDU type-aware matching, ANLS* for null and list handling). Use exact match after canonicalisation for money fields. Do not use fuzzy matching on numbers or IDs.
5. **Vova's raw-vs-Markdown dual pass:** a different view of the same document does carry signal (EXTRACTCONF shows it, though with prompt asymmetry rather than input asymmetry). But the Markdown is derived from the raw document, so parser errors look like disagreements, and "loop until match" turns agreement into a forced outcome. When Khan's disagreeing models were made to agree through cross-critique, those fields were only 76% accurate, against 94% for fields that agreed the first time.

---

## Q1. Multi-pass and ensemble extraction: what measurably helps

| Technique | Evidence | Result | Label |
|---|---|---|---|
| Self-consistency (5 samples of one model) | EXTRACTCONF, arXiv 2606.24420, Table 1 | AUC 0.744 vs logprob 0.705, but AURC 0.138 vs 0.145, so almost no routing gain at 5x cost. Five binary votes give only 6 distinct confidence levels. | READ |
| Verbalised confidence | same | AUC 0.692. All baselines collapse to "everything is confident" at a 0.5 threshold. | READ |
| Two structurally different calls (field-by-field "Hunter" vs whole-document "Mapper", same GPT-4o) | same | Agreement features alone: AUC 0.828. Adding Mapper agreement was the largest single gain in the ablation: AURC 0.065 to 0.043 (-34%). Hunter tends to invent values for absent fields; Mapper tends to miss fields that are hard to see. | READ |
| OCR/value-region readability as a signal | same | OCR features alone, AUC 0.896, beat logprobs (0.880). Most errors are caused by the document, not the model. | READ |
| Full fusion plus routing | same | AUC 0.928. Automating the top 80% of fields gives 99.1% accuracy (base rate 73.3%). Only one backbone (GPT-4o) was tested. | READ |
| Cross-family two-reviewer setup (GPT-4-turbo + Claude-3-Opus) | Khan et al., JAMIA 32(4) 2025 / medRxiv 2024.09.20.24314108 | 87% concordant. Accuracy 0.94 when concordant, 0.41/0.50 when discordant. Cross-critique made 51% of disagreements concordant, at 0.76 accuracy. 10 trials, 23 variables, so a small sample. | ABSTRACT (Europe PMC) |
| Correlated errors across models | Kim et al., ICML 2025, arXiv 2506.07962 | 350+ LLMs. When both are wrong, they agree on the same wrong answer about 60% of the time. Same provider or architecture increases this. Larger models have correlated errors even across providers. | ABSTRACT |
| Grounding and localisation | LMDX (Google), arXiv 2309.10952 | Has the LLM output entities with their source location, so each value can be checked against the document. Uses null for missing singular fields and [] for missing repeated ones. Was state of the art on VRDU and CORD. | READ (method sections) |
| Pre-inference routing (cheap vs strong model) | arXiv 2608.06607 | Saves 31–77% only when the cheap model fails often and its failures are predictable. No benefit on clean digital invoices. | READ (abstract + intro) |

### Benchmarks
- **DocILE** (Rossum/CTU, arXiv 2302.05658). 6.7k real business documents, 55 field classes, line items. The primary metric is localisation AP: the predicted box must cover exactly the ground-truth characters. Line items are scored by micro-F1 after maximum matching between predicted and true items. Value normalisation (dates and similar) is not done by the benchmark. READ.
- **VRDU** (Google, arXiv 2211.15421). Type-aware matching: "4" and "4.0" count as equal for numbers, but "4, Main St." and "40 Main St." do not match as addresses. Separate matchers for price, date, address and string. READ.
- **CORD, SROIE**: receipts. SROIE has only about a 4% failure rate, so it gives little negative signal (EXTRACTCONF). READ.

### Vendor practice
- **Reducto**: each field returns `citations` (bbox, page, block), a high/low `confidence`, and numeric `parse_confidence` (OCR) and `extract_confidence` (LLM). An empty citations list means the value was inferred or could not be localised. READ ([docs](https://docs.reducto.ai/configs/extract/citations.md)). "Agentic OCR" adds a VLM review pass and "Deep Extract" refines iteratively. SEARCH-ONLY.
- **LlamaExtract**: per-field citations with bbox, and a 0–1 confidence per field. The docs say "a score of 0.8 does not always mean an 80% probability of correctness", that you should validate per tier and version, and that citations and confidence "significantly slow down" extraction. READ ([docs](https://developers.llamaindex.ai/python/cloud/llamaextract/features/extensions)).
- **AWS Bedrock Data Automation**: per-field confidence, which AWS says is optimised for Expected Calibration Error. Suggested bands are high 90–100, medium 70–89 and low below 70, and the demo routes fields below 70% to SageMaker review. READ ([AWS blog](https://aws.amazon.com/blogs/machine-learning/process-multi-page-documents-with-human-review-using-amazon-bedrock-data-automation-and-amazon-sagemaker-ai)).
- **AWS A2I + Textract**: activation conditions are key confidence, missing keys, a confidence range, and "Randomly send a sample of forms to humans for review". A2I is now closed to new customers. READ ([docs](https://docs.aws.eu/sagemaker/latest/dg/a2i-textract-task-type.html)).
- **Google Document AI HITL**: offered confidence-threshold filters and specialist pools. It is now deprecated and listed on Google's deprecations page. Google points users to partners (Devoteam, Searce, Quantiphi) for review. Partly READ ([deprecations](https://docs.cloud.google.com/document-ai/docs/hitl/quickstart)); the partner pointer is SEARCH-ONLY.
- **Unstructured**: I did not find documented field-level verification. Not researched further.

---

## Q2. Defining "wrong" field by field

### What benchmarks do
- **Exact match after light normalisation.** The Fraunhofer invoice benchmark standardises dates and whitespace, and deliberately does *not* forgive comma/dot errors in numbers, "since it can be very important for correct order processing". READ (2509.04469).
- **Type-aware matching** (VRDU): numeric equivalence, strict address and ID comparison. READ.
- **ANLS / ANLS\*** (arXiv 2402.03848). Normalised Levenshtein similarity for strings. *None* handling: if the truth is None, any answer is penalised (that is a hallucination). Lists are aligned with Hungarian matching, and both missing and invented items are penalised. Dicts penalise missing and invented keys. READ.
- **Evaluation method dominates.** Switching between exact and fuzzy matching moved F1 about 5x more than switching models, and 23% of exact-match "errors" were actually correct (MAVE). READ (2607.22949). For our design: the matching rule is a product decision, not a detail.
- **Tables**: TEDS and GriTS correlate with human judgement at only r ≈ 0.68–0.70. An LLM judge reaches r = 0.93. READ (2603.18652).

### Recommended correctness rule for the demo (apply after normalisation)

| Field type | Examples | Canonical form | "Correct" / "agree" iff | Notes |
|---|---|---|---|---|
| Enum / code | battery chemistry (LFP, NMC811…), country of origin (ISO 3166-1 alpha-2), certification scheme (GRS, OEKO-TEX STANDARD 100) | Value from a controlled list, via a synonym table | Exact code match | An unmapped synonym counts as disagreement and goes to the Checker. Never fuzzy-match. |
| Quantity with unit | capacity (Ah), nominal voltage (V), mass (kg), energy (Wh), carbon footprint (kg CO2e/kWh) | SI or DPP unit via `pint`, plus a **qualifier** (nominal / rated / min / typical; per kWh vs total) | Same qualifier **and** \|a−b\| ≤ half a unit of the least significant digit printed in the source | No percentage tolerance on money fields. A qualifier mismatch (nominal vs minimum capacity) counts as wrong even when the numbers match. |
| Percent composition (multi-value) | fibre composition, recycled content by material | Set of (canonical fibre, %) pairs | Same set of fibres (no missing, no extra), each % exact, and the sum is 100 (±0 if printed as integers) | Use ANLS*-style list semantics: missing and invented items both count as wrong. A sum ≠ 100 is a validation failure and goes to a human. |
| Identifier | certificate/licence number, GTIN, batch ID | Upper-case, strip spaces and dashes | Exact match | Don't use Levenshtein. One wrong digit makes it a different certificate. |
| Date | test date, certificate expiry | ISO 8601 | Exact match | Ambiguous source formats (03/04/25) go to the Checker. |
| Free text | manufacturer name, address, test lab | NFKC, case-fold, collapse whitespace | Exact match after normalisation, or ANLS ≥ 0.9 for **display-only** fields | Use ANLS only for fields with no money at stake. |
| Absent | any | Three states: `value`, `not_stated` (the document is silent), `not_extracted` | `not_stated` == `not_stated` counts as agree. Value vs `not_stated` counts as disagreement. | A value where the truth is `not_stated` is the dangerous error (a hallucination). Weight it above a miss. |

Grounding rule: every value must carry `{page, verbatim_quote}`, and the quote must appear in the PDF text layer or OCR (fuzzy ≥ 0.95 is fine for the quote check itself). If the quote fails, the field is wrong by default and goes to the Checker. This is the same idea as Reducto's empty-citations flag and LMDX grounding.

Field weights: give each field a `stake` (for example the € effect of eco-modulation or fees if it is wrong). Use it only for **routing**, not for scoring.

### (a) Who reviews disputed fields in production IDP
- **The customer's own staff, or a vendor workforce they contract. Never the document's sender.** AWS Ground Truth/A2I offers three workforces: a *private* workforce (your own employees or contractors, managed via Cognito/OIDC), a *vendor* workforce from AWS Marketplace, or Mechanical Turk. Private is the choice for sensitive data or data that needs in-house expertise. SEARCH-ONLY ([workforces](https://docs.aws.eu/sagemaker/latest/dg/sms-workforce-management.html)). Google HITL used customer-defined "specialist pools" and now points to consulting partners. Partly READ. BDA routes to the customer's SageMaker reviewers. READ.
- I found **no documented IDP product where the document's author resolves extraction disputes.** That is absence of evidence, not a source.
- **Recommendation (my reasoning, not sourced):** the Brand's staff should decide. When the document itself is ambiguous, the Supplier can be *asked to clarify or re-issue* the document, and the reply becomes a new document that goes back through the pipeline. Don't let the Supplier edit the extracted field. The Supplier has a stake in fields like recycled content and carbon footprint, so they should not be the one deciding them.

### (b) Planned routing: random audit sample (ledger-seeded) plus every disagreement to a blind Checker
The literature supports both parts:
- **Disagreements go to review.** Discordant fields were 41–50% accurate (Khan). Cross-call disagreement was the largest single reliability gain (EXTRACTCONF). READ/ABSTRACT.
- **A random audit of *agreed* fields is needed.** Agreed fields were still about 6% wrong (Khan). Errors are correlated across providers (Kim). Even EXTRACTCONF's best band is 99.1%, not 100%. A2I ships "randomly send a sample … for review" as a standard trigger, and AWS describes it as being for model audits. READ. The audit is also the only unbiased estimate of your residual error rate. Disagreement routing alone only shows you the errors you already caught.
- **Two cautions.** (1) A Checker that resolves a disagreement is weaker evidence than first-pass agreement: 0.76 vs 0.94 in Khan. Fields with high stakes that the Checker resolved should still go to a human, or at least be oversampled in the audit. (2) Stratify the audit by `stake`: sample high-stake agreed fields at a higher rate. A ledger seed makes the sample verifiable after the fact, but it gives no accuracy benefit. I found no literature on ledger-seeded audit samples specifically.

---

## Q3. Vova's raw + Markdown dual pass vs two model families on the same PDF

**For it:**
- EXTRACTCONF shows two *different* readings of one document by the *same* model give an informative disagreement signal (AUC 0.828 from agreement alone). The difference there came from prompt and output structure, not input format, so it is indirect support. READ.
- The SAP study found the OCR-only and image-only views fail differently: OCR-only errors are mostly schema ambiguity, image-only errors are mostly visual. So the two views do diversify the failures. READ.

**Against it:**
- The Markdown is *derived from* the raw document, so the two passes are not independent. Parser errors (merged cells, dropped tables, comma/dot problems) appear as disagreements that are really conversion artefacts. Parsers that silently drop content would give "Markdown says nothing" every time. Docling Markdown capped accuracy at 84–85% for every model on clean invoices and lost 25–40 points on scans (2509.04469, READ). Claude Sonnet 4.6 as a table parser often omitted whole tables (2603.18652, READ).
- Using the same model for both passes keeps the model's own biases in both. Kim et al. show error correlation is highest within the same provider or architecture. ABSTRACT.
- "Loop until all match" pressures the system towards agreement. In Khan, agreement reached through critique was 0.76 accurate, against 0.94 for agreement on the first pass. ABSTRACT.

**No study tests raw+Markdown/same-model directly against cross-family/same-PDF.** Indirect verdict: cross-family on the same images gives more independent errors, while still being correlated (Kim). Keep Vova's priority weighting and human fallback, but drop the convergence loop.

---

## Q4. Parse to Markdown first, or send page images to the model?

- **Fraunhofer 2025** (arXiv 2509.04469), GPT-5 / Gemini 2.5 / Gemma 3 on 3 invoice sets: native image processing beat Docling Markdown on every dataset and model (scanned receipts 87.5% vs 47.0% best; scanned invoices 92.7% vs 64.0%). Caveat: the inputs were scans, not native-text PDFs. READ.
- **SAP + Stanford 2026** (arXiv 2603.02789), 11 MLLMs, real supply-chain and finance documents: image-only was comparable to OCR-only for strong models (Gemini, Nova) and worse for others (Claude 3 Opus image-only 50.1 vs OCR 70.1). **Image + OCR gave the narrowest spread (70–75 F1) and was the most robust choice across models.** READ.
- **Table parsing leaderboard 2026** (arXiv 2603.18652), 21 parsers, 451 tables: Gemini 3 Pro 9.55 and Flash 9.50, Mistral OCR 3 8.89, GPT-5 mini 7.14, Claude Sonnet 4.6 7.02 (often omits tables), PyMuPDF4LLM 5.25. General VLMs beat dedicated OCR tools. Even the best still change values or misalign spanning cells. READ.
- **OHRBench** (arXiv 2412.02592): OCR noise carries through to downstream QA. The best OCR was still ≥14% below ground-truth text. ABSTRACT. A secondary write-up says image+OCR beats either alone; SEARCH-ONLY.

**Verdict for spec sheets and test reports:** send page images **plus** the PDF's native text layer when one exists. The text layer is exact characters for digital PDFs, it's free, and it guards against the model misreading digits. Use Markdown at most as an extra hint, never as the only input. For tables, the Gemini family is the strongest extractor in published 2026 numbers.

---

## Q5. Recommended workflow for tonight

1. **Preprocess (free, under 1 s per page):** render pages at 150–200 DPI with PyMuPDF and pull the text layer. If there is no text layer (a scan), run the extractors on images only and mark the document `scanned`, which raises the audit rate.
2. **Two Extractors in parallel, different families:** Gemini (strongest on tables) plus Claude or GPT. Both get images + text layer + a JSON schema. Each field returns `{value, unit, qualifier, page, verbatim_quote, not_stated}`. Use **one call each, not self-consistency** (EXTRACTCONF: 5x cost, almost no routing gain).
3. **Normalise** deterministically: unit conversion with `pint`, synonym tables, ISO codes. Then **validate**: quote found in text, range checks, fibre sum = 100, and qualifier present.
4. **Compare** with the rules in Q2.
5. **Route to the blind Checker** (a third call, ideally a third family or the stronger of the two). It gets the field definition, the relevant pages, and the candidate values unlabelled, with a "none / not stated" option. Route a field when there is any disagreement, a failed quote check, a validation failure, or value vs `not_stated`.
6. **Route to a human (the Brand's staff):** when the Checker picks neither candidate or can't ground its pick, when the field is high-stake and was resolved by the Checker, when the sum check fails, and for the **ledger-seeded random audit** of agreed fields (stratified by stake, for example 5% of all agreed fields and 20% of high-stake ones). Ask the Supplier only for clarification or a re-issued document.
7. **Auto-accept:** both agree, the quote is verified, validation passes, and the field was not drawn for audit.
8. **Don't** loop the extractors until they agree.

**Rough cost and latency (estimate, check current price sheets):** for a typical 3–6 page document, each Extractor call is about 8–15k input tokens (page images at roughly 1–1.6k tokens per page, plus the text layer and schema) and 1–2k output tokens. Two Extractors plus one batched Checker call on the ~10–20% of flagged fields comes to about 30–40k input and 4–6k output per document. At mid-tier prices that is roughly $0.05–0.25 per document; flash/mini tiers cost a few cents. Wall clock is about 15–45 s with the Extractors running in parallel, plus about 10–20 s when the Checker fires. Human review time dominates the total cost, so the number to tune is the audit rate.

---

## Sources

- Kumar, *EXTRACTCONF: Multi-Signal Confidence Engine for LLM-Based Document Field Extraction*, arXiv [2606.24420](https://arxiv.org/abs/2606.24420) (IJCAI-ECAI 2026 RobustifAI workshop). READ.
- Khan et al., *Collaborative LLMs for Automated Data Extraction in Living Systematic Reviews*, JAMIA 2025; [medRxiv](https://www.medrxiv.org/content/10.1101/2024.09.20.24314108), [PubMed 39399004](https://pubmed.ncbi.nlm.nih.gov/39399004/). ABSTRACT.
- Kim et al., *Correlated Errors in Large Language Models*, ICML 2025, arXiv [2506.07962](https://arxiv.org/abs/2506.07962). ABSTRACT.
- Šimsa et al., *DocILE Benchmark*, arXiv [2302.05658](https://arxiv.org/abs/2302.05658). READ.
- Wang et al., *VRDU*, arXiv [2211.15421](https://arxiv.org/abs/2211.15421). READ.
- Perot et al., *LMDX*, arXiv [2309.10952](https://arxiv.org/abs/2309.10952). READ (method).
- Peer et al., *ANLS\**, arXiv [2402.03848](https://arxiv.org/abs/2402.03848). READ.
- Dwivedi & Soni, *Beyond Exact Match*, arXiv [2607.22949](https://arxiv.org/abs/2607.22949). READ.
- Berghaus et al., *Multi-Modal Vision vs. Text-Based Parsing: Invoice Processing*, arXiv [2509.04469](https://arxiv.org/abs/2509.04469). READ.
- Shen et al. (SAP), *OCR or Not?*, arXiv [2603.02789](https://arxiv.org/abs/2603.02789). READ.
- Horn & Keuper, *Beyond String Matching: Semantic Evaluation of PDF Table Extraction*, arXiv [2603.18652](https://arxiv.org/abs/2603.18652). READ.
- Zhang et al., *OCR Hinders RAG (OHRBench)*, arXiv [2412.02592](https://arxiv.org/abs/2412.02592). ABSTRACT.
- Rajendran, *Pre-Inference Routing for Cost-Efficient Document Field Extraction*, arXiv [2608.06607](https://arxiv.org/abs/2608.06607). READ (intro).
- Reducto citations docs; LlamaExtract extensions docs; AWS BDA + SageMaker review blog; AWS A2I Textract task type; Google Document AI deprecations. Links inline above.
