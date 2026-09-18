# Cinder Forge English — product and implementation plan

Date: 1 September 2026. Status: proposed; planning only.

## 1. Product decision

Build **English Practice** as a Studio activity in Cinder Forge. It combines vocabulary practice, clear model pronunciation, recording, speech recognition and restrained feedback. It must work fully offline after optional model downloads and must remain useful without the camera, a GPU, Ollama or a generative language model.

Do not add a fifth permanent sidebar destination. Keep Home, Library, Studio and Atlas. Studio creates and resumes English Practice activities; the existing camera shortcut can send learner-confirmed object words into one.

### Assumed first audience

- Beginner to intermediate English learners using Forge individually.
- Windows 11 and Linux Mint desktop computers, including modest CPUs.
- Indian English and other legitimate accents must not be treated as errors merely for differing from a US model voice.
- The first release teaches a curated vocabulary pack and short phrases. Open dictation, live conversation and high-confidence phoneme diagnosis are later work.

These assumptions should be checked with learners before content production, but they do not block a technical prototype.

## 2. Pushback: TTS + STT is not a pronunciation grader

TTS can provide a reference. STT can report the words a recogniser heard. Neither proves that each sound was pronounced correctly.

For example, an STT model may transcribe a heavily accented but understandable word correctly, or replace an unclear word using language context. Comparing the transcript with the target is useful **speech-recognition feedback**, but presenting the result as “92% pronunciation” would be fake precision.

Therefore:

1. MVP feedback says **Matched**, **Heard differently** or **Could not hear clearly** and shows the actual transcript.
2. It reports recording problems—too quiet, clipped or too short—before commenting on speech.
3. It lets the learner replay, retry, slow the example and accept their own answer.
4. Sound-level feedback ships only after a forced-alignment pilot is calibrated against diverse real speakers. Raw acoustic likelihood is never shown as a percentage.
5. The product teaches intelligibility and confidence. It does not promise accent removal or present one voice as the only correct English.

## 3. Recommended small, open model stack

### Ship first

| Job | Choice | Why | Honest limitation |
| --- | --- | --- | --- |
| Speech recognition | Existing whisper.cpp/`whisper-rs` **`base.en`** | Already integrated into Forge; offline; MIT runtime; 142 MiB model and about 388 MB memory according to the project table. Better default accuracy than tiny without creating a second ASR system. | Transcription and experimental timestamps, not phoneme scoring. Speed and accuracy on learner accents still need local benchmarks. |
| Low-resource ASR option | whisper.cpp **`tiny.en`**, only after benchmark | 75 MiB model and about 273 MB memory. Same runtime and command shape as the existing integration. | Lower accuracy can make pronunciation feedback less fair. Do not auto-select it solely because memory is low. |
| Text to speech | **Selection gate: Kitten Nano INT8 vs Piper Lessac Medium** | Kitten is approximately 25 MB and Piper's voice ONNX is 63.2 MB. Both are CPU-oriented and small enough to evaluate on Forge's target computers. | Neither is approved to ship yet. Kitten is developer-preview software with incomplete voice provenance; Piper's maintained runtime is GPL-3.0-or-later and every voice needs its own licence audit. |

Official references:

- [whisper.cpp README, models and memory](https://github.com/ggml-org/whisper.cpp#memory-usage); [MIT licence](https://github.com/ggml-org/whisper.cpp/blob/master/LICENSE).
- [KittenTTS project, API and preview status](https://github.com/KittenML/KittenTTS); [Kitten Nano INT8 model card](https://huggingface.co/KittenML/kitten-tts-nano-0.8-int8).
- [Current Piper runtime and GPL-3.0-or-later licence](https://github.com/OHF-Voice/piper1-gpl); [Piper Lessac Medium model card](https://huggingface.co/rhasspy/piper-voices/blob/main/en/en_US/lessac/medium/MODEL_CARD).
- [sherpa-onnx licence](https://github.com/k2-fsa/sherpa-onnx/blob/master/LICENSE); [maintainer's TTS/eSpeak-NG licensing issue and proposed v2 path](https://github.com/k2-fsa/sherpa-onnx/issues/3731).

### TTS selection gate

Do not choose the TTS engine from model size alone. Phase 0 must resolve these two routes:

1. **Permissive-first candidate — Kitten Nano INT8:** use only if a pinned Windows/Linux native integration can be built without importing a GPL phonemiser, the exact voice/model provenance is acceptable, and learner listening tests pass. Its size and voice selection are attractive; its developer-preview status is the engineering risk.
2. **Maturity-first candidate — Piper Lessac Medium:** use only after deciding whether Cinder will meet the GPL obligations of the maintained Piper runtime and after the selected voice's model/data provenance is cleared. It is mature and small, but it may change Forge's distribution obligations.

Current **sherpa-onnx TTS is an implementation experiment, not a licensing shortcut**: its source is Apache-2.0, but its current TTS path relies on GPL eSpeak-NG/piper-phonemize. Re-evaluate the proposed v2 phonemiser when released; do not describe the current combined stack as Apache-only.

### Evaluation fallback, not the default

If neither small candidate passes, test **Kokoro-82M** as a quality benchmark, not an automatic fallback. Its sherpa English package uses a roughly 330 MB model plus voices, and official Raspberry Pi 4 results are slower than real time. The current sherpa phonemiser caveat still applies. [Kokoro model documentation](https://k2-fsa.github.io/sherpa/onnx/tts/pretrained_models/kokoro.html).

### Explicit non-selections

- **Soprano + PyTorch** remains part of the external camera experiment, not Forge's core TTS. Requiring its Python/CUDA environment would defeat the lightweight/offline installer goal.
- **Vosk small English** is a valid 40 MB Apache-2.0 recogniser, but adding a second runtime buys little while Forge already has whisper.cpp. Its published small Indian-English model result is particularly weak on the cited test set, so it is not the default for fair learner feedback. [Official Vosk model table](https://alphacephei.com/vosk/models).
- **Ollama** is not needed. It packages language models, not these native speech paths.
- Do not add voice cloning. It adds consent, impersonation and model-weight risk without improving the learning loop.

## 4. Learner experience

### Entry and activity structure

In Studio, **New activity → English Practice** opens three choices:

1. **Vocabulary set** — select a built-in topic, Library words or confirmed camera words.
2. **Listen and repeat** — practise curated words and short phrases.
3. **Review due words** — transparent review based only on the learner's own Again / Hard / Good responses.

The activity page uses the existing Forge shell and themes:

```text
English Practice · Kitchen basics                  Models: Ready
──────────────────────────────────────────────────────────────────
Words (18)       Current card                       Session
cup              [image, optional]                  4 of 10
bottle           bottle                             Hear → Speak
spoon            A container for drinks.            [Play] [Record]
...              “This is my water bottle.”         Heard: bottle
                 [Slow] [Normal]                    [Again] [Good]
```

Use one clear task per screen. Advanced model details live in Settings, not beside the learner. Empty, download, permission, listening, processing, matched, different and error states must all be designed; no placeholder controls.

### Vocabulary modes

- **Learn:** image or word, concise definition, part of speech, a curated example and Play pronunciation.
- **Listen:** hear a word and choose the matching text/image. Distractors come from the pack, not from an LLM.
- **Recall:** see the image/definition and reveal the word.
- **Speak:** hear the model, record once, and compare the recognised word with the expected word.
- **Use it:** read a short curated sentence. MVP checks whether the expected content words were recognised and shows omissions/substitutions; it does not judge grammar or accent.

Camera detections enter as **suggestions**. The learner confirms/corrects the label and chooses whether to keep a still crop. Recognition does not mark a word as learned. No continuous video is stored.

### Pronunciation interaction

1. Play the target at Normal speed. Slow is an explicit replay generated with the TTS speed control, never audio stretched so far that sounds distort.
2. Record only after a click. Show the microphone state and elapsed time. Stop automatically after a short bounded duration or silence, with a manual Stop button.
3. Run an audio-quality gate first. Explain “too quiet”, “too loud/clipped”, “too short” or “no speech detected” without assigning a language result.
4. Transcribe locally. Display **Forge heard: …**.
5. For a single target word, normalise case and punctuation, then classify exact match, different word or unclear. Accept common contractions only when the lesson defines them.
6. For a short sentence, align expected and recognised word sequences and highlight matched, omitted and substituted words. Do not turn word error rate into a pronunciation percentage.
7. Offer Replay, Retry and Continue. The learner can override a false rejection; log the override as model feedback locally, not as proof that the learner was wrong.
8. Store the outcome and transcript by default, not raw audio. Saving a recording is a separate opt-in action with Delete.

### Vocabulary content record

Each curated item needs a stable ID, display word, locale, topic, level, part of speech, learner-friendly definition, example sentence, accepted recognition variants, optional image/alt text, TTS pronunciation override, and source/licence metadata. IPA/syllable/sound hints are optional and must be curated or reviewed; do not generate them blindly and present them as authoritative.

Start with 100–200 high-utility words split into small packs (home, classroom, food, clothes, people/actions). Claude's 196 camera labels are candidate input, not automatically approved curriculum. Avoid culturally narrow images and examples. Keep US/UK spelling variants linked rather than treating one as a mistake.

### Review scheduling

Use a transparent Leitner-style progression driven by Again / Hard / Good. Show the next review date and why it changed. Recognition results may suggest “Try again” but must not silently advance a card. Do not invent mastery percentages, streak pressure or punitive red states.

## 5. Native architecture

### Keep speech in the Forge process

- Retain the current browser microphone → mono 16 kHz float PCM → Tauri command route.
- Keep `whisper-rs` for recognition. Extend its result type rather than replacing the existing dictation command, so current microphone transcription remains compatible.
- Add TTS behind a narrow Forge-native provider interface only after one Phase 0 candidate passes licensing, provenance, build, performance and listening gates on Windows and Linux. Do not couple lesson data to a specific engine and do not ship a localhost Python server for core speech.
- Load ASR and TTS lazily and separately. Each has its own state and bounded worker queue. Run inference away from the UI thread; serialise access to model contexts that are not documented as thread-safe.
- Stop/cancel results at the UI boundary when a component unmounts. If native inference cannot be interrupted, discard the stale result and do not mutate another activity.

### Proposed commands

These are design names, not existing APIs:

- `speech_models_status() -> SpeechModelStatus`
- `download_speech_model(model_id)` with the existing progress-event pattern extended to include `model_id`
- `remove_speech_model(model_id)` with explicit confirmation and an in-use guard
- `synthesise_speech({ text, voice_id, speed }) -> PcmAudio`
- `analyse_utterance({ samples, expected_text, mode }) -> UtteranceAnalysis`

Keep the existing `ensure_asr_model`, `download_asr_model` and `transcribe_audio` wrappers during migration. Introduce versioned payloads, input-size limits and typed errors; do not silently change the existing command's return type.

### Allowed external APIs discovered

- Existing Forge: `transcribeAudio(samples: Float32Array) -> Promise<string>` calls the registered `transcribe_audio` command; it expects mono 16 kHz float samples from `MicRecorder`.
- whisper.cpp: normal transcription through the existing `whisper-rs` binding. Token-level/DTW timestamps exist but are explicitly experimental; do not make them an MVP scoring dependency. [whisper.cpp API](https://github.com/ggml-org/whisper.cpp/blob/master/include/whisper.h).
- KittenTTS's official Python API uses `KittenTTS(...)`, `generate(...)` and `generate_stream(...)`; it does not establish a supported native Tauri integration. Any direct ONNX/native prototype must be verified from pinned upstream code, not inferred from the Python wrapper.
- Piper's maintained APIs include Python `PiperVoice.load(...).synthesize_wav(...)` and native incremental synthesis. They are reference surfaces only until the GPL decision is made.
- If sherpa-onnx remains a candidate, its older `SherpaOnnxOfflineTtsGenerate(..., sid, speed)` C API is deprecated; use `SherpaOnnxOfflineTtsGenerateWithConfig`. This API fact does not remove the current GPL phonemiser dependency. [Current generation configuration](https://k2-fsa.github.io/sherpa/onnx/c-api/html/structSherpaOnnxGenerationConfig.html).
- PocketSphinx research path: `pocketsphinx -phone_align yes align audio.wav "expected words"`, or C `ps_set_align_text`, can return nested phone timings. It requires normalised in-dictionary text. [Official alignment documentation](https://github.com/cmusphinx/pocketsphinx#alignment).

### Model manager and supply-chain rules

Replace the current single hard-coded download assumption with a compile-time manifest: model ID/version, capability, platform, URLs, exact byte-size limits, SHA-256, runtime/model/content licences and installed file list.

For every download: allow-list HTTPS hosts; enforce `Content-Length` when present and a streamed hard cap regardless; write a unique temporary file; hash before extraction; reject path traversal/symlinks and unexpected files; atomically install; preserve the prior working version on failure; expose retry/remove; and clean stale partial files. No arbitrary model URL field.

Ship licence/NOTICE text with every runtime, model and voice. The runtime licence does not automatically cover checkpoints, voices, phonemiser data or vocabulary images. Resolve those individually before distribution.

### Audio and cache rules

- Bound recording length: short words/phrases only in MVP. Reject empty, NaN and excessively large sample arrays in Rust.
- Compute basic quality measurements locally: duration, peak/clipping and RMS/no-speech. Calibrate thresholds with real microphone recordings; do not copy arbitrary constants into release.
- Cache generated TTS by a hash of model version + voice + speed + normalised text. Cap the cache and use least-recently-used cleanup. Never mix output from two model versions under one key.
- Only synthesise curated or user-requested text. Escape/display text as text; never pass content to a shell.
- Sessions continue if either model fails: cards remain readable, manual self-assessment remains available, and the UI explains which speech feature is unavailable.

## 6. Pronunciation Research track

Run this separately from MVP implementation.

### Candidate

PocketSphinx is a small BSD-licensed recogniser with word, phone and state forced alignment for a known phrase. It is suitable for a bounded experiment because English Practice already knows the expected text. It is not automatically a fair pronunciation scorer.

### Prototype output

- Expected word/phone sequence.
- Alignment success/failure.
- Approximate phone boundaries and raw acoustic probabilities kept in diagnostic logs during the consented study only.
- Learner-facing feedback limited to well-validated contrasts, such as a curated minimal-pair exercise. No overall accent score.

### Release gate

Create a consented evaluation set spanning speakers, ages appropriate to the target product, Indian and other English accents, microphone quality and background noise. Have qualified human raters label intelligibility and target-sound attempts. Establish per-phone calibration and reject/abstain thresholds on held-out speakers.

Ship sound-level hints only if they improve agreement with human feedback without a materially worse false-rejection rate for an accent cohort. Publish the limitations in-app. Otherwise keep transcript-level coaching and manual minimal-pair listening exercises.

Never retain children's voice data for model improvement by default. Training or telemetry needs a separate, explicit, revocable consent and data-governance plan.

## 7. Delivery plan

### Phase 0 — documentation, licence and benchmark spike

**Implement:** no user feature. Pin Kitten Nano INT8, Piper Lessac Medium/current Piper and current sherpa-onnx as separate candidate components. Produce a dependency/licence bill of materials before compiling them. Build isolated Windows/Linux spikes only for legally viable routes; measure total installed size, cold load, synthesis real-time factor and peak memory on target low/mid hardware. Benchmark current `base.en` and candidate `tiny.en` on real learner recordings. Blind-listen to every proposed teaching word, normal/slow speed and available voice. Select one TTS route or stop—the phase is allowed to conclude that no candidate is ready.

**References:** official links in sections 3 and 5; current `apps/forge/src-tauri/src/main.rs`, `apps/forge/src/asr.ts`, `apps/forge/src/audio.ts`.

**Verification:** reproducible dependency lock; transitive runtime/model/voice/dataset/phonemiser licences captured; checksums recorded; no Python/CUDA dependency in the proposed release path; installer and clean-machine model downloads tested; baseline report includes failures and hardware. **Guard:** do not choose by parameter count, a demo clip, repository-level licence badge or native-speaker WER alone; do not call a stack Apache-only when it contains GPL components.

### Phase 1 — safe model manager and native TTS

**Implement:** manifest, verified downloader, status/remove UI, a lazy model-agnostic TTS provider, PCM playback and a bounded cache using the single candidate approved in Phase 0. Preserve the existing Whisper model/data through migration.

**References:** existing Forge chunked-download/progress pattern plus the approved candidate's pinned official API and package layout.

**Verification:** corrupted/truncated/oversized/wrong-hash archives cannot install; interrupted update leaves the prior model usable; only verified voice IDs are exposed; speed/voice changes invalidate cache correctly; both platforms work offline after setup. **Guard:** no arbitrary URLs, shell execution, bundled Python, deprecated TTS API, unverified voice licence or second hidden TTS runtime.

### Phase 2 — vocabulary data and non-speech practice

**Implement:** versioned vocabulary-pack schema, one reviewed starter pack, Learn/Listen/Recall modes and transparent review scheduling. Integrate as a real Studio activity using Studio's durable storage/revision plan.

**References:** `docs/forge-studio-plan.md` data and migration sections; Forge theme/components; licensed content sources selected in Phase 0.

**Verification:** fresh install has no fake progress; packs import/update without overwriting learner records; every image has alt text/source; all words have reviewed audio; Again/Hard/Good changes are deterministic and testable. **Guard:** no camera label auto-import, AI-authored definition presented as fact, or hidden mastery formula.

### Phase 3 — record, recognise and compare

**Implement:** explicit recording states, quality gate, bounded ASR queue, expected/transcript normalisation, single-word and short-sentence comparison, learner override and private attempt records. Keep existing general dictation working.

**References:** current `MicRecorder`, `transcribe_audio`, whisper.cpp/whisper-rs APIs; the approved vocabulary variants from Phase 2.

**Verification:** microphone denied/disconnected, silence, clipping, noise, timeout, cancel and model removal all degrade safely; accents and non-native speakers are included in test recordings; raw audio is deleted by default; transcript comparison has unit fixtures for punctuation/contractions/variants. **Guard:** no pronunciation percentage, grammar judgement, hidden recording or model-context reuse across users.

### Phase 4 — camera vocabulary bridge

**Implement:** after coordinating with Claude's current camera work, rename “Learned” to “Recognised”, add confirm/correct/select and create an English Practice set from selected words/images. Playback comes from the core TTS, not Soprano, once model readiness is proven.

**References:** `apps/forge/src/components/CameraPage.tsx`, its documented localhost service contract, and `docs/forge-studio-plan.md` section 5.

**Verification:** wrong detections are correctable; duplicate labels merge predictably; crop saving is opt-in; no video persists; camera/server absence leaves the English tool usable. **Guard:** no modification of Claude's training/evaluation files, automatic “learned” status, or Soprano server requirement for core lessons.

### Phase 5 — sound-level research, optionally ship

**Implement:** isolated PocketSphinx forced-alignment prototype, calibration study and only the feedback proven by section 6's release gate.

**References:** official PocketSphinx alignment CLI/C APIs and pinned acoustic-model/dictionary licences.

**Verification:** unknown words, alternate pronunciations and alignment failure abstain cleanly; human-labelled held-out evaluation is documented by cohort; learner feedback never exposes raw score as certainty. **Guard:** do not turn forced alignment into unvalidated phoneme grading or require it for ordinary practice.

### Phase 6 — final verification and release

**Implement:** accessibility/performance pass, backup/restore coverage, model notices, first-run explanation, diagnostics export without audio/secrets, installer and update testing.

**Verification checklist:**

- Complete lesson works after network is disconnected.
- Manual/non-speech practice works with no models installed.
- Windows 11 and Linux Mint installers include the correct native runtime and no unintended model/Python files.
- Test the declared minimum hardware with TTS playback, ASR and theme animation; reduce visual effects before lowering audio quality.
- Keyboard and screen-reader flow cover play/record/stop/retry; state is not conveyed by colour alone; reduced motion works.
- An interrupted model download/update, low disk, corrupt cache and app restart preserve learner data.
- UI never calls transcript match “pronunciation accuracy”; recordings are not retained without opt-in.
- Third-party licence and source notices match the exact shipped versions/files.

**Guard:** passing typecheck/build is not proof of model quality, fairness, microphone behaviour or packaging.

## 8. Product success criteria

The MVP is ready when a new learner can install the optional speech packs, learn a real vocabulary set, hear a clear example, record a word, understand what Forge heard, retry, and review the word later—all offline and without a technical setup screen.

Evaluate separately:

- **Comprehension:** can learners understand why an answer matched/differed?
- **Recognition:** expected-word and sentence content-word match on a held-out, accent-diverse set, with abstentions counted—not discarded.
- **Fairness:** false rejection and unclear-result rates by cohort and microphone condition.
- **TTS quality:** human ratings of intelligibility/naturalness for the exact curriculum at normal and slow speeds.
- **Performance:** cold model load, peak memory, synthesis real-time factor, ASR latency and installer/download size on named hardware.
- **Learning:** pre/post recall and listening checks using unseen items, not clicks, streaks or model confidence.

Set release thresholds only after the Phase 0 baseline; choosing convenient numbers before measuring the learners and hardware would manufacture certainty.

## 9. Deferred intentionally

Open conversation, grammar correction, cloud transcription, automatic lesson generation, pronunciation percentages, emotion scoring, accent ranking, voice cloning, continuous listening, automatic training uploads and speech-based high-stakes assessment.

The best first product is not “Duolingo locally”. It is a small, trustworthy loop: **see → hear → say → see what was heard → retry → review**.
