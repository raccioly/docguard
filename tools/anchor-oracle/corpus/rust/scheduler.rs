//! A small cooperative job scheduler with a hand-rolled single-thread executor,
//! so it runs inside tests and command-line tools without an external runtime.

/* Design note: the queue is a min-heap keyed on (due, id).
   /* Ties are broken by id so jobs registered first run first, which keeps
      nightly report ordering stable across restarts. */
   A job is re-queued before it runs, so a slow job cannot drift. */

use std::cmp::Reverse;
use std::collections::BinaryHeap;
use std::future::Future;
use std::pin::{pin, Pin};
use std::task::{Context, Poll, RawWaker, RawWakerVTable, Waker};
use std::time::Duration;

pub mod spec {
    //! Parses compact schedule specs such as `every 15m` or `at 02:30`.

    use std::time::Duration;

    pub const SECONDS_PER_DAY: u64 = 86_400;

    #[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
    pub enum Spec {
        Every(Duration),
        DailyAt { hour: u8, minute: u8 },
    }

    #[derive(Debug, Clone, PartialEq, Eq)]
    pub struct ParseError(pub String);

    impl Spec {
        /// The first firing strictly after `now`, measured from day zero.
        pub fn next_after(&self, now: Duration) -> Duration {
            match *self {
                Spec::Every(interval) => now + interval,
                Spec::DailyAt { hour, minute } => {
                    let target = u64::from(hour) * 3_600 + u64::from(minute) * 60;
                    let day_start = now.as_secs() - now.as_secs() % SECONDS_PER_DAY;
                    let mut next = day_start + target;
                    if next <= now.as_secs() {
                        next += SECONDS_PER_DAY;
                    }
                    Duration::from_secs(next)
                }
            }
        }
    }

    pub fn parse(input: &str) -> Result<Spec, ParseError> {
        let bytes = input.trim().as_bytes();
        if let Some(rest) = bytes.strip_prefix(b"every ") {
            return parse_every(rest);
        }
        match bytes {
            [b'a', b't', b' ', h1, h2, b':', m1, m2] => {
                let two_digits = |hi: u8, lo: u8| -> Option<u8> {
                    (hi.is_ascii_digit() && lo.is_ascii_digit())
                        .then(|| (hi - b'0') * 10 + (lo - b'0'))
                };
                match (two_digits(*h1, *h2), two_digits(*m1, *m2)) {
                    (Some(hour @ 0..=23), Some(minute @ 0..=59)) => {
                        Ok(Spec::DailyAt { hour, minute })
                    }
                    _ => Err(ParseError(format!("invalid time in {input:?}"))),
                }
            }
            _ => Err(ParseError(format!("unrecognised spec {input:?}"))),
        }
    }

    fn parse_every(rest: &[u8]) -> Result<Spec, ParseError> {
        let split = rest.iter().position(|b| !b.is_ascii_digit()).unwrap_or(rest.len());
        let (digits, unit) = rest.split_at(split);
        let n: u64 = std::str::from_utf8(digits)
            .ok()
            .and_then(|s| s.parse().ok())
            .ok_or_else(|| ParseError("missing interval".into()))?;
        let secs = match unit {
            b"s" => n,
            b"m" => n * 60,
            b"h" => n * 3_600,
            other => {
                let unit = String::from_utf8_lossy(other);
                return Err(ParseError(format!("unknown unit '{unit}'")));
            }
        };
        if secs == 0 {
            return Err(ParseError("interval must be positive".to_owned()));
        }
        Ok(Spec::Every(Duration::from_secs(secs)))
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn parses_both_forms() {
            assert_eq!(parse("every 15m"), Ok(Spec::Every(Duration::from_secs(900))));
            assert_eq!(parse(" at 02:30 "), Ok(Spec::DailyAt { hour: 2, minute: 30 }));
            assert!(parse("at 24:00").is_err());
            assert!(parse("every 0s").is_err());
        }
    }
}

/// Field order matters: the derived `Ord` compares `due` first, then `id`.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
struct Entry {
    due: Duration,
    id: u64,
    name: String,
    spec: spec::Spec,
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct Report {
    pub succeeded: Vec<u64>,
    pub failed: Vec<(u64, String)>,
    pub retries: u32,
}

#[derive(Default)]
pub struct Scheduler {
    queue: BinaryHeap<Reverse<Entry>>,
    next_id: u64,
}

impl Scheduler {
    pub fn schedule(&mut self, name: impl Into<String>, spec: spec::Spec, now: Duration) -> u64 {
        self.next_id += 1;
        let entry = Entry { due: spec.next_after(now), id: self.next_id, name: name.into(), spec };
        self.queue.push(Reverse(entry));
        self.next_id
    }

    /// Pops every job due at `now`, re-queueing each for its next run first.
    fn take_due(&mut self, now: Duration) -> Vec<(u64, String)> {
        let mut due = Vec::new();
        while let Some(Reverse(entry)) = self.queue.peek() {
            if entry.due > now {
                break;
            }
            let Reverse(mut entry) = self.queue.pop().expect("peeked entry exists");
            due.push((entry.id, entry.name.clone()));
            entry.due = entry.spec.next_after(now);
            self.queue.push(Reverse(entry));
        }
        due
    }

    /// Runs every due job, retrying a failure up to `max_attempts` times.
    pub async fn run_due<F, Fut>(
        &mut self,
        now: Duration,
        max_attempts: u32,
        mut job: F,
    ) -> Report
    where
        F: FnMut(&str) -> Fut,
        Fut: Future<Output = Result<(), String>>,
    {
        let mut report = Report::default();
        'jobs: for (id, name) in self.take_due(now) {
            for attempt in 1..=max_attempts {
                match job(name.as_str()).await {
                    Ok(()) => {
                        report.succeeded.push(id);
                        continue 'jobs;
                    }
                    Err(err) if attempt == max_attempts => report.failed.push((id, err)),
                    Err(_) => {
                        report.retries += 1;
                        yield_now().await;
                    }
                }
            }
        }
        report
    }
}

struct YieldNow {
    yielded: bool,
}

impl Future for YieldNow {
    type Output = ();

    fn poll(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<()> {
        if self.yielded {
            return Poll::Ready(());
        }
        self.yielded = true;
        cx.waker().wake_by_ref();
        Poll::Pending
    }
}

/// Lets other work run once before continuing.
pub async fn yield_now() {
    YieldNow { yielded: false }.await
}

static NOOP_VTABLE: RawWakerVTable = RawWakerVTable::new(noop_clone, noop, noop, noop);

unsafe fn noop_clone(_: *const ()) -> RawWaker {
    RawWaker::new(std::ptr::null(), &NOOP_VTABLE)
}

unsafe fn noop(_: *const ()) {}

/// Drives a future to completion on the current thread by busy-polling.
pub fn block_on<F: Future>(fut: F) -> F::Output {
    // SAFETY: no vtable entry dereferences the data pointer, which is null.
    let waker = unsafe { Waker::from_raw(RawWaker::new(std::ptr::null(), &NOOP_VTABLE)) };
    let mut cx = Context::from_waker(&waker);
    let mut fut = pin!(fut);
    loop {
        if let Poll::Ready(out) = fut.as_mut().poll(&mut cx) {
            return out;
        }
        std::thread::yield_now();
    }
}
