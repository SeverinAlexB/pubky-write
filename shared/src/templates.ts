// The built-in templates of "Start a new document". Each is document content in the shared
// schema, using the editor's paragraph styles, so a new document from a template can be edited
// like any other. The document list renders their thumbnails from the same content.
import type { JSONContent } from "@tiptap/core";

export type DocumentTemplate = {
  id: string;
  name: string;
  /** The second line under the tile. */
  subtitle: string;
  /** The heading the expanded template gallery lists it under. */
  category: "Personal" | "Work";
  content: JSONContent;
};

type Mark = { type: string; attrs?: Record<string, unknown> };

const text = (value: string, ...marks: Mark[]): JSONContent => ({ type: "text", text: value, ...(marks.length > 0 && { marks }) });
const bold: Mark = { type: "bold" };
const italic: Mark = { type: "italic" };
const grey: Mark = { type: "textStyle", attrs: { color: "#666666" } };

function paragraph(...content: (JSONContent | string)[]): JSONContent {
  const inline = content.map((part) => (typeof part === "string" ? text(part) : part));
  return { type: "paragraph", ...(inline.length > 0 && { content: inline }) };
}

const styled = (style: "title" | "subtitle", value: string): JSONContent => ({
  type: "paragraph",
  attrs: { paragraphStyle: style },
  content: [text(value)],
});
const heading = (level: number, value: string): JSONContent => ({ type: "heading", attrs: { level }, content: [text(value)] });
const right = (...content: (JSONContent | string)[]): JSONContent => ({ ...paragraph(...content), attrs: { textAlign: "right" } });

function bulletList(...items: (JSONContent | string)[][]): JSONContent {
  return { type: "bulletList", content: items.map((item) => ({ type: "listItem", content: [paragraph(...item)] })) };
}

function orderedList(...items: string[]): JSONContent {
  return { type: "orderedList", attrs: { start: 1 }, content: items.map((item) => ({ type: "listItem", content: [paragraph(item)] })) };
}

function table(header: string[], ...rows: string[][]): JSONContent {
  const cell = (type: string, value: string): JSONContent => ({ type, content: [paragraph(...(value ? [value] : []))] });
  return {
    type: "table",
    content: [
      { type: "tableRow", content: header.map((value) => cell("tableHeader", value)) },
      ...rows.map((row) => ({ type: "tableRow", content: row.map((value) => cell("tableCell", value)) })),
    ],
  };
}

const doc = (...content: JSONContent[]): JSONContent => ({ type: "doc", content });

export const documentTemplates: DocumentTemplate[] = [
  {
    id: "letter",
    name: "Letter",
    subtitle: "Formal letter",
    category: "Personal",
    content: doc(
      paragraph(text("Your Name", bold)),
      paragraph(text("123 Your Street", grey)),
      paragraph(text("Your City, AB 12345", grey)),
      paragraph(),
      paragraph("Date"),
      paragraph(),
      paragraph("Recipient Name"),
      paragraph("Company"),
      paragraph("456 Their Street"),
      paragraph("Their City, AB 67890"),
      paragraph(),
      paragraph("Dear Recipient Name,"),
      paragraph(),
      paragraph(
        "Thank you for taking the time to read this letter. Use the first paragraph to say why you are writing and what you would like the reader to do.",
      ),
      paragraph(),
      paragraph(
        "Use the following paragraphs to give the details: what happened, what you have already tried and what you propose. Keep each paragraph to one idea so the letter is easy to follow.",
      ),
      paragraph(),
      paragraph("Close by thanking the reader and saying how they can reach you."),
      paragraph(),
      paragraph("Sincerely,"),
      paragraph(),
      paragraph(text("Your Name", bold)),
    ),
  },
  {
    id: "resume",
    name: "Resume",
    subtitle: "Classic",
    category: "Personal",
    content: doc(
      styled("title", "Your Name"),
      paragraph(text("123 Your Street, Your City · (555) 123-4567 · you@example.com", grey)),
      heading(1, "Experience"),
      heading(2, "Company Name, Location — Job Title"),
      paragraph(text("Month 2023 – Present", grey)),
      bulletList(
        ["Summarise your responsibilities and what you achieved in one line each."],
        ["Lead with results: ", text("increased", italic), " sales by 20% in the first year."],
        ["Mention the tools and methods you used."],
      ),
      heading(2, "Company Name, Location — Job Title"),
      paragraph(text("Month 2019 – Month 2023", grey)),
      bulletList(["Describe a project you are proud of."], ["Describe a skill you developed."]),
      heading(1, "Education"),
      heading(2, "School Name, Location — Degree"),
      paragraph(text("Month 2015 – Month 2019", grey)),
      paragraph("Relevant coursework, awards or a thesis title."),
      heading(1, "Skills"),
      bulletList(["Skill one"], ["Skill two"], ["Skill three"]),
      heading(1, "Languages"),
      paragraph("English (native), German (fluent)"),
    ),
  },
  {
    id: "project-proposal",
    name: "Project proposal",
    subtitle: "Overview and milestones",
    category: "Work",
    content: doc(
      styled("title", "Project Name"),
      styled("subtitle", "Project proposal · Date"),
      heading(1, "Overview"),
      paragraph(
        "Describe the project in two or three sentences: the problem it solves, who it is for and what will be different when it is done.",
      ),
      heading(1, "Goals"),
      orderedList("The first goal, stated so you can tell when it is met.", "The second goal.", "The third goal."),
      heading(1, "Scope"),
      heading(2, "In scope"),
      bulletList(["What the project will deliver."], ["Which teams and systems it involves."]),
      heading(2, "Out of scope"),
      bulletList(["What the project will not do, to set expectations."]),
      heading(1, "Milestones"),
      table(
        ["Milestone", "Owner", "Date"],
        ["Kick-off", "Name", "1 November"],
        ["First prototype", "Name", "15 December"],
        ["Launch", "Name", "1 March"],
      ),
      heading(1, "Risks"),
      paragraph("List what could delay the project and how you plan to reduce each risk."),
    ),
  },
  {
    id: "report",
    name: "Report",
    subtitle: "Sections and summary",
    category: "Work",
    content: doc(
      styled("title", "Report Title"),
      styled("subtitle", "Prepared by Your Name · Date"),
      heading(1, "Summary"),
      paragraph(
        "State the main findings in a short paragraph. Readers who stop here should know what you found and what you recommend.",
      ),
      heading(1, "Background"),
      paragraph("Explain why this report was written and what question it answers."),
      heading(1, "Findings"),
      heading(2, "First finding"),
      paragraph("Describe the finding and the evidence for it."),
      table(["Measure", "Last year", "This year"], ["Revenue", "1.2 M", "1.5 M"], ["Customers", "840", "1,020"]),
      heading(2, "Second finding"),
      paragraph("Describe the finding and the evidence for it."),
      heading(1, "Recommendations"),
      bulletList(["The first recommendation."], ["The second recommendation."]),
      heading(1, "Next steps"),
      right(text("Your Name", italic)),
    ),
  },
];

export function findTemplate(id: string): DocumentTemplate | undefined {
  return documentTemplates.find((template) => template.id === id);
}
