# HackMeridian: data standardisation

Turning messy supplier documents into structured product-passport data that a brand can trust, with money at stake on each answer.

## Language

### Parties

**Brand**:
The company that receives Documents from its Suppliers, uploads them, and wants them as passport data. It pays for the work and is paid when a Field is wrong.
_Avoid_: Client, customer, buyer

**Supplier**:
The company that produced the goods and wrote the original Documents.
_Avoid_: Vendor, manufacturer

**Operator**:
Whoever runs a Pipeline and puts money behind its output. Today that is us; later, third parties.
_Avoid_: Agent, provider, miner

**Arbiter**:
A neutral third party, never the Brand or the Operator, that decides Challenges.
_Avoid_: Judge, reviewer, validator

### Data

**Document**:
One file a Supplier sent to a Brand, such as a battery spec sheet, a test report or a textile certificate, in whatever format it arrived.
_Avoid_: File, upload, PDF

**Template**:
The fixed set of Fields a passport for one product category must have. There are two in scope: battery and textile.
_Avoid_: Schema, form

**Field**:
One named slot in a Template, such as rated capacity or fibre composition, and the unit of work that gets extracted, challenged and paid for.
_Avoid_: Attribute, property, key

**High-stake Field**:
A Field marked in its Template as the most likely to be Challenged, such as recycled content, carbon footprint or
fibre composition. It needs both extraction Sieves to agree, never a majority; when they differ it is Not stated.
It is about how a Field converges, not about money: the Bond is per Document, and an upheld Challenge Slashes the
same share whichever Field it names.
_Avoid_: Critical field, staked field

**Correct**:
A Field value is correct when it matches what the Document states, read under the Template's rules. Whether the physical product really has that value is out of scope.
_Avoid_: True, accurate, verified

**Not stated**:
A legitimate Field value meaning the Document doesn't clearly give this Field. It is backed like any other value and becomes a Supplier Request.
_Avoid_: Null, missing, unverified

**Supplier Request**:
A request to the Supplier to clarify or re-issue a Document for a Field marked Not stated.

### Work

**Pipeline**:
An Operator's whole method for turning a Document into Field values: an ordered set of Sieves. The Brand only ever sees its final output.
_Avoid_: Workflow, agent, model

**Sieve**:
One independent pass inside a Pipeline, defined by its view of the Document (original, normalised Markdown or a mix) and the model reading it. Sieves narrow down a value until it converges.
_Avoid_: Extractor, checker, step

**Baseline**:
A one-pass Pipeline with a single Sieve, run next to ours to show what the extra Sieves buy.

**Job Board**:
The one place where open Jobs are listed and finished work is handed in. Workers come to it; it never reaches out to them.
_Avoid_: Marketplace, queue, orchestrator

**Job**:
One Sieve pass over one Document, which a Worker takes, completes, and hands back to the Job Board.
_Avoid_: Task, ticket, request

**Worker**:
An AI session, in any harness and with any model, connected to the Job Board and doing Jobs.
_Avoid_: Agent, bot

### Money

**Bond**:
The money an Operator locks behind one Document's final Field values. It is what pays the Brand when a Field turns out not to be Correct.
_Avoid_: Stake, deposit, collateral

**Fee**:
What the Brand pays the Operator for a Document. It is released with the rest of the Bond when the Challenge Window closes.
_Avoid_: Price, reward

**Challenge**:
A claim that a Field isn't Correct, made by pointing to the place in the Document that says otherwise.
_Avoid_: Dispute, flag, appeal

**Challenge Window**:
The period after delivery during which anyone can make a Challenge. When it closes with no Challenge upheld, the Bond and Fee settle automatically.

**Slash**:
The part of a Bond paid to the Brand when the Arbiter upholds a Challenge.
_Avoid_: Penalty, refund
