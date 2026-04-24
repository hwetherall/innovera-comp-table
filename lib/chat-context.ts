type JsonRecord = Record<string, unknown>;
type ChatMessage = {
  role: string;
  content: string;
};

const MAX_EXTRA_CHARS = 22000;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function truncate(text: string, maxLength: number) {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 16).trimEnd()}\n...[truncated]`;
}

function bulletList(items: unknown[], maxItems = 8) {
  return items
    .slice(0, maxItems)
    .map((item) => `- ${typeof item === "string" ? item : JSON.stringify(item)}`)
    .join("\n");
}

function getTerms(text: string) {
  return Array.from(
    new Set(
      text
        .toLowerCase()
        .replace(/[^a-z0-9&.\s-]/g, " ")
        .split(/\s+/)
        .filter((term) => term.length >= 3),
    ),
  );
}

function scoreText(text: string, terms: string[]) {
  const lower = text.toLowerCase();
  return terms.reduce((score, term) => score + (lower.includes(term) ? 1 : 0), 0);
}

export function buildCondensedContext(report: unknown) {
  const data = asRecord(report);
  const executive = asRecord(data.executive);
  const analyses = asRecord(data.analyses);
  const parameterDefinitions = asRecord(data.parameter_definitions);

  const companies = asArray(data.companies).map(String);
  const parameters = asArray(data.parameters).map(String);

  const parameterLines = parameters
    .map((id) => {
      const definition = asRecord(parameterDefinitions[id]);
      const name = asString(definition.name) || id;
      const category = asString(definition.category);
      return `- ${id}: ${name}${category ? ` (${category})` : ""}`;
    })
    .join("\n");

  const analysisLines = Object.values(analyses)
    .map((rawAnalysis) => {
      const analysis = asRecord(rawAnalysis);
      const name = asString(analysis.parameter_name) || asString(analysis.parameter_id);
      const headline = asString(analysis.headline);
      const summary = asString(analysis.executive_summary);
      return `## ${name}\nHeadline: ${headline}\nSummary: ${summary}`;
    })
    .join("\n\n");

  const nextSteps = asRecord(executive.next_steps);
  const nextStepLines = Object.entries(nextSteps)
    .map(([category, value]) => `### ${category}\n${bulletList(asArray(value), 4)}`)
    .join("\n\n");

  return truncate(
    [
      `Run ID: ${asString(data.run_id)}`,
      `Timestamp: ${asString(data.timestamp)}`,
      `Companies (${companies.length}): ${companies.join(", ")}`,
      `Parameters:\n${parameterLines}`,
      `Executive brief:\n${asString(executive.brief)}`,
      `Key themes:\n${bulletList(asArray(executive.key_themes), 10)}`,
      `Trends:\n${bulletList(asArray(executive.trends), 10)}`,
      `White-space opportunities:\n${bulletList(asArray(executive.white_space_opportunities), 10)}`,
      nextStepLines ? `Next steps:\n${nextStepLines}` : "",
      `Parameter analyses:\n${analysisLines}`,
    ]
      .filter(Boolean)
      .join("\n\n---\n\n"),
    36000,
  );
}

function compactRanking(rawRanking: unknown) {
  const ranking = asRecord(rawRanking);
  return {
    rank: ranking.rank,
    company: ranking.company,
    label: ranking.label,
    rationale: ranking.rationale,
  };
}

function compactIntelligence(rawEntry: unknown) {
  const entry = asRecord(rawEntry);
  const facts = asArray(entry.facts)
    .slice(0, 10)
    .map((fact) => {
      const record = asRecord(fact);
      return {
        claim: record.claim,
        source_id: record.source_id,
        confidence: record.confidence,
      };
    });

  const sources = asArray(entry.sources)
    .slice(0, 6)
    .map((source) => {
      const record = asRecord(source);
      return {
        id: record.id,
        title: record.title,
        url: record.url,
      };
    });

  return {
    parameter_name: entry.parameter_name,
    facts,
    synthesis: entry.synthesis ?? entry.analysis ?? entry.summary,
    sources,
  };
}

export function getRelevantSections(report: unknown, message: string, history: ChatMessage[] = []) {
  const data = asRecord(report);
  const analyses = asRecord(data.analyses);
  const intelligence = asRecord(data.intelligence);
  const companies = asArray(data.companies).map(String);
  const parameters = asArray(data.parameters).map(String);
  const recentHistory = history
    .slice(-4)
    .map((item) => item.content)
    .join("\n");
  const terms = getTerms(`${recentHistory}\n${message}`);

  const matchedCompanies = companies
    .map((company) => ({
      company,
      score: scoreText(company, terms) + scoreText(JSON.stringify(intelligence[company] ?? ""), terms),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map((item) => item.company);

  const matchedAnalyses = Object.entries(analyses)
    .map(([parameterId, rawAnalysis]) => {
      const analysis = asRecord(rawAnalysis);
      const searchable = JSON.stringify({
        parameterId,
        parameter_name: analysis.parameter_name,
        headline: analysis.headline,
        executive_summary: analysis.executive_summary,
        rankings: analysis.rankings,
      });
      return { parameterId, analysis, score: scoreText(searchable, terms) };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);

  const analysisContext = matchedAnalyses
    .map(({ parameterId, analysis }) => {
      const rankings = asArray(analysis.rankings).slice(0, 12).map(compactRanking);
      return `## Analysis: ${asString(analysis.parameter_name) || parameterId}
Headline: ${asString(analysis.headline)}
Summary: ${asString(analysis.executive_summary)}
Rankings: ${JSON.stringify(rankings)}`;
    })
    .join("\n\n");

  const intelligenceContext = matchedCompanies
    .map((company) => {
      const companyData = asRecord(intelligence[company]);
      const parameterEntries = parameters
        .map((parameterId) => {
          const entry = companyData[parameterId];
          if (!entry) {
            return "";
          }
          const score = scoreText(JSON.stringify(entry), terms) + scoreText(parameterId, terms);
          return score > 0 ? `### ${parameterId}\n${JSON.stringify(compactIntelligence(entry))}` : "";
        })
        .filter(Boolean)
        .slice(0, 4)
        .join("\n\n");

      return parameterEntries ? `## Company: ${company}\n${parameterEntries}` : "";
    })
    .filter(Boolean)
    .join("\n\n");

  const fallbackContext =
    matchedAnalyses.length === 0 && matchedCompanies.length === 0
      ? "No targeted deep sections matched. Use the condensed context and say when the report does not contain enough detail."
      : "";

  return truncate([analysisContext, intelligenceContext, fallbackContext].filter(Boolean).join("\n\n---\n\n"), MAX_EXTRA_CHARS);
}
