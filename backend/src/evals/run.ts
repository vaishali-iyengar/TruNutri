import "dotenv/config";
import { readFileSync, writeFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { checkScope } from "../scope/guard.js";
import { callModel } from "../model/client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const QUESTIONS_PATH = join(__dirname, "questions.json");
const RESULTS_DIR = join(__dirname, "results");

interface EvalCase {
  question: string;
  expectCategory: string | null;
}

const MAX_ANSWER_LENGTH = 1000;

// The 1000-char budget applies to the core answer only — the short trailing
// source aside (e.g. "(USDA)" or "– per USDA guidance") is exempt. There's no
// structural separator in the schema (just one `answer` string), so this
// strips the common trailing-citation shapes we've actually observed before
// measuring length. It's a heuristic, not a parser — good enough for an eval
// warning, not something to build stricter enforcement on top of.
function stripTrailingCitation(answer: string): string {
  const withoutClause = answer.replace(/[\s.,–—-]*\(?\s*(?:per|according to)\s+[^().]*\)?\.?\s*$/i, "");
  // A bare trailing acronym aside, e.g. "(USDA)" or "(USDA/FAO)" — deliberately
  // narrow (all-caps only) so it doesn't accidentally eat a real trailing
  // parenthetical like "(especially red)" at the end of a bullet list.
  return withoutClause.replace(/[\s.,–—-]*\([A-Z]{2,8}(?:\/[A-Z]{2,8})?\)\.?\s*$/, "").trim();
}

interface EvalResult {
  question: string;
  expectCategory: string | null;
  actualCategory: string | null;
  schemaValid: boolean;
  answer: string | null;
  matchesExpectation: boolean;
  modelError: string | null;
  overLength: boolean;
}

async function run() {
  const cases: EvalCase[] = JSON.parse(readFileSync(QUESTIONS_PATH, "utf-8"));
  const results: EvalResult[] = [];

  for (const testCase of cases) {
    const preCategory = checkScope(testCase.question);

    if (preCategory) {
      results.push({
        question: testCase.question,
        expectCategory: testCase.expectCategory,
        actualCategory: preCategory,
        schemaValid: true,
        answer: null,
        matchesExpectation: preCategory === testCase.expectCategory,
        modelError: null,
        overLength: false,
      });
      continue;
    }

    try {
      const { parsed } = await callModel([{ role: "user", content: testCase.question }]);
      const postCategory = parsed ? checkScope(parsed.answer) : null;

      results.push({
        question: testCase.question,
        expectCategory: testCase.expectCategory,
        actualCategory: postCategory,
        schemaValid: parsed !== null,
        answer: parsed?.answer ?? null,
        matchesExpectation: (postCategory ?? null) === testCase.expectCategory,
        modelError: null,
        overLength: parsed !== null && stripTrailingCitation(parsed.answer).length > MAX_ANSWER_LENGTH,
      });
    } catch (err) {
      results.push({
        question: testCase.question,
        expectCategory: testCase.expectCategory,
        actualCategory: null,
        schemaValid: false,
        answer: null,
        matchesExpectation: false,
        modelError: err instanceof Error ? err.message : String(err),
        overLength: false,
      });
    }
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = join(RESULTS_DIR, `${timestamp}.json`);
  writeFileSync(outPath, JSON.stringify(results, null, 2));

  const priorFiles = readdirSync(RESULTS_DIR)
    .filter((f) => f.endsWith(".json") && f !== `${timestamp}.json`)
    .sort();
  const priorFile = priorFiles[priorFiles.length - 1];

  console.log(`\nEval run: ${results.filter((r) => r.matchesExpectation).length}/${results.length} matched expectation\n`);

  for (const r of results) {
    const flag = r.modelError ? "ERR " : r.matchesExpectation ? "OK  " : "FAIL";
    console.log(`[${flag}] ${r.question}`);
    if (r.modelError) {
      console.log(`       model error: ${r.modelError}`);
    } else if (!r.matchesExpectation) {
      console.log(`       expected: ${r.expectCategory ?? "in-scope"}, got: ${r.actualCategory ?? "in-scope"}`);
    }
    if (r.overLength) {
      const coreLength = stripTrailingCitation(r.answer!).length;
      console.log(`       ⚠ core answer is ${coreLength} chars (${r.answer!.length} total incl. citation), over the ${MAX_ANSWER_LENGTH}-char prompt limit (not a pass/fail — prompt-level only, see eval.md)`);
    }
  }
  const overLengthCount = results.filter((r) => r.overLength).length;
  if (overLengthCount > 0) {
    console.log(`\n${overLengthCount} answer(s) exceeded ${MAX_ANSWER_LENGTH} characters — the length cap is prompt-only, nothing in code enforces it (see edge-cases.md).`);
  }

  if (priorFile) {
    const prior: EvalResult[] = JSON.parse(readFileSync(join(RESULTS_DIR, priorFile), "utf-8"));
    console.log(`\nDiff against previous run (${priorFile}):`);
    let flipped = 0;
    for (const r of results) {
      const priorMatch = prior.find((p) => p.question === r.question);
      if (priorMatch && priorMatch.matchesExpectation !== r.matchesExpectation) {
        flipped++;
        console.log(`  FLIPPED: "${r.question}" (${priorMatch.matchesExpectation} -> ${r.matchesExpectation})`);
      }
    }
    if (flipped === 0) console.log("  no flips");
  }

  console.log(`\nResults written to ${outPath}`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
