"""
Generates the small synthetic PDFs used by tests/extract-emr.test.js.

Everything here is invented. No real patient, no real record. Run again only if a
fixture needs to change:   python3 tests/fixtures/make_fixtures.py
Requires: pip install reportlab
"""
from pathlib import Path
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

OUT = Path(__file__).parent

HEADER = "SYNTHETIC TEST RECORD - NOT A REAL PATIENT"

FIXTURES = {
    "improving.pdf": [
        HEADER,
        "12/03/26 Admitted with severe malaria",
        "Ass: severe malaria with hypertension",
        "Plan: IV artesunate 120mg, monitor vitals",
        "Patient improving, afebrile and tolerating oral feeds",
        "Responding well to treatment, alert and ambulating",
        "BP: 120/80 pulse: 80 temp: 36.8",
    ],
    "deteriorating.pdf": [
        HEADER,
        "12/03/26 Admitted with sepsis",
        "Ass: sepsis, deteriorating",
        "Patient deteriorating and now unresponsive",
        "Condition worsening, escalated to the physician",
        "BP: 80/50 pulse: 130 temp: 39.5",
    ],
    "surgery.pdf": [
        HEADER,
        "Laparotomy done for perforated appendicitis",
        "Post operative day 2",
        "Patient stable, tolerating oral feeds, afebrile",
    ],
    "blank.pdf": [],  # a page with no text at all, like a picture-only export
}

for name, lines in FIXTURES.items():
    c = canvas.Canvas(str(OUT / name), pagesize=A4, invariant=1)
    # Padding in the metadata (invisible, not page text). The PDF reader the server uses
    # misreads files under about 4 KB (probably because of how Node pools small buffers). Real
    # folios are always far larger, so the fixtures are padded to behave like them.
    c.setSubject("synthetic test fixture " * 400)
    y = 800
    for line in lines:
        c.drawString(40, y, line)
        y -= 16
    c.showPage()
    c.save()
    print("wrote", name)
