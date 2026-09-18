# Cinder Forge Studio — product and implementation plan

Date: 31 August 2026. Status: proposed; not implemented.

## 1. Decision

**Studio is where a learner turns their material into something they can practise.** It is not another dashboard, a general-purpose chatbot, or a model-training console.

Build a complete quiz-and-flashcard workspace first: create, edit, save, practise, and revisit. Add review-first AI assistance and an optional bridge from the existing vocabulary camera. Keep worksheets and PDF ingestion as a subsequent release.

The test of the design: someone can open Studio, choose a note or start blank, make a useful activity, and practise it without understanding prompts, models, or file formats.

### Product boundaries

| Surface | Responsibility |
| --- | --- |
| Home | Resume real work; show actual activity and completed sessions. |
| Library | Original notes and, eventually, imported source files. |
| Studio | Author and practise quizzes and flashcard decks derived from those sources. |
| Atlas | Organise relationships between topics and saved material. |
| Camera, through the existing top-bar icon | Recognise household objects and speak English vocabulary; explicitly send selected words to Studio. |

Do not replace the four navigation destinations or move the camera into a mandatory Studio workflow. Forge stays separate from Matchbox: no classroom login, Teacher service, or school database requirement.

## 2. Context recovered from Claude, checked against files

I read the recent local Claude conversation, including the 31 August camera integration and vocabulary-evaluation discussion, then inspected the corresponding files. This is a snapshot of work in progress, not a claim that training or testing has finished.

- The actual learning goal is **object → English word → spoken pronunciation**. Reported failures were remote/phone and pen/toothbrush confusion, repeated announcements, lag, and subsequently silent cached audio.
- The current external service uses `yoloe-11l-seg.pt`, text prompts and cached Soprano speech. `live.py` currently lists **196 vocabulary entries**. More entries do not establish recognition accuracy.
- Forge talks to a separate service at `http://127.0.0.1:8756`. The installer does not contain that Python environment and model stack. Speech presently serves cached vocabulary words, not arbitrary explanations or full-document narration.
- Claude's latest visible work expands class descriptions and prepares a COCO evaluation. The inspected scripts contain prediction/evaluation, not a fine-tuning loop. No completed accuracy report was found in the inspected output location.
- **Important correction:** YOLOE can be fine-tuned; Claude's statement that it cannot be trained because it is zero-shot is too broad. What is true is that this particular workflow is currently using prompts and evaluation. [Official YOLOE training documentation](https://docs.ultralytics.com/models/yoloe/#train-usage).
- The local evaluation maps roughly 40 vocabulary labels to COCO categories, including multiple narrower labels against one broader category. That cannot establish correctness for all 196 words or distinguish an AC remote from other remotes. COCO detection itself has 80 categories. [COCO detection benchmark](https://cocodataset.org/dataset/detection-2017.htm).
- The current camera page calls detections “Learned this session”, but those are recognised words held in page state, not evidence of learning or persistent vocabulary records. Studio must keep those concepts separate.
- Current Studio is a manual question/answer builder with saved-list review and deletion. It has no saved-quiz editing, quiz-taking, attempt history, flashcards, source grounding, or text-generation integration. Library currently stores text notes, not uploaded PDFs.

### Consequences for Studio

1. Camera output is a **suggested label**, not a fact or a learning result.
2. The visual model is not an OCR engine, document tutor, image generator, or pronunciation grader. Do not route those jobs to it.
3. Studio must work with the camera service stopped, no GPU, no text AI, and no internet.
4. Do not start, stop, reload or modify Claude's model process, vocabulary, datasets or evaluation scripts while implementing Studio. Agree a service contract at handoff first.

## 3. The experience

### Studio landing

A compact heading, one primary **New activity** button, search, and a restrained list of the user's actual projects. Filter by All, Quizzes and Flashcards. Each row shows title, type, topic, item count, saved/draft state and real last-edit time. Preview comes from the content, not generated stock artwork.

The first-use state says: “Make something to practise.” Offer **Start blank** and **Use a Library note**. An optional **Use camera words** action appears only when confirmed words exist. No seeded projects, invented scores, names, streaks or empty statistics cards.

Selecting New activity asks only **Quiz or Flashcards** and **Blank or From material**. Default a new quiz to five questions and a deck to ten cards when AI is used, clearly editable; manual projects start with one empty item. These are configuration defaults, not fake content. Advanced generation settings stay collapsed.

### Editing workspace

Keep the existing Forge sidebar and top bar. Inside Studio:

```text
Project title · Saved on this device       Preview   Practise   AI assist
───────────────────────────────────────────────────────────────────────
Item outline       Active question/card editor       AI assist (optional)
1. …               Labelled fields, not a chat box    Selected material
2. …               Answer / explanation              Proposed changes
+ Add item         Source excerpt, when available    Apply / Dismiss
───────────────────────────────────────────────────────────────────────
Source references and save errors appear beside the work they affect.
```

- The outline supports select, add, duplicate, delete and reorder. Provide Move up/Move down buttons as alternatives to dragging.
- The central editor is the main visual surface. Use ordinary labelled inputs and textareas initially; do not build a full Word clone for question fields.
- Quiz types: multiple choice and short answer. Multiple choice needs distinct options and exactly one correct answer. Short answer needs a model answer, with optional explanation.
- Cards have front, back and optional locally saved image with alternative text. Avoid implementing a separate editor for vocabulary cards; they are normal flashcards with an image and optional pronunciation action.
- Source references are optional for manual authoring, required when presenting an AI output as source-grounded. Clicking one shows the stored excerpt and its original source when available.
- Preview is read-only and never records an attempt. Practise saves pending edits first and begins an explicitly identified attempt against that revision.
- Preserve the last open project, selected item and editor position. Switching tabs or themes must not discard a draft.
- Delete moves an activity to Trash, with Undo and restore. Permanent deletion requires confirmation. Existing workspace reset must also cover the new Studio store so deleted content cannot return through migration.

### Practice is real, modest and honest

- Quizzes show one question at a time, accessible navigation, and an explicit Finish action. Abandoned sessions remain resumable and do not create a score.
- Multiple-choice answers can be checked deterministically. For short answers, reveal the model answer and let the learner mark their own result; label it **Self-assessed**, not AI-verified.
- Flashcards reveal the answer and offer Again / Got it. Record those responses, not inferred mastery or a fabricated spaced-repetition schedule.
- End with actual answered/correct counts, self-assessed results separately, and a Retry missed action. Do not infer broad subject mastery from one attempt.
- Persist the activity revision with each attempt. Editing an answer later must not rewrite a past result.

## 4. AI assist: useful actions with visible control

The AI panel supports **Create**, **Improve selection**, and **Explain**. Actions include drafting questions/cards from selected notes, simplifying a question, suggesting better distractors, and proposing an explanation. A short instruction field is available, but the user need not write a prompt to use the feature.

### Review contract

1. Show exactly which notes, excerpts or items are selected, plus provider/model and Local or Cloud processing. Never silently send the whole Library.
2. On Generate, create a cancellable job tied to the project ID and revision. Show genuine stage text such as “Generating suggestions”; no fake percentage or fake token streaming.
3. Validate the returned structure before rendering suggestions. Check item counts, field lengths, question types, unique choice IDs, valid correct-answer IDs and supplied source identifiers.
4. Show proposed additions or before/after edits. Default to adding draft items. Replacing existing content requires explicit per-item or clearly scoped batch approval.
5. Apply atomically, create a restorable revision, and expose Undo. If the user edited the target meanwhile, ask them to review the new version; never overwrite it with a stale response.
6. Reject invalid or incomplete output without touching the project. At most one bounded repair attempt, with a visible status and the same privacy rules; then offer Retry or manual editing.

Grounding is not a guarantee of correctness: store the actual supplied excerpt behind each source link and label output as an AI draft until reviewed. If information is absent, report that instead of inventing a quotation, page number or answer.

Cancellation must stop applying results immediately. Where provider-side cancellation is unavailable, say the remote request may still finish or incur usage; do not claim cost was stopped. Closing Studio must never let a late result modify a different project.

### Which model does what

| Capability | Existing foundation | Studio treatment |
| --- | --- | --- |
| Speech to text | Forge's native Whisper commands | Optional dictation into a chosen field. Recording starts only on click; transcript is reviewed before insertion. No automatic submission. |
| Object labels | External YOLOE camera service | Optional confirmed-word import. Never used as a text-generation provider. |
| Spoken vocabulary | Cached Soprano word endpoint | Play supported words; missing audio is a visible unavailable state, not silence presented as success. |
| Questions, explanations, distractors | Shared Rust `ChatClient` pattern, not wired into Forge | New Forge-specific integration. Start with a user-configured local OpenAI-compatible endpoint; cloud is explicit opt-in, not a fallback. |

Do not download or prescribe another model as part of Studio setup without measuring the target machine. Do not assume an installed Ollama model or endpoint exists. Manual creation and camera-word cards do not need a generative model.

AI settings belong in Forge's own settings. Secrets stay in native protected storage, not localStorage, IndexedDB, project exports or logs. Treat imported text and model output as untrusted content: neither can execute commands, expand the selected context or choose a new network destination.

## 5. Camera → vocabulary cards

Keep the existing camera shortcut. In a coordinated follow-up to Claude's camera work:

1. Label the session list **Recognised words**, not Learned.
2. Let the learner confirm, correct, select or remove words. Distinguish the original detector label from a user correction.
3. **Create flashcards** sends only the chosen, confirmed words to a new Studio draft. It does not import all 196 model labels.
4. A card can use an explicitly captured crop on its front and the English word on its back. Without a photo, use a manual description or a simple word card; do not invent a definition when no language model is connected.
5. Preview the crop before saving. Capture is opt-in, bounded in size, local by default and not automatically sent to a cloud model or a training dataset. No raw continuous-video storage.
6. Offer Play pronunciation and Repeat. Keep one playback controller so clips do not overlap; stop camera audio when leaving the camera surface.

Reliability work needed before this bridge ships: one in-flight detection request at a time; discard stale frames; explicit retry after server recovery; validate HTTP status/response shape; release camera tracks on exit; bound request/image size. Reuse the existing temporal voting intention but verify that movement does not produce repeated speech. No recognition benchmark runs during normal editing.

Package readiness, GPU support and per-class accuracy remain Claude's service-side work. A health response with a vocabulary count is not proof that every class is reliable. Do not hide the separate-service requirement or embed a developer's absolute Python path in a shipped setup experience.

## 6. Visual direction: a calm workbench within Forge

Keep both existing themes and their token system; do not introduce a third theme or replace the brand.

- **Ember Glass:** dark warm background, restrained orange accent, lightly frosted navigation and auxiliary panels. Give the editor a more opaque surface so moving embers never compete with text. Honour the existing glass-capability fallback.
- **Forge Brutalist:** warm paper, dark borders, square geometry and restrained offset shadows. Preserve the same information hierarchy and controls, not a separate feature set.
- Reuse the current system-font stack and approved mark asset, without CSS tinting or filters. Use Phosphor icons consistently; retain visible labels for important actions.
- One accent-filled primary action per local task. Most controls are quiet outline/text controls. No glowing AI orb, excessive badges, decorative analytics or repetitive promotional copy.
- Use the existing spacing rhythm with 8/16/24px relationships. Target a 200px outline, flexible editor and optional 300–340px assistant at wide window sizes. Below roughly 1280px, the assistant becomes a drawer; at the current 1100px minimum window, collapse the outline before squeezing the editor. Breakpoints are starting specifications to validate, not assumed proof of fit.
- Use short opacity/transform transitions for selection and panel changes, approximately 120–180ms. No per-keystroke animation. Retain the existing gooey control only where it helps; do not spread SVG filters across editor fields. Reduced motion produces a static background and immediate, clear state changes.
- Keyboard focus must stay visible and unobscured. Modal/drawer focus is contained and restored on close. Errors appear beside the field and remain readable. Normal text targets 4.5:1 contrast; essential control boundaries target 3:1. Test both themes independently. [WCAG reference](https://www.w3.org/WAI/WCAG22/quickref/).

Design research note: the local design-system search returned a landing-page pattern, not a suitable authoring workspace; the narrower product query had no match. Those palette/layout suggestions are deliberately not adopted. This direction uses the actual Forge themes and the design skill's applicable interaction/accessibility guidance.

## 7. Data and integration design

### Storage recommendation

Use a **Forge-owned IndexedDB database** for Studio activities, revisions, attempts and optional image blobs, following the repository's existing transaction-completion pattern. Do not put growing image data into the existing single localStorage JSON value, and do not borrow the Teacher database. Native file storage remains an alternative only if the installed-WebView persistence spike fails.

Proposed records, not existing types:

- `StudioActivity`: stable ID, kind, title, topic, created/updated times, current revision, draft/ready/trash state, ordered items and source references.
- `StudioRevision`: immutable saved content for undo/restore and attempt reproducibility; use bounded retention while retaining revisions referenced by attempts.
- `SourceReference`: source ID, snapshot/hash of the selected excerpt, origin kind, optional captured image ID, and user confirmation for camera labels. Later PDFs additionally require real file/page provenance.
- `PracticeAttempt`: activity/revision IDs, start/completion status, ordered responses and explicit deterministic/self-assessed evaluation method.
- `StudioAsset`: bounded Blob, media type, dimensions, alternative text and ownership references. Clean up unreferenced blobs without breaking retained revisions or Trash.
- `AiProposal`: job ID, target revision, supplied source IDs, proposed changes and review state. Never persists secrets.

Save status must follow transaction completion: Saving → Saved, or Not saved with retry/export recovery. Commit complete item changes together; serialise writes and check revisions. Do not claim “saved” after a swallowed storage exception. Browser storage is not an external backup: offer a versioned Studio backup/restore file, including referenced assets and attempts, before public release. [IndexedDB transactions and lifecycle](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB).

### Safe migration

Before mounting `useForgeData` or allowing any of its persistence effects, capture the untouched raw v1 storage value and gate legacy writes. Its current parse-error fallback returns an empty workspace, which its write effect can then persist; migration must run before that can erase the recovery source. If initialisation/migration fails, keep the raw value untouched and show recovery/retry instead of mounting a writer with empty defaults.

Import existing `ForgeQuiz` records once, preserving IDs, questions, answers and dates. Keep the original v1 data as a recovery source; never reset or silently drop malformed entries. Mark migration complete only after a verified transaction and read-back. Quarantine/report invalid entries rather than turning them into an empty workspace.

After migration, Studio is the single authoritative store for quizzes; adapt Home, search and Atlas reads so they do not continue using stale v1 quiz counts. Leave profile, notes, focus sessions and widget preferences intact. Backup/restore and Clear workspace must explicitly cover both stores, preventing reimport after reset. Test migration restart, duplicate IDs, corruption and schema upgrades before exposing the new UI.

### Code boundaries and allowed foundations

| Existing evidence | Reuse / restriction |
| --- | --- |
| `apps/forge/src/App.tsx` — `StudioPage`, `QuizBuilder`, route render | Replace only the Studio surface and narrow integration points; extract new Studio components under `apps/forge/src/studio/`. |
| `apps/forge/src/forgeData.ts` — `ForgeQuiz`, `useForgeData`, v1 key | Migration input and existing note/topic access. No existing `updateQuiz` or attempt API to assume. |
| `apps/teacher/src/paperLibrary.ts` — `openDatabase`, `transactionDone`, queued writes | Copy the small transaction pattern into Forge-owned storage; these internals are not shared exports. Do not use `cinder-teacher-library`. |
| `apps/forge/src/asr.ts` — `ensureAsrModel`, `downloadAsrModel`, `transcribeAudio` | Existing ASR entry points. `transcribeAudio` takes PCM samples, not a JPEG, file path or arbitrary encoded recording. |
| `apps/forge/src/components/CameraPage.tsx`; external `vocab-cam/server.py` | Existing `GET /health`, `GET /vocab`, raw-JPEG `POST /detect`, `GET /speech/{word}`. No existing save-capture, generate-quiz or training API. |
| `crates/ai/src/lib.rs` — `ChatClient::new`, `reachable`, `complete` | Existing non-streaming OpenAI-compatible request pattern. New Forge Tauri commands, cancellation and structured validation are still required. |
| `packages/ui/src/api.ts` — `CinderApi.aiSettings`, `saveAiSettings`, `chat` | These call the authenticated Matchbox Teacher host; they are **not** Forge's provider interface. Do not wire Studio to them or reuse `packages/ui/src/cache.ts`'s Student database identity. |
| `crates/core/src/secure_store.rs` — `store`, `load`, `delete` | Protected-secret pattern, using Forge's own data directory and secret names. Do not read Teacher credentials. |
| `apps/forge/src/theme.tsx`, `forge.css`, `components/WidgetTabs.tsx` | Existing theme, glass and interaction conventions; consume them without changing Matchbox's ThemeProvider. |
| `apps/teacher/src/paperLogic.ts`, `paperExport.ts`; `packages/ui/src/editor.tsx` | Later worksheet/export/rich-text references only. Not a reason to couple Forge to Teacher internals or introduce a full document editor in v1. |

All new native commands must be registered in Forge and tested in the installed app, following [Tauri's command pattern](https://v2.tauri.app/develop/calling-rust/). Forge currently registers only its three ASR commands and does not depend on `cinder-ai`/`cinder-core`; provider and protected-storage integration require explicit Forge dependency/build verification. Do not assume frontend dependencies grant native permissions. Avoid a broad shared-crate refactor; any required shared change needs separate review and Matchbox regression checks.

## 8. Delivery sequence and gates

### Phase 0 — freeze the contract and prove persistence

**Implement:** no product features yet. Re-read the sources above, record the baseline, isolate Studio work from Claude's active camera changes, and test IndexedDB save/reopen in installed Forge on Windows and Linux. Confirm the intended local text-provider endpoint without starting competing GPU workloads.

**References:** `tauri.conf.json`, `forgeData.ts`, `paperLibrary.ts`, current camera service contract.

**Exit check:** migration fixtures/backups exist; target-store behaviour is demonstrated; provider and camera gaps are explicit. **Guard:** a source file or health check is not proof of a working model/installer.

### Phase 1 — durable Studio data

**Implement:** validated records, storage adapter, migration, revisions, Trash, backup/restore and real save feedback. Adapt quiz readers in Home/search/Atlas and reset behaviour.

**References:** `forgeData.ts`; transaction/write-queue pattern in `paperLibrary.ts`; IndexedDB documentation.

**Exit check:** existing quizzes survive upgrade unchanged; corrupt v1 JSON remains byte-for-byte intact through startup failure; draft/revision/asset round-trips pass; quota failures show Not saved; interrupted migration is repeatable; reset cannot resurrect quizzes. **Guard:** no legacy write before raw-data capture, destructive migration, dual quiz source of truth or changes to Teacher storage.

### Phase 2 — manual authoring and practice

**Implement:** activity list, blank quiz/deck creation, editing/reorder/duplicate, preview, deterministic MCQ practice, self-assessed short answers/cards and resumable attempts. Wire actual Studio activity to existing app surfaces without fake metrics.

**References:** `App.tsx` current `StudioPage`/`QuizBuilder`; Forge theme tokens; Phase 1 store.

**Exit check:** create → edit → save → restart → practise → reopen result works offline and by keyboard in both themes. Previous attempts retain their original revision. **Guard:** no placeholders presented as working controls, hidden answers during practice, or automatic mastery claims.

### Phase 3 — selected camera words

**Implement:** only after coordinating with Claude, add confirmation/correction and explicit selected-word handoff; optional crop and cached-word pronunciation. Include the lifecycle/request/audio safeguards in section 5.

**References:** `CameraPage.tsx`, current `server.py` endpoints, Phase 1 asset store; [camera permission API](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia).

**Exit check:** real webcam test covers jitter, a wrong label, no detection, missing speech, service failure, retry and leaving the page. One confirmed import yields one draft, and no background frame capture persists. **Guard:** no changes to weights/evaluation, implicit training upload, or assumption of CPU/Linux model support.

### Phase 4 — review-first AI assistance

**Implement:** Forge-owned provider settings/credentials, native request bridge, source selection, validated proposals, cancellation, stale-response protection and atomic Apply/Undo. Dictation reuses Whisper; it is not required for typed authoring.

**References:** `ChatClient`, `secure_store`, Forge ASR/Tauri command patterns. Provider-specific behaviour must be tested, not inferred from a compatible URL.

**Exit check:** approved-source generation and single-item improvement work; malformed/truncated responses, timeouts, unavailable provider, cancellation and edits during generation cannot damage data. Cloud calls require explicit configuration/context consent. **Guard:** no auto-apply, fake streaming, automatic cloud fallback, hidden retry loop or keys in frontend storage.

### Phase 5 — release quality

**Implement:** accessibility/performance fixes, validated backup/restore UX, simple text/CSV content export where appropriate, installed-app tests and documentation of optional AI/camera setup.

**References:** both Forge themes, package scripts and Tauri configurations; WCAG reference. Escape exported spreadsheet-formula prefixes rather than interpreting user/AI text as formulas.

**Exit check:** all acceptance cases below pass on the declared supported platforms; optional unavailable integrations degrade cleanly. Capture real screenshots of populated, empty, saving/error and practice states. **Guard:** typechecking alone is not a UI or data-safety test; do not claim an unsupported model configuration is supported because the base app runs.

### Subsequent release — worksheets and PDFs

Add actual PDF storage/extraction with page provenance, scanned-document OCR only through a separately verified capability, worksheet layout and separate answer-key export. Evaluate existing paper normalisation/export code and shared rich-text editor first. Preserve manual editing and preview; do not claim official-board compliance without validating the generated paper against the board's requirements.

Defer arbitrary TTS narration, pronunciation scoring, generative images, public sharing, collaboration, model training UI and automatic spaced repetition. Do not show decorative disabled tabs for these features in the first release.

## 9. Acceptance matrix

| Test | Required result |
| --- | --- |
| Fresh install | No invented name, content, score or history. A clear manual creation path exists. |
| Existing user | Legacy quiz content/IDs preserved; notes, focus and preferences unchanged. |
| Storage failure or restart | Last committed content survives; uncommitted loss is not disguised as Saved; recovery/export available. |
| Real practice | Preview never produces an attempt; only completed attempts produce results; self-assessment is labelled. |
| AI unavailable | Manual authoring/practice remain usable; no silent cloud request. |
| Unsafe/stale AI output | Invalid fields, forged references and stale replacements cannot be applied. |
| Privacy | Only selected material leaves the app for the configured provider; no automatic image/training upload. |
| Camera/audio | Explicit permissions, bounded detection requests, no speech overlap/spam; camera stops on exit. |
| Navigation | Search opens the exact activity; Home resumes the actual draft; Atlas counts match saved topics. |
| Two themes | Consistent controls; readable editor, errors and focus states; reduced-motion and low-glass modes work. |
| Window/font scaling | Test 1100×700, 1440×900 and 1920×1080 plus enlarged text/200% zoom. Collapse panels rather than clip primary actions. |
| Performance | Test typing/reorder on a 100-item activity and a 500-activity local library. Record the test hardware and interaction latency; do not load model weights or camera streams on Studio mount. |
| Product separation | No Teacher/Student source or data changes. Shared changes, if unavoidable, have their own regression checks. |

## 10. Decisions and remaining uncertainties

Recommended defaults: quizzes and flashcards first; optional assistant drawer; local storage and manual operation first; local text-provider setup before any cloud option; camera as a confirmed input, not a learning score.

Before implementation, confirm the text-generation endpoint/model, supported hardware/platforms for the optional camera service, and the completed per-class evaluation results. Before distributing any additional models/runtime, review their licences and packaging requirements. None of these uncertainties blocks building manual Studio.

**Success is a small, reliable creation-to-practice loop, not the number of AI buttons.** This plan intentionally makes data safety and usable manual tools prerequisites for automation.

### Evidence record

- Local Claude project conversation `e721d3e0-0472-46b4-9f47-7b7ef339c02e`, including visible entries through 31 August 2026, approximately 19:45 IST.
- Read-only inspection of Forge source and `C:/Users/Neel/vocab-cam/live.py`, `server.py`, `eval_accuracy.py` and evaluation output directory. No training/inference process launched or modified for this plan.
- `handoff.md` and `design/brand/BRAND.md` for product/brand history; their old claims that Forge has not started are superseded by current source and conversation evidence.
- Planning and UI/UX skills shaped the phased gates, source checks, keyboard behaviour and restrained visual direction. No app implementation or visual-runtime verification was performed for this planning task.
