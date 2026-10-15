# Word files from other projects' test suites

Real-world .docx files that `server/src/import/corpus.test.ts` imports, stores, reopens, saves as
steps, exports and imports again. Each file is unchanged from its source. The licence texts are in
[LICENSES/](LICENSES/).

| Folder | Source | Licence |
| --- | --- | --- |
| `mammoth/` | [mammoth.js](https://github.com/mwilliamson/mammoth.js), `test/test-data/` | BSD-2-Clause, © 2013 Michael Williamson ([LICENSES/mammoth-BSD-2-Clause.txt](LICENSES/mammoth-BSD-2-Clause.txt)) |
| `python-docx/` | [python-docx](https://github.com/python-openxml/python-docx), `features/steps/test_files/` | MIT, © 2013 Steve Canny ([LICENSES/python-docx-MIT.txt](LICENSES/python-docx-MIT.txt)) |
| `poi/` | [Apache POI](https://github.com/apache/poi), `test-data/document/` | Apache-2.0, © The Apache Software Foundation ([LICENSES/apache-poi-Apache-2.0.txt](LICENSES/apache-poi-Apache-2.0.txt), [NOTICE](LICENSES/apache-poi-NOTICE.txt)) |
| `libreoffice/` | [LibreOffice core](https://github.com/LibreOffice/core), `sw/qa/extras/ooxmlexport/data/` and `ooxmlimport/data/` | MPL-2.0 ([LICENSES/libreoffice-MPL-2.0.txt](LICENSES/libreoffice-MPL-2.0.txt)); the files are used unmodified |

## Files and what they exercise

| File | Content |
| --- | --- |
| `mammoth/comments.docx` | A comment with a range and one with only a reference mark |
| `mammoth/endnotes.docx` | Endnotes (imported as footnotes) |
| `mammoth/external-picture.docx` | A picture linked to an outside file (left out) |
| `mammoth/footnotes.docx` | Footnotes |
| `mammoth/simple-list.docx` | A nested bulleted list |
| `mammoth/strict-format.docx` | A file in the Strict Open XML namespaces |
| `mammoth/tables.docx` | Tables |
| `mammoth/text-box.docx` | A text box (its text is kept) |
| `mammoth/tiny-picture.docx` | An inline PNG |
| `python-docx/doc-odd-even-hdrs.docx` | Odd and even page headers |
| `python-docx/par-hyperlinks.docx` | Hyperlinks |
| `python-docx/sct-first-page-hdrftr.docx` | A different first page header and footer |
| `python-docx/tab-stops.docx` | Tab stops of every kind |
| `python-docx/tbl-having-tables.docx` | Several tables |
| `poi/Bug54849.docx` | Content controls around paragraphs, runs, rows and cells; endnotes |
| `poi/ComplexNumberedLists.docx` | Multi-level numbering |
| `poi/FieldCodes.docx` | Fields of many kinds |
| `poi/IllustrativeCases.docx` | A long report with tables and line breaks |
| `poi/MultipleBodyBug.docx` | A main part with three `w:body` elements |
| `poi/NumberingWOverrides.docx` | Numbering with level overrides |
| `poi/WithGIF.docx` | A floating GIF |
| `poi/checkboxes.docx` | Check box content controls, even page headers |
| `poi/deep-table-cell.docx` | Tables nested 5000 deep (a fuzzing case) |
| `poi/delins.docx` | Tracked insertions and deletions |
| `poi/drawing.docx` | Floating pictures, charts, an embedded object, Cyrillic text |
| `poi/rtl.docx` | Right-to-left Arabic paragraphs |
| `poi/shapes-with-text.docx` | Shapes and a group with text in them |
| `poi/smarttag-snippet.docx` | Smart tags |
| `poi/table_footnotes.docx` | Footnotes in table cells |
| `libreoffice/CommentDone.docx` | Resolved and open comments |
| `libreoffice/CommentReply.docx` | A comment with a reply |
| `libreoffice/anchor-position.docx` | Anchored drawing positions |
| `libreoffice/floating-tables-anchor.docx` | Floating tables |
| `libreoffice/math-matrix.docx`, `math-nary.docx`, `math-rad.docx` | Office Math equations (kept as linear text) |
| `libreoffice/multi-column-separator-with-line.docx` | Columns with a separator line |
| `libreoffice/multi-page-toc.docx` | A table of contents field over several pages |
| `libreoffice/redline-range-comment.docx` | A comment over tracked changes |
| `libreoffice/tdf87533_bidi.docx` | Bidirectional paragraphs |

`DOCX_CORPUS_DIR=<folder> npx vitest run server/src/import/corpus.test.ts` runs the same checks
over every .docx file in a folder (and its subfolders), for larger collections that are not kept
here.
