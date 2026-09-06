# Nemotron Voice Agent architecture manual build

This directory contains the editable/reproducible generator and the retained
Microsoft Word handoff manual for the recorded August 2026 architecture
snapshot. The durable operational source is
`../../skills/operate-nemotron-voice-agent/SKILL.md`; the manual is not a
live-deployment status report.

## Outputs

- `../Nemotron_Voice_Agent_Current_Architecture_Manual.docx`
- `assets/01_end_to_end_overview.png` through
  `assets/09_failure_isolation.png`
- `assets/nvidia-logo-trim.png` and `assets/nvidia-nim-icon.png`, copied from the
  repository-owned `astra_client/public/` assets at build time
- `build-report.json`
- `Nemotron_Voice_Agent_Current_Architecture_Manual.pdf` only when
  LibreOffice/soffice is installed

## Rebuild

The build requires Python 3.11+ with `python-docx` and `Pillow`. Keep dependency
environments outside the repository:

```bash
python3 -m venv /tmp/nva-architecture-docx-venv
/tmp/nva-architecture-docx-venv/bin/pip install python-docx Pillow
/tmp/nva-architecture-docx-venv/bin/python \
  docs/architecture-manual/build_manual.py
```

Open the generated DOCX in Microsoft Word and choose **Update Field → Update
entire table** if the clickable table of contents does not update automatically.
Word also resolves the exact page count and page-number fields during layout.

## Editing diagrams

The diagram definitions are plain Pillow drawing code in `build_manual.py` under
“Diagram primitives.” Each figure has its own function and produces a 2800×1575
PNG at 220 DPI. Edit a figure function and rerun the build; do not hand-edit the
generated PNG because the next build replaces it.

The visual system deliberately uses a white background, pale green blocks, dark
charcoal type, and repository-owned NVIDIA brand assets. Other platforms are
represented by clean labelled icon badges rather than copied third-party logos.

## Safety and source of truth

- The operations skill is authoritative for durable agent operating knowledge.
- The Markdown architecture snapshot remains the source for this historical manual.
- The manual includes secret **names and boundaries only**. Never add values.
- `build-report.json` records the original snapshot SHA-256 and build validation.
- Rebuild only when intentionally publishing a new dated architecture manual.
