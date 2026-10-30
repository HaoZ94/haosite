# Academic CV

`content.json` contains the CV text. `../scripts/build-cv.py` creates the two-page A4 PDF, using Georgia headings, Arial body text, an embedded Chinese font for 朱昊, and a restrained teal accent. The renderer checks for content extending into the footer and preserves clickable email and website links.

## Rebuild

Install Python's `reportlab` package, then run from the repository root:

```sh
python3 scripts/build-cv.py
```

The output is `output/pdf/haozhu_cv_redesigned.pdf`. The website uses `assets/haozhu_cv.pdf`; after reviewing the new PDF, copy the output there. The static build copies that asset into `dist/assets/`.

The script uses the Arial and Georgia TrueType font families and `Arial Unicode.ttf` in `/System/Library/Fonts/Supplemental`. On another platform, set `CV_FONT_DIR` to a folder containing those regular, bold, italic, and bold italic font files. Set `CV_CJK_FONT` to the path of another TrueType font containing 朱 and 昊 if `Arial Unicode.ttf` is unavailable. The Chinese glyphs are embedded in the PDF, so readers do not need the font installed. See the `register_fonts` function for filenames.

## Content provenance

The redesign preserves the supplied CV's facts, reorders presentations from newest to oldest, and retains all eight publications, including author order and the original equal-contribution markers. On 28 October 2026, the author added the Society for the Neurobiology of Language (SNL) 2026 presentation, "Intracranial mapping of speech entrainment and frequency-following responses," in Geneva, Switzerland, with Hao Zhu as presenter. The author also added TypeScript and Node.js to the technical skills and removed Web design. The content-update date reflects these revisions. Credentials, awards, and publication metadata have not been independently reverified.

The original B.Sc. affiliation/location wording (`New York University / Shanghai, New York, NY, USA`) is retained. Clarify that wording in `content.json` if it should refer specifically to NYU Shanghai. The original PDF remains available in Git history.

On 30 October 2026, the author added the Chinese name 朱昊, removed the nickname Shawn from Xiangbin Teng's name, and shortened the footer label to `Updated`. The displayed update date reflects this revision.

When updating the CV, review both rendered pages and the page count. Publication entries and other section lengths can affect the fixed two-page design. Update `content_updated` only when the factual content is updated.
