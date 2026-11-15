# Working preferences for agents

These are the maintainer's standing preferences for anyone, person or agent,
working on Cinder. `handoff.md` holds the current product and release state;
`design/brand/BRAND.md` is the identity authority.

## How to work

- Do not be a yes-man. For every idea, look for a better one or argue against
  it until the idea holds up.
- Windows 11 and Linux Mint Cinnamon change together, visually and
  functionally, unless a request names one platform. Installers for both are
  published to GitHub with every release.
- Codex and Claude may work at the same time. Leave files the other agent is
  editing alone when ownership is unclear.
- The maintainer tests on several physical devices and sends screenshots or
  photos when behaviour differs from the intended design. Treat those as the
  source of truth for what is wrong.

## Product and interface

- Interfaces are minimal, modern, clean and professional, and easy to use.
- Software stays lightweight and fast on older or modest school computers.
  Tauri is the desktop framework for that reason.
- Light mode is the default; darker themes are optional.
- Documents feel familiar (Word, Google Docs, LibreOffice) with fewer controls
  and less resource use. Spreadsheets feel like Excel or Univer.
- School workflows follow the Canvas / Google Classroom shape: teacher-created
  classrooms, enrolled students, materials, assignments, submissions, comments,
  grades and a completed-work section.
- AI changes are validated and reviewable before they are applied, and usage is
  tracked in tokens.
- Question papers follow real board expectations (Cambridge, CBSE, CISCE/ICSE),
  prefer official sources and past papers, cite sources, include suitable
  diagrams and working space, and keep marking schemes separate.

## Security and releases

- Encrypted API keys, signed updates, restricted external content and reviewed
  dependencies are expected, not optional.
- GitHub download pages stay plain: direct installer links, and release notes
  written as bullet points.
