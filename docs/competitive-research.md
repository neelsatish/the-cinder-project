# Cinder — Competitive Research

How Cinder Matchbox compares to Google Classroom, Canvas, and the India / Bengaluru edtech landscape — and where it is genuinely better, not just different.

*Pulled from the working Google Doc, [Cinder — Competitive Research](https://docs.google.com/document/d/1jN0wT-27E6OUCNJzXPmo9OYvuLMtLUg1znfiM4v0Kus/edit), on 2026-08-29. Compiled for internal use — figures on connectivity and pricing should be re-verified before use in any external-facing pitch, as sourced from a live web search and subject to change.*

## 1. Executive summary

Cinder Matchbox is a classroom tool built for a room the mainstream LMS market does not design for: no reliable internet, old donated hardware, and a teacher who needs the software to work today, not after an IT ticket. Google Classroom and Canvas are both built on the opposite assumption — a live internet connection and a modern device are the floor, not the ceiling. India's own government platforms (DIKSHA, PM eVidya) solve a different problem (distributing pre-made content), not classroom-run teaching. Cinder's edge is structural, not cosmetic: it is offline by design, not "offline mode" bolted onto a cloud product.

## 2. Why this matters specifically in Bengaluru / Karnataka

* Karnataka — India's IT hub — has internet connectivity in only 50.7% of schools, per a 2026 NITI Aayog report. The state most associated with the tech industry is below the national average for classroom connectivity.
* Nationally, government-school internet access rose to 63.1% in 2025-26 (up from 46.2% the year before) — real progress, but a third of schools are still offline, and progress is recent and uneven.
* Connectivity numbers overstate real usage: in many remote government schools, functional computer usage stays below 20% even where connections exist, due to power outages and lack of maintenance. A connection on paper is not a working classroom.
* Government response (2026-2030 phased rollout) targets solar-powered computers and basic broadband for 200,000 schools still lacking facilities — an admission that the gap is large and multi-year, not a rounding error.
* Net effect for Bengaluru specifically: a huge concentration of schools sit inside India's most "wired" city while running on the same unreliable infrastructure as far more rural districts. Software that assumes Bengaluru-office levels of connectivity will fail in a large share of Bengaluru's own schools.

## 3. Competitive landscape at a glance

| Product | Needs internet to run? | Hardware floor | Cost model | Where student/school data lives | What it actually is |
|---------|----------------------|----------------|-----------|-------------------------------|-------------------|
| Cinder Matchbox | No — runs entirely over the local network (LAN). Internet never required. | Old office PCs, ~15 years old, 1024×768 panels supported. | No subscription, no per-student fee, no cloud bill. | Stays on the teacher's machine in the room. Never leaves the building. | A teacher-run classroom tool: lessons, documents, exercises, offline sync between one teacher machine and student machines. |
| Google Classroom | Yes, for essentially all core functions. Some mobile-app viewing works offline; saving/submitting does not. | Modern browser or Android/iOS device; a live Google Workspace account. | Free for the "Classroom" shell, but sits inside a paid Workspace for Education tier at scale. | Google's cloud, under Google's Workspace for Education terms. | Cloud assignment/grading layer bolted onto Google Drive, Docs, and Meet. |
| Canvas LMS (Instructure) | Yes. Built and priced as a hosted, always-online institutional LMS. | Modern browser; institutional IT support to deploy and maintain. | Undisclosed list price, negotiated per institution. Reported range ~$5–$30 per student per year; small institutions often pay $25,000–$75,000/year. Free-for-Teacher was pulled after a 2026 security incident. | Instructure's cloud (or self-hosted open-source Canvas, which requires real server/DevOps capacity most under-resourced schools don't have). | Full institutional LMS: grading, integrations, analytics — built for universities and large, well-resourced K-12 districts. |
| Kolibri (Learning Equality) | No — genuinely offline-first, closest architectural peer to Cinder. | Works on low-end hardware; typically deployed via a local server (e.g. Raspberry Pi) serving multiple devices. | Free, open source, nonprofit-backed. | Local to the deployment. | A pre-built, curated content library (video, exercises) for self-paced learning — not a tool for a teacher to run and author their own live classroom. |
| DIKSHA / PM eVidya (Govt. of India) | Partial — content can be downloaded and stored for offline use, but discovery/QR-linking and updates assume connectivity. | Smartphone-first (QR scanning); works on basic Android devices. | Free, government-run. | Government platform. | National digital-content distribution layer tied to textbook QR codes — a content channel, not classroom software a teacher operates. |
| India tutoring/edtech apps (Vedantu, Classplus, BYJU'S-style, BasicFirst, etc.) | Yes, near-universally — these are built around live or recorded video delivered over the internet, including "low-bandwidth" streaming. | Smartphone or PC with a working data connection. | Subscription / per-course fees to families, or B2B SaaS fees to coaching centres. | Vendor's cloud. | Supplementary tutoring and test-prep, largely aimed at individual students/parents paying for extra coaching — not classroom infrastructure for a school. |

## 4. Cinder vs. Google Classroom

* Internet dependency is architectural, not incidental. Google's own documentation is explicit: "there is no native version of Google's suite of applications — everything is online." Classroom's offline mode lets a student view cached material on a mobile app; it cannot save or submit without a connection. Cinder was designed the other way: the LAN between teacher and student machines is the whole system, so there is no "offline mode" to fall back to because there was never an "online mode" to begin with.
* Account and identity. Classroom requires a Google Workspace for Education account per student — an administrative and data-governance step many under-resourced Indian schools cannot practically run (device sharing, no consistent student email, connectivity to even set accounts up). Cinder has no account system tied to an external identity provider; the classroom is self-contained.
* Where the data lives. Classroom data lives in Google's cloud under Workspace for Education terms — reasonable for a well-connected, well-governed school, but a real question for schools with no consistent IT oversight. Cinder's design keeps everything on the teacher's own machine in the room.
* Where Google is genuinely ahead: breadth of integration (Docs, Meet, Drive, Gmail), a huge existing user base and familiarity, and continuous investment in mobile-first, low-bandwidth features for exactly the connectivity gap described in §2 — Cinder should not claim parity on ecosystem breadth, only on the specific "no internet, old hardware" case Google does not solve.

## 5. Cinder vs. Canvas LMS

* Cost floor. Even at the low end of reported small-institution pricing (~$25,000–$75,000/year, or roughly $5–$30 per student/year), Canvas assumes a budget most under-resourced government or low-fee schools in India simply do not have. Cinder has no per-student or per-year fee.
* Deployment complexity. Canvas is built for institutions with IT staff to manage integrations, single sign-on, and a hosted or self-hosted deployment. Cinder targets a teacher installing an app on a machine that already exists in the room, with no IT department required.
* The open-source escape hatch isn't free in practice. Instructure's open-source Canvas removes the licence fee but still requires real server administration — a gap that maps directly onto the "50% of schools connected, but usage collapses due to maintenance" problem described in §2. A self-hosted LMS a school cannot maintain is not meaningfully more available than a paid one.
* Where Canvas is genuinely ahead: grading depth, analytics, third-party tool integrations (LTI), and scale — it is a mature product for universities and large, resourced K-12 districts. Cinder is not competing for that segment; it is covering the segment Canvas's cost and infrastructure assumptions exclude entirely.

## 6. Cinder vs. the India-specific field

* Kolibri is the closest real peer — genuinely offline-first, free, and already proven in Indian rural deployments (with the Nalanda Project and its predecessor KA Lite, reaching 5M+ people). The difference in kind: Kolibri ships a pre-built content library for self-paced study. It is not built for a teacher to author and run their own live lesson, assignment, or classroom workflow — that's Cinder's job. The two are arguably complementary rather than head-to-head: Kolibri as the library, Cinder as the classroom.
* DIKSHA / PM eVidya solve content distribution, not classroom software. QR-coded textbook content and offline downloads are a genuinely useful national layer, but the interaction model is a student or teacher pulling pre-made material, not a teacher running lessons, exercises and grading day-to-day in the room the way Cinder does.
* The Bengaluru tutoring/edtech scene (Vedantu, Classplus, BYJU'S-adjacent players, BasicFirst, etc.) is not really a competitor — it's a different market. These are consumer-paid or B2B-SaaS tutoring products built around live or recorded video, sold to individual families or coaching centres chasing exam results. None are designed to run a school's actual classroom on hardware with no reliable internet; several explicitly brand their "offline" push as physical tuition centres (e.g. Classplus's offline B.Tech college), not offline software.
* Net position: Cinder doesn't have a direct, like-for-like competitor in the "teacher-run, internet-free, old-hardware classroom tool" category in the Bengaluru/Karnataka market. The closest adjacent players (Kolibri, DIKSHA) solve a narrower content-delivery problem; the well-funded edtech names solve a fundamentally different problem (paid tutoring over the internet).

## 7. Where Cinder is honestly behind — open gaps

In keeping with the product's own voice ("state limits plainly and early"), the honest gaps against these competitors:

* No cloud backup or multi-school sync yet — a teacher's machine is a single point of failure Google/Canvas don't have.
* No existing content library — unlike Kolibri or DIKSHA, Cinder ships no pre-made curriculum; a teacher must build or bring their own material.
* No brand recognition or existing install base to draw on, unlike Google Classroom's near-default status in many schools already.
* No third-party integrations (LTI, grading interop) that large, resourced schools moving off Canvas would expect.

## 8. Sources

* Use Google Classroom offline — Classroom Help
* Learning on the go with Classroom on Android — Google
* Top 10 Limitations Of Google Workspace For Education
* Canvas LMS Pricing: How Much Does Canvas Cost in 2026?
* Canvas LMS Pricing: An In-depth Breakdown
* Only 50.7% of schools in Karnataka have internet connectivity — Deccan Herald
* Government schools narrow digital divide — UDISE+ report
* Karnataka Education Budget 2026-27 highlights — Careers360
* About Kolibri — Learning Equality
* Kolibri Learning Platform — GitHub
* PM e-Vidya — DIKSHA
* DIKSHA — NCERT / CIET
* K-12 EdTech in Bengaluru, India — Tracxn
* Classplus launches offline B.Tech college in Bengaluru — BW Education
