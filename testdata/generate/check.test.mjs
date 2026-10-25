import { test } from "node:test";
import assert from "node:assert/strict";
import { checkExpected } from "./check.mjs";

const fields = { rated_capacity_ah: { type: "quantity", unit: "Ah" }, name: { type: "text" } };
const pages = ["Model: KC-18650\nCapacity   3200   mAh (typical)"];
const capacity = { value: 3.2, unit: "Ah", qualifier: "typical", page: 1, quote: "Capacity 3200 mAh (typical)" };

test("an expected-values file with every Field and quotes found in the Document passes", () => {
  const expected = { template: "battery", fields: { rated_capacity_ah: capacity, name: "Not stated" } };
  assert.deepEqual(checkExpected(expected, fields, pages), []);
});

test("a Template Field with neither a value nor Not stated is reported", () => {
  const expected = { template: "battery", fields: { rated_capacity_ah: capacity } };
  assert.deepEqual(checkExpected(expected, fields, pages), ["name: missing (give a value or \"Not stated\")"]);
});

test("a quote that is not on the cited page of the Document is reported", () => {
  const expected = {
    template: "battery",
    fields: { rated_capacity_ah: { ...capacity, quote: "Capacity 3.2 Ah" }, name: "Not stated" },
  };
  assert.deepEqual(checkExpected(expected, fields, pages), ["rated_capacity_ah: quote not found on page 1"]);
});

test("a quantity not in the Field's canonical unit is reported", () => {
  const expected = {
    template: "battery",
    fields: { rated_capacity_ah: { ...capacity, value: 3200, unit: "mAh" }, name: "Not stated" },
  };
  assert.deepEqual(checkExpected(expected, fields, pages), ["rated_capacity_ah: unit mAh, want Ah"]);
});

test("a fibre composition that does not add to 100 is reported", () => {
  const f = { fibre_composition: { type: "composition", unit: "%" } };
  const expected = {
    template: "textile",
    fields: { fibre_composition: { value: { cotton: 60, polyester: 35 }, unit: "%", page: 1, quote: "Model" } },
  };
  assert.deepEqual(checkExpected(expected, f, pages), ["fibre_composition: adds to 95, want 100"]);
});

test("a key that is not a Template Field is reported", () => {
  const expected = { template: "battery", fields: { rated_capacity_ah: capacity, name: "Not stated", colour: "Not stated" } };
  assert.deepEqual(checkExpected(expected, fields, pages), ["colour: not a battery Field"]);
});
