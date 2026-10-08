// ROYAL RED skill catalog: the built-in Claude-style capability packages the
// Settings cockpit can install with one click. A skill is instructions (a
// system prompt fragment loaded on demand), declared tools (exposed to the
// agent through the unified tool layer at install time) and prompts
// (reusable template names). The instruction blocks below are the real
// workflow law for each skill: they are stored verbatim, never executed.

export interface SkillToolDecl {
  name: string // 'research_search' style snake case, skill-prefixed
  description: string
  permission: 'read-only' | 'write'
  schema: Record<string, unknown> // JSON schema of the tool args
}

export interface SkillCatalogEntry {
  skillId: string
  name: string
  description: string
  author: string
  version: string
  instructions: string // 300+ chars each: a real step-by-step workflow
  tools: SkillToolDecl[]
  prompts: string[] // prompt template names
}

export const SKILL_CATALOG: SkillCatalogEntry[] = [
  {
    skillId: 'web-research',
    name: 'Web Research',
    description:
      'Structured research workflow with source verification: decompose the question, search, open primary sources, cross-check claims, and report findings with citations and a confidence note.',
    author: 'royal-red',
    version: '1.0.0',
    instructions: `Workflow:
1. Decompose the question into 2 to 6 sub-questions that can each be answered by a checkable fact or a bounded judgment.
2. Search per sub-question. Reformulate with narrower terms when results are junk instead of accepting the first page.
3. Open primary sources and read them. Never cite an abstract or a headline of a page you did not open. Prefer primary sources (papers, filings, standards, official docs) over aggregators and press coverage.
4. For every load-bearing claim, cross-check against at least two independent sources. Independent means a different owner and origin, not two outlets republishing the same wire copy.
5. Track publication dates. Reject or downweight claims older than the question needs, and prefer the newest authoritative source over the oldest echo.
6. Write findings as a numbered list. Each finding carries: the claim, a citation [n] into the source list, and a status label: verified (2+ independent sources), single-source, or conflicting (sources disagree, say how).
7. Close with a confidence note: what is solid, what is single-source, what could not be verified at all, and what the honest next search would be.

Quality bars: paywalls and 404s are reported, not silently skipped. A claim you cannot source is either labeled or dropped. Failure handling: if sources conflict irreconcilably, present both positions with their sources instead of averaging them.`,
    tools: [
      {
        name: 'research_search',
        description:
          'Run a web search and return ranked results with titles, URLs, snippets and publication dates when the engine provides them.',
        permission: 'read-only',
        schema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'the search query' },
            max_results: { type: 'number', description: 'cap on returned results', default: 8 },
            recency_days: {
              type: 'number',
              description: 'only return sources published within this many days',
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'research_open_source',
        description:
          'Fetch a source page and return its readable text so claims are checked against what the source actually says, not its snippet.',
        permission: 'read-only',
        schema: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'the source URL to open' },
            max_chars: { type: 'number', description: 'cap on returned text length', default: 20000 },
          },
          required: ['url'],
        },
      },
      {
        name: 'research_verify_claim',
        description:
          'Cross-check one claim against a list of source URLs and return a per-source verdict: supports, contradicts, or unrelated.',
        permission: 'read-only',
        schema: {
          type: 'object',
          properties: {
            claim: { type: 'string', description: 'the claim to verify' },
            sources: {
              type: 'array',
              items: { type: 'string' },
              description: 'at least two independent source URLs to check the claim against',
            },
          },
          required: ['claim', 'sources'],
        },
      },
    ],
    prompts: ['research.brief', 'research.citations'],
  },
  {
    skillId: 'code-review',
    name: 'Code Review',
    description:
      'Reviews code for correctness, style and security with severity-ranked findings, exact line references, concrete patches, and an honest verdict.',
    author: 'royal-red',
    version: '1.0.0',
    instructions: `Workflow:
1. Read the whole diff first for intent, then re-read each touched hunk with surrounding context. Understand what the change is trying to do before judging how it does it.
2. Run the checklist: unhandled promise rejections and swallowed errors, off-by-one and boundary conditions, unchecked external input, secrets or credentials in code, injection risk in string-built queries, N+1 queries inside loops, races on shared state, resource leaks (unclosed handles, missing cleanup).
3. List issues by severity. Critical: data loss, security hole, crash on realistic input. Major: wrong behavior, missing error path, broken contract. Minor: style, naming, duplication. Nit: preference, say so.
4. Every finding points at the exact file and line, shows the offending snippet, and states the risk in one sentence.
5. Propose a concrete patch for every critical and major finding: the actual replacement code, not "consider refactoring".
6. Finish with a verdict: approve, approve-with-comments, or request-changes, plus the single most important fix.

Quality bars: never approve on vibe. If you cannot state the risk in one sentence, it is a nit, and nits never block. Failure handling: if the diff is too large to review properly, review in passes and state which files were not covered. If the code does not compile or tests are red, that is the first finding and everything else is secondary.`,
    tools: [
      {
        name: 'code_review_scan',
        description:
          'Read a file or directory from the workspace and return its contents with line numbers so findings can reference exact lines.',
        permission: 'read-only',
        schema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'file or directory path to scan' },
            max_bytes: { type: 'number', description: 'cap on returned bytes', default: 200000 },
          },
          required: ['path'],
        },
      },
      {
        name: 'code_review_diff',
        description:
          'Return the diff between two git refs, or the staged or uncommitted changes, as the review target.',
        permission: 'read-only',
        schema: {
          type: 'object',
          properties: {
            base: { type: 'string', description: 'base ref', default: 'HEAD' },
            head: { type: 'string', description: 'head ref; omit for working tree' },
            staged: { type: 'boolean', description: 'review the staged changes only', default: false },
          },
          required: [],
        },
      },
    ],
    prompts: ['review.severity-rubric'],
  },
  {
    skillId: 'document-writing',
    name: 'Document Writing',
    description:
      'Long-form documents with citations: agreed outline, section drafts, claim to source mapping, consistent terminology, and a no-fluff editing pass.',
    author: 'royal-red',
    version: '1.0.0',
    instructions: `Workflow:
1. Write the outline first and agree it before drafting prose. Every section gets one line stating the claim it will establish.
2. Draft sections in outline order, one idea per paragraph. A paragraph that serves two ideas becomes two paragraphs.
3. Map every factual claim to a source id at write time, not in a cleanup pass. A claim you cannot map is sourced now, explicitly marked as opinion, or deleted.
4. Keep terminology consistent: pick one term per concept, keep a running glossary, and never alternate synonyms for precision words.
5. Cut fluff on the editing pass: no "it is important to note", no restating the question, no promising what the next paragraph will do. Headings describe content, not the writing process.
6. End each section with the claim it established, not a teaser.
7. Final pass: every citation resolves to a real source, terms are consistent, the length is inside budget, and the summary still matches the body.

Quality bars: sentences carry content or get cut. A number appears exactly once, in the place where it matters most. Failure handling: if a section cannot state its claim in one line, it is two sections. If the evidence does not support the planned claim, change the claim, not the evidence.`,
    tools: [
      {
        name: 'doc_outline',
        description:
          'Generate or validate the outline for a document topic: returns sections in order, each with the one-line claim it must establish.',
        permission: 'read-only',
        schema: {
          type: 'object',
          properties: {
            topic: { type: 'string', description: 'the document topic' },
            section_count: { type: 'number', description: 'target number of sections', default: 5 },
            max_words: { type: 'number', description: 'total length budget in words' },
          },
          required: ['topic'],
        },
      },
      {
        name: 'doc_check_citations',
        description:
          'Scan a draft and report every claim that lacks a mapped source, plus citation ids that resolve to nothing.',
        permission: 'read-only',
        schema: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'the draft to scan' },
            source_ids: {
              type: 'array',
              items: { type: 'string' },
              description: 'known source ids the citations may point at',
            },
          },
          required: ['text'],
        },
      },
    ],
    prompts: ['doc.skeleton', 'doc.tone-guide'],
  },
  {
    skillId: 'data-analysis',
    name: 'Data Analysis',
    description:
      'Reads CSVs and tables, profiles columns, applies a written missing-value policy, picks the right chart, and writes a findings-first report.',
    author: 'royal-red',
    version: '1.0.0',
    instructions: `Workflow:
1. Profile every column before computing anything: name, inferred type, null count, distinct values, min and max. Quote the row count.
2. State a missing-value policy in writing before analysis: which columns drop, which impute, which flag as unknown. Never silently drop rows.
3. Validate types against reality. Dates parsed as strings, ids parsed as numbers, and leading-zero postal codes are the classic traps: check them by eye on a sample.
4. Summary stats: report the median alongside the mean, look at the distribution before trusting either, and investigate outliers before deciding to keep or drop them.
5. Chart selection rules: time series to a line chart, category comparison to a bar chart, relationship between two measures to a scatter plot, distribution to a histogram. Every chart gets axis labels with units and a title that states the finding, not the variable names.
6. Report structure: findings first as numbered one-sentence claims, then the evidence (charts and tables), then method, missing-value policy, and caveats. Every filtered subset reports its row count.

Failure handling: if two findings contradict, investigate before publishing instead of averaging them away. If the data is too dirty or too sparse to answer the question, say exactly what is missing and stop rather than shipping a weak answer.`,
    tools: [
      {
        name: 'data_profile',
        description:
          'Profile a CSV or table: column names, inferred types, null counts, cardinality, and summary stats per column.',
        permission: 'read-only',
        schema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'path to the CSV or table file' },
            sample_rows: { type: 'number', description: 'rows to sample for type inference', default: 1000 },
          },
          required: ['path'],
        },
      },
      {
        name: 'data_chart',
        description:
          'Render a chart from a dataset and return the artifact: bar for category comparison, line for time series, scatter for relationships, histogram for distributions.',
        permission: 'read-only',
        schema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'path to the dataset' },
            kind: {
              type: 'string',
              enum: ['bar', 'line', 'scatter', 'histogram'],
              description: 'chart kind per the selection rules',
            },
            x: { type: 'string', description: 'x axis column' },
            y: { type: 'string', description: 'y axis column' },
            title: { type: 'string', description: 'chart title stating the finding' },
          },
          required: ['path', 'kind', 'x', 'y'],
        },
      },
      {
        name: 'data_report',
        description:
          'Write the findings-first analysis report (markdown) to the workspace: numbered findings, evidence, method and caveats.',
        permission: 'write',
        schema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'output path for the report' },
            findings: {
              type: 'array',
              items: { type: 'string' },
              description: 'numbered one-sentence findings, in importance order',
            },
            include_method: { type: 'boolean', description: 'append method and caveats section', default: true },
          },
          required: ['path', 'findings'],
        },
      },
    ],
    prompts: ['analysis.plan'],
  },
  {
    skillId: 'seo-audit',
    name: 'SEO Audit',
    description:
      'Audits a URL for SEO issues: title and meta checks, heading hierarchy, image alts, link quality, structured data and Core Web Vitals proxies, ranked by impact.',
    author: 'royal-red',
    version: '1.0.0',
    instructions: `Workflow:
1. Fetch the rendered page (HTML after client rendering when relevant), not just the raw source. Record the final URL after redirects and the HTTP status.
2. Run the checks: title present, 30 to 60 characters, unique and descriptive; meta description 70 to 160 characters; exactly one h1; heading levels never skip (h1 to h2 to h3); every image has an alt attribute (empty alt is correct for decorative images); internal links resolve and outbound links are https; canonical tag present and resolving to a 200; robots meta and og and twitter card tags sane; structured data present as JSON-LD with valid types.
3. Core Web Vitals proxies: HTML payload size, number of render-blocking scripts and stylesheets in the head, images missing width and height attributes.
4. Output a ranked issue list. Each issue carries: impact (high, medium, low), the evidence (the exact tag, header, or measurement), and the fix in one sentence. High impact first: blocked indexing, missing or duplicate titles, broken canonical.
5. Distinguish confirmed issues from suspected ones.

Failure handling: if the page blocks the fetcher or requires JavaScript you cannot run, say exactly what was not auditable and audit what was retrievable. Never report a metric you did not measure.`,
    tools: [
      {
        name: 'seo_fetch_page',
        description:
          'Fetch a page (rendered when possible) and return the HTTP status, final URL after redirects, and the HTML or readable text.',
        permission: 'read-only',
        schema: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'the URL to audit' },
            include_html: { type: 'boolean', description: 'return raw HTML instead of text', default: true },
            timeout_ms: { type: 'number', description: 'fetch timeout in milliseconds', default: 15000 },
          },
          required: ['url'],
        },
      },
      {
        name: 'seo_check_meta',
        description:
          'Extract and validate SEO metadata for a URL: title, description, canonical, robots, og and twitter tags, and JSON-LD structured data.',
        permission: 'read-only',
        schema: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'the URL to inspect' },
          },
          required: ['url'],
        },
      },
    ],
    prompts: ['audit.checklist'],
  },
  {
    skillId: 'accessibility-audit',
    name: 'Accessibility Audit',
    description:
      'Audits a URL against WCAG 2.2 AA: contrast, keyboard paths, ARIA misuse, focus order, form labels, alt text and headings, each finding tied to a success criterion number.',
    author: 'royal-red',
    version: '1.0.0',
    instructions: `Workflow:
1. Fetch the DOM and the computed styles. Audit against WCAG 2.2 AA and cite the success criterion number on every finding (for example 1.4.3 contrast, 2.4.7 focus visible, 3.3.2 labels or instructions, 4.1.2 name, role, value).
2. Contrast: check text against its actual rendered background. Minimum 4.5:1 for normal text, 3:1 for large text (18.66px bold or 24px regular). Report the measured ratio, not a hunch.
3. Keyboard: every interactive element is reachable by tab in a logical order matching the visual layout, operable without a mouse, shows a visible focus indicator, and has no keyboard trap.
4. ARIA: native HTML first. A div with role button but no tabindex and no key handling is a finding. Redundant or contradicting ARIA on native elements is a finding.
5. Forms: every control has a programmatic label (label element, aria-label, or aria-labelledby), required fields are announced, and errors are text associated with the field.
6. Content: informative images have meaningful alt text, decorative images have empty alt, and headings form a hierarchy that matches the page structure.
7. Output: ranked findings, each with the criterion number, the element (selector or snippet), the evidence, and the fix.

Failure handling: automated checks cover roughly a third of WCAG. State clearly which checks were manual, which were skipped, and never report a contrast ratio you did not compute.`,
    tools: [
      {
        name: 'a11y_fetch_dom',
        description:
          'Fetch a page and return a DOM snapshot with computed styles for the audited elements, at a chosen viewport.',
        permission: 'read-only',
        schema: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'the URL to audit' },
            include_styles: { type: 'boolean', description: 'include computed styles', default: true },
            viewport_width: { type: 'number', description: 'viewport width in px', default: 1280 },
            viewport_height: { type: 'number', description: 'viewport height in px', default: 720 },
          },
          required: ['url'],
        },
      },
      {
        name: 'a11y_check_contrast',
        description:
          'Compute WCAG contrast ratios for text over its rendered background across the page or a single selector.',
        permission: 'read-only',
        schema: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'the URL to measure' },
            selector: { type: 'string', description: 'CSS selector to limit the check', default: 'body' },
          },
          required: ['url'],
        },
      },
    ],
    prompts: ['audit.wcag-checklist'],
  },
  {
    skillId: 'brand-voice',
    name: 'Brand Voice',
    description:
      'Applies a consistent brand voice: extracts voice attributes from real samples, builds a do and do-not list, rewrites with it, and flags forced deviations.',
    author: 'royal-red',
    version: '1.0.0',
    instructions: `Workflow:
1. Extract voice attributes from the provided samples before rewriting anything: sentence length and rhythm, formality, second person or third, verb mood, humor level, jargon tolerance, punctuation habits.
2. Write the voice as a do list and a do-not list with concrete, checkable items. "Short declarative sentences, under 20 words" qualifies. "Sounds friendly" does not.
3. Rewrite with the attributes. Preserve meaning and every fact exactly. Change how things are said, never what is claimed. Do not add a claim the original did not make.
4. Keep product names, technical identifiers, legal phrases, and quoted strings untouched.
5. Flag every deviation you were forced into (a hard character limit, a fixed interface string) instead of silently breaking the voice.
6. Output: the rewrite, then a short change list saying which voice attributes were applied where, then the flagged deviations.

Failure handling: if the samples themselves disagree (a playful marketing page versus a flat error message), name the two registers, ask which one applies, or write for the dominant one and say so. If a rewrite cannot preserve the facts while honoring the voice, the facts win and the deviation is flagged.`,
    tools: [
      {
        name: 'voice_extract',
        description:
          'Extract voice attributes from sample texts: sentence rhythm, formality, grammatical person, mood, humor, and jargon tolerance.',
        permission: 'read-only',
        schema: {
          type: 'object',
          properties: {
            samples: {
              type: 'array',
              items: { type: 'string' },
              description: 'sample texts that define the voice',
            },
          },
          required: ['samples'],
        },
      },
      {
        name: 'voice_rewrite',
        description:
          'Rewrite text to match the extracted voice attributes and return the rewrite plus a change list and flagged deviations.',
        permission: 'write',
        schema: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'text to rewrite' },
            attributes: {
              type: 'array',
              items: { type: 'string' },
              description: 'voice attributes to apply, from the extracted do list',
            },
            keep_terms: {
              type: 'array',
              items: { type: 'string' },
              description: 'terms that must survive untouched',
            },
          },
          required: ['text'],
        },
      },
    ],
    prompts: ['voice.guide'],
  },
  {
    skillId: 'translation',
    name: 'Translation',
    description:
      'Translates content while preserving tone: register detection, a built glossary, locale conventions, and back-translation spot checks on load-bearing sentences.',
    author: 'royal-red',
    version: '1.0.0',
    instructions: `Workflow:
1. Detect the register first (legal, marketing, technical docs, support chat) and keep it throughout. A playful source does not become stiff, a contract does not become chatty.
2. Build the glossary before translating: domain terms, product names, recurring phrases, each with the chosen target term and, where relevant, the reason.
3. Do not translate product names, code identifiers, file paths, or strings that machines consume. Translate around them so the sentence still reads naturally.
4. Apply the locale conventions of the target locale, not the source: date and number formats, currency, name order, honorifics, quotation marks.
5. Render idioms by meaning, never word for word. If an idiom has no clean equivalent, state the meaning plainly.
6. Spot check: back-translate the three most load-bearing sentences into the source language and verify the meaning survived. Fix what drifted.
7. Deliver the translation, the glossary used, and a list of passages where meaning is approximate or the source was ambiguous.

Failure handling: when the source is ambiguous, choose the most probable reading, translate it, and flag it. Never silently drop a sentence, a caveat, or a number. If a sentence is untranslatable within the constraints, mark it and explain in one line.`,
    tools: [
      {
        name: 'translate_text',
        description:
          'Translate text into a target locale with register preservation and glossary enforcement.',
        permission: 'write',
        schema: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'source text to translate' },
            target_locale: { type: 'string', description: 'BCP 47 target locale, for example de-DE' },
            source_locale: { type: 'string', description: 'source locale; detected when omitted' },
            glossary: {
              type: 'object',
              additionalProperties: { type: 'string' },
              description: 'term to translation map enforced during rendering',
            },
          },
          required: ['text', 'target_locale'],
        },
      },
      {
        name: 'translate_glossary',
        description:
          'Extract candidate glossary terms from source text with existing or proposed translations for the target locale.',
        permission: 'read-only',
        schema: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'source text to mine for terms' },
            target_locale: { type: 'string', description: 'BCP 47 target locale' },
            max_terms: { type: 'number', description: 'cap on extracted terms', default: 25 },
          },
          required: ['text', 'target_locale'],
        },
      },
    ],
    prompts: ['translation.brief'],
  },
  {
    skillId: 'summarization',
    name: 'Summarization',
    description:
      'Summarizes long documents: structural read first, key claim extraction, length-aware compression levels, and a strict never-invent-a-quote rule.',
    author: 'royal-red',
    version: '1.0.0',
    instructions: `Workflow:
1. Structural read first: title, headings, abstract or introduction, conclusion. Decide what the document is trying to establish before compressing anything.
2. Pick the compression level from the requested length: a one-sentence abstract, a 10 percent section digest, or a full executive summary with findings and caveats. Shorter output means fewer claims at higher confidence, not the same claims chopped thinner.
3. Extract key claims as a list, each traceable to the section it came from. Keep claims that change a decision; drop filler, restatements, and examples that only illustrate an already-stated claim.
4. Quote rule: never invent a quote. A direct quote is copied verbatim from the source and attributed to the speaker or section. Paraphrase everywhere else.
5. Numbers, names, and dates in the summary must appear in the source, spelled the same way. If the source is vague, the summary says the source is vague instead of resolving it silently.
6. Structure the output: one line of context (what the document is and why it matters), then the claims in importance order, then the open risks or caveats the document itself names.

Failure handling: if the document is too long for one pass, summarize per section and merge, stating which sections were covered. If the document has no discernible structure, say so and summarize linearly.`,
    tools: [
      {
        name: 'summarize_chunked',
        description:
          'Read a long document in overlapping chunks and return per-section digests plus a merged summary at the requested level.',
        permission: 'read-only',
        schema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'path to the document' },
            target_words: { type: 'number', description: 'length budget for the merged summary', default: 250 },
            level: {
              type: 'string',
              enum: ['abstract', 'section', 'full'],
              description: 'compression level: abstract, section digest, or executive summary',
              default: 'full',
            },
          },
          required: ['path'],
        },
      },
    ],
    prompts: ['summary.levels'],
  },
  {
    skillId: 'meeting-notes',
    name: 'Meeting Notes',
    description:
      'Processes raw transcripts into structured notes: attributed decisions, action items with owners and dates, open questions and follow-ups.',
    author: 'royal-red',
    version: '1.0.0',
    instructions: `Workflow:
1. Read the whole transcript before structuring anything. Identify the speakers and how each is identified in the text.
2. Decisions: one sentence each, with what was decided, who made or drove it, and any recorded dissent. A discussion without a conclusion is not a decision: it goes to open questions.
3. Action items: owner (a real name from the transcript, never "the team"), a verb-first task, and a due date. If no date was said, write "no date given". Do not invent dates, owners, or tasks that were not spoken.
4. Open questions: raised but unresolved, each with who raised it and what would resolve it.
5. Follow-ups: items deferred to another meeting, blocked on someone absent, or waiting on a document.
6. Output sections in order: summary (three sentences: purpose, outcome, next step), decisions, action items, open questions, follow-ups.
7. Quote rule: paraphrase unless the exact wording matters (a commitment, a number, a condition), then quote verbatim.

Failure handling: inaudible or overlapping speech is marked as a gap, never guessed. If two speakers claim the same action item, record both and flag the conflict for the meeting owner.`,
    tools: [
      {
        name: 'notes_structure',
        description:
          'Write structured meeting notes (summary, decisions, action items, open questions, follow-ups) built from a transcript.',
        permission: 'write',
        schema: {
          type: 'object',
          properties: {
            transcript: { type: 'string', description: 'the raw transcript text' },
            title: { type: 'string', description: 'meeting title for the notes header' },
            attendees: {
              type: 'array',
              items: { type: 'string' },
              description: 'speaker names as identified in the transcript',
            },
          },
          required: ['transcript'],
        },
      },
      {
        name: 'notes_extract_actions',
        description:
          'Extract candidate action items from a transcript with owner, verb-first task, and any spoken due date.',
        permission: 'read-only',
        schema: {
          type: 'object',
          properties: {
            transcript: { type: 'string', description: 'the raw transcript text' },
          },
          required: ['transcript'],
        },
      },
    ],
    prompts: ['notes.template'],
  },
]
