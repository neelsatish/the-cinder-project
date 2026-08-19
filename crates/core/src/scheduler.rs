//! Spaced-repetition scheduling.
//!
//! This is SM-2, deliberately. FSRS schedules better, but SM-2 is ~60 lines a
//! student can read and reason about, and the review loop has to be *proven*
//! before the algorithm is worth upgrading. The `ReviewState` fields are already
//! named for FSRS (`stability`, `difficulty`) so swapping the implementation
//! later is a change to this file and nothing else.

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// What the student pressed after seeing the answer.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum Grade {
    Again,
    Hard,
    Good,
    Easy,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ReviewState {
    #[ts(type = "string")]
    pub due: DateTime<Utc>,
    /// Current interval in days. (Named `stability` for FSRS compatibility.)
    pub stability: f64,
    /// SM-2 ease factor, clamped to `MIN_EASE`.
    pub difficulty: f64,
    pub reps: i64,
    pub lapses: i64,
    #[ts(type = "string | null")]
    pub last_review: Option<DateTime<Utc>>,
}

pub const INITIAL_EASE: f64 = 2.5;
pub const MIN_EASE: f64 = 1.3;
/// A lapsed card comes back in ten minutes, not tomorrow — sessions are ~55
/// minutes, so the student sees it again before leaving the lab.
pub const RELEARN_MINUTES: i64 = 10;
/// Without this, a mature card that gets one `Easy` can jump to a multi-year
/// interval, which in a 12-week programme means "never seen again".
pub const MAX_INTERVAL_DAYS: f64 = 365.0;

impl ReviewState {
    /// A brand-new card, due immediately.
    pub fn new(now: DateTime<Utc>) -> Self {
        Self {
            due: now,
            stability: 0.0,
            difficulty: INITIAL_EASE,
            reps: 0,
            lapses: 0,
            last_review: None,
        }
    }

    #[must_use]
    pub fn grade(&self, grade: Grade, now: DateTime<Utc>) -> Self {
        let mut next = self.clone();
        next.last_review = Some(now);

        if grade == Grade::Again {
            next.reps = 0;
            next.lapses += 1;
            next.stability = 0.0;
            next.difficulty = (self.difficulty - 0.20).max(MIN_EASE);
            next.due = now + Duration::minutes(RELEARN_MINUTES);
            return next;
        }

        next.difficulty = match grade {
            Grade::Hard => (self.difficulty - 0.15).max(MIN_EASE),
            Grade::Good => self.difficulty,
            Grade::Easy => self.difficulty + 0.15,
            Grade::Again => unreachable!("handled above"),
        };

        next.reps = self.reps + 1;
        next.stability = match next.reps {
            1 => 1.0,
            2 => 6.0,
            _ => {
                let multiplier = match grade {
                    Grade::Hard => 1.2,
                    Grade::Good => next.difficulty,
                    Grade::Easy => next.difficulty * 1.3,
                    Grade::Again => unreachable!("handled above"),
                };
                self.stability * multiplier
            }
        }
        .min(MAX_INTERVAL_DAYS);

        // Round to whole minutes so two cards graded in the same second do not
        // drift apart in the due-list ordering.
        let seconds = (next.stability * 86_400.0).round() as i64;
        next.due = now + Duration::seconds(seconds);
        next
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn t0() -> DateTime<Utc> {
        DateTime::parse_from_rfc3339("2026-08-07T09:00:00Z")
            .unwrap()
            .with_timezone(&Utc)
    }

    #[test]
    fn new_card_is_due_now() {
        let s = ReviewState::new(t0());
        assert_eq!(s.due, t0());
        assert_eq!(s.reps, 0);
    }

    #[test]
    fn first_two_good_reviews_use_fixed_steps() {
        let s = ReviewState::new(t0()).grade(Grade::Good, t0());
        assert_eq!(s.reps, 1);
        assert!(
            (s.stability - 1.0).abs() < f64::EPSILON,
            "first step is 1 day"
        );

        let s = s.grade(Grade::Good, s.due);
        assert_eq!(s.reps, 2);
        assert!(
            (s.stability - 6.0).abs() < f64::EPSILON,
            "second step is 6 days"
        );
    }

    #[test]
    fn third_good_review_multiplies_by_ease() {
        let mut s = ReviewState::new(t0());
        for _ in 0..3 {
            s = s.grade(Grade::Good, s.due);
        }
        assert_eq!(s.reps, 3);
        assert!((s.stability - 6.0 * INITIAL_EASE).abs() < 1e-9);
    }

    #[test]
    fn again_relearns_in_minutes_and_counts_a_lapse() {
        let mut s = ReviewState::new(t0());
        for _ in 0..3 {
            s = s.grade(Grade::Good, s.due);
        }
        let at = s.due;
        let s = s.grade(Grade::Again, at);

        assert_eq!(s.reps, 0);
        assert_eq!(s.lapses, 1);
        assert_eq!(s.due, at + Duration::minutes(RELEARN_MINUTES));
        assert!(s.difficulty < INITIAL_EASE, "ease drops after a lapse");
    }

    #[test]
    fn ease_never_falls_below_the_floor() {
        let mut s = ReviewState::new(t0());
        for _ in 0..40 {
            s = s.grade(Grade::Hard, s.due);
        }
        assert!(s.difficulty >= MIN_EASE, "ease was {}", s.difficulty);
    }

    #[test]
    fn interval_is_capped_so_cards_stay_inside_the_programme() {
        let mut s = ReviewState::new(t0());
        for _ in 0..30 {
            s = s.grade(Grade::Easy, s.due);
        }
        assert!(
            s.stability <= MAX_INTERVAL_DAYS,
            "stability was {}",
            s.stability
        );
    }

    #[test]
    fn hard_advances_more_slowly_than_good() {
        let mut base = ReviewState::new(t0());
        for _ in 0..2 {
            base = base.grade(Grade::Good, base.due);
        }
        let hard = base.grade(Grade::Hard, base.due);
        let good = base.grade(Grade::Good, base.due);
        assert!(hard.stability < good.stability);
    }
}
