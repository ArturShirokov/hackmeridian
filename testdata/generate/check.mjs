// Checks one expected-values file against its Template's Fields and the Document's text layer.
// Returns a list of problems; empty means the file is complete and every quote is really in the Document.

const fold = (s) => s.replace(/\s+/g, " ").trim();

export function checkExpected(expected, fields, pages) {
  const problems = [];
  for (const key of Object.keys(expected.fields)) {
    if (!(key in fields)) problems.push(`${key}: not a ${expected.template} Field`);
  }
  for (const [name, field] of Object.entries(fields)) {
    const v = expected.fields[name];
    if (v === undefined) {
      problems.push(`${name}: missing (give a value or "Not stated")`);
      continue;
    }
    if (v === "Not stated") continue;
    if (v.value === undefined || !v.page || !v.quote) {
      problems.push(`${name}: needs value, page and quote`);
      continue;
    }
    if (!fold(pages[v.page - 1] ?? "").includes(fold(v.quote))) {
      problems.push(`${name}: quote not found on page ${v.page}`);
    }
    if (field.unit && v.unit !== field.unit) problems.push(`${name}: unit ${v.unit}, want ${field.unit}`);
    if (field.type === "composition") {
      const sum = Math.round(Object.values(v.value).reduce((a, b) => a + b, 0) * 10) / 10;
      if (sum !== 100) problems.push(`${name}: adds to ${sum}, want 100`);
    }
  }
  return problems;
}
